use anyhow::Result;
use axum::{routing::get, Router};
use std::sync::Arc;
use tokio::net::TcpListener;
use axum::http::{header, Method};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod auth;
mod billing;
mod config;
mod db;
mod error;
mod middleware;
mod processing;
mod rate_limit;
mod services;

pub use error::{AppError, AppResult};
pub use rate_limit::{RateLimiter, Tier};
pub use services::{AiService, AlertingService, HealthCheckWorker, RetentionService};

// BugWatch self-monitoring
use bugwatch::{init as bugwatch_init, BugwatchClient, BugwatchOptions, install_panic_hook};

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub config: Arc<config::Config>,
    pub rate_limiter: RateLimiter,
    pub ai_service: Option<AiService>,
    pub stripe: Option<billing::StripeClient>,
    pub alerting_service: Arc<AlertingService>,
    pub bugwatch: Option<Arc<BugwatchClient>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "bugwatch_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    dotenvy::dotenv().ok();
    let config = config::Config::from_env()?;

    info!("Starting Bugwatch server on {}", config.server_addr);

    // Initialize database
    let db = db::init(&config.database_url).await?;

    // Initialize AI service (only if API key is configured)
    let ai_service = config
        .anthropic_api_key
        .as_ref()
        .map(|key| {
            info!("AI service enabled");
            AiService::new(key.clone())
        });

    // Initialize Stripe client (only if configured)
    let stripe = api::billing::create_stripe_client(&config);
    if stripe.is_some() {
        info!("Stripe billing enabled");
    }

    // Initialize alerting service (shared between AppState and workers)
    let alerting_service = Arc::new(AlertingService::new(db.clone(), config.app_url.clone()).await);
    info!("Alerting service initialized");

    // Initialize BugWatch self-monitoring (dogfooding)
    // Uses bugwatch::init to set the global client for capture_message in error.rs
    let bugwatch = if config.is_bugwatch_enabled() {
        let api_key = config.bugwatch_api_key.as_ref().unwrap();
        let mut options = BugwatchOptions::new(api_key)
            .with_environment(&config.environment)
            .with_debug(!config.is_production());

        // Set custom endpoint if configured
        if let Some(ref endpoint) = config.bugwatch_endpoint {
            options = options.with_endpoint(endpoint);
        }

        // Use bugwatch::init to set the global client (required for capture_message in error.rs)
        let client = bugwatch_init(options);

        // Tag all events as self-monitoring to avoid alerting loops
        client.set_tag("source", "bugwatch-self-monitoring");
        client.set_tag("service", "bugwatch-server");

        // Install panic hook to capture panics
        install_panic_hook(client.clone());

        info!("BugWatch self-monitoring enabled");
        Some(client)
    } else {
        info!("BugWatch self-monitoring disabled (set BUGWATCH_ENABLED=true and BUGWATCH_API_KEY to enable)");
        None
    };

    // Create app state
    let state = AppState {
        db,
        config: Arc::new(config.clone()),
        rate_limiter: RateLimiter::new(),
        ai_service,
        stripe,
        alerting_service: alerting_service.clone(),
        bugwatch,
    };

    // Build application
    let app = create_app(state.clone());

    // Start health check worker in background
    let worker_db = state.db.clone();
    let worker_alerting = alerting_service.clone();
    tokio::spawn(async move {
        let worker = HealthCheckWorker::with_alerting(worker_db, worker_alerting);
        worker.run().await;
    });
    info!("Health check worker started");

    // Start data retention cleanup task (runs daily)
    let retention_db = state.db.clone();
    tokio::spawn(async move {
        let retention = RetentionService::new(retention_db);
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(24 * 60 * 60)); // 24 hours
        loop {
            interval.tick().await;
            if let Err(e) = retention.run_cleanup().await {
                tracing::error!("Data retention cleanup failed: {}", e);
            }
        }
    });
    info!("Data retention service started (runs daily)");

    // Start rate limiter cleanup task (runs hourly)
    let rate_limiter = state.rate_limiter.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60)); // 1 hour
        loop {
            interval.tick().await;
            let removed = rate_limiter.cleanup_inactive(3600); // Remove buckets inactive for > 1 hour
            if removed > 0 {
                tracing::info!("Rate limiter cleanup: removed {} inactive buckets", removed);
            }
        }
    });
    info!("Rate limiter cleanup task started (runs hourly)");

    // Start server
    let listener = TcpListener::bind(&config.server_addr).await?;
    info!("Listening on {}", config.server_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn create_app(state: AppState) -> Router {
    // CORS configuration - permissive for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            header::ORIGIN,
        ])
        .expose_headers(Any)
        .allow_credentials(false);

    Router::new()
        .route("/health", get(health_check))
        .nest("/api/v1", api::router())
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
}

async fn health_check() -> &'static str {
    "OK"
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C signal handler");
    info!("Shutdown signal received, starting graceful shutdown");
}
