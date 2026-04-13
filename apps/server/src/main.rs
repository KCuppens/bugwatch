use anyhow::Result;
use axum::http::{header, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{
    extract::{DefaultBodyLimit, State},
    routing::get,
    Router,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::info;
use tracing::Level;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod auth;
mod billing;
mod config;
mod db;
mod error;
mod middleware;
mod payments;
mod processing;
mod rate_limit;
mod services;
pub mod utils;

pub use error::{AppError, AppResult};
pub use rate_limit::RateLimiter;
pub use services::{AlertingService, HealthCheckWorker, RetentionService};

// BugWatch self-monitoring
use bugwatch::{init as bugwatch_init, install_panic_hook, BugwatchClient, BugwatchOptions};

/// Maximum concurrent alert evaluation tasks
const MAX_CONCURRENT_ALERTS: usize = 100;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub config: Arc<config::Config>,
    pub rate_limiter: RateLimiter,
    #[cfg(feature = "saas")]
    pub stripe: Option<billing::StripeClient>,
    pub alerting_service: Arc<AlertingService>,
    pub bugwatch: Option<Arc<BugwatchClient>>,
    pub alert_semaphore: Arc<tokio::sync::Semaphore>,
    pub payment_store: Arc<crate::payments::store::PaymentStore>,
    pub onchain_verifier: Arc<crate::payments::verify::OnChainVerifier>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables first (needed for tracing config)
    dotenvy::dotenv().ok();

    // Initialize tracing - JSON format in production, pretty format in dev
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "bugwatch_server=debug,tower_http=debug".into());

    let is_production = std::env::var("ENVIRONMENT")
        .map(|e| e == "production")
        .unwrap_or(false);

    if is_production {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }

    // Load configuration
    let config = config::Config::from_env()?;
    config.validate();

    info!(
        "Starting Bugwatch server on {} (mode: {:?})",
        config.server_addr, config.deployment_mode
    );

    // Initialize database
    let db = db::init_with_pool_size(&config.database_url, config.database_max_connections).await?;

    // Initialize Stripe client (SaaS mode only)
    #[cfg(feature = "saas")]
    let stripe = {
        let s = api::billing::create_stripe_client(&config);
        if s.is_some() {
            info!("Stripe billing enabled");
        }
        s
    };

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
        db: db.clone(),
        config: Arc::new(config.clone()),
        rate_limiter: RateLimiter::new(),
        #[cfg(feature = "saas")]
        stripe,
        alerting_service: alerting_service.clone(),
        bugwatch,
        alert_semaphore: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_ALERTS)),
        payment_store: Arc::new(crate::payments::store::PaymentStore::new(db.clone())),
        onchain_verifier: Arc::new(crate::payments::verify::OnChainVerifier::new(
            config.x402_rpc_url.clone(),
        )),
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
    let retention_days = config.retention_days;
    tokio::spawn(async move {
        let retention = RetentionService::with_retention_days(retention_db, retention_days);
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(24 * 60 * 60)); // 24 hours
        loop {
            interval.tick().await;
            if let Err(e) = retention.run_cleanup().await {
                tracing::error!("Data retention cleanup failed: {}", e);
            }
        }
    });
    info!("Data retention service started (runs daily)");

    // Start server offline detection task (runs every 60 seconds)
    let offline_db = state.db.clone();
    let offline_alerting = alerting_service.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            // Mark servers inactive if no metrics for 5 minutes
            let threshold = chrono::Utc::now() - chrono::Duration::minutes(5);
            match crate::db::repositories::ServerRepository::mark_inactive(&offline_db, threshold)
                .await
            {
                Ok(newly_offline) => {
                    for server in &newly_offline {
                        tracing::info!("Server {} ({}) marked offline", server.hostname, server.id);
                        if let Err(e) = offline_alerting.on_server_offline(server).await {
                            tracing::error!("Failed to send server offline alert: {}", e);
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Server offline check failed: {}", e);
                }
            }
        }
    });
    info!("Server offline detection started (runs every 60s)");

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

    // Start x402 payment challenge expiry task (runs hourly)
    let payment_store_clone = state.payment_store.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600)); // every hour
        loop {
            interval.tick().await;
            match payment_store_clone.expire_old().await {
                Ok(n) if n > 0 => tracing::info!("Expired {} stale x402 payment challenges", n),
                Err(e) => tracing::warn!("Failed to expire old x402 challenges: {}", e),
                _ => {}
            }
        }
    });
    info!("x402 payment challenge expiry task started (runs hourly)");

    // Start server
    let listener = TcpListener::bind(&config.server_addr).await?;
    info!("Listening on {}", config.server_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn create_app(state: AppState) -> Router {
    // CORS configuration
    let cors = if state.config.allowed_origins.is_empty()
        && state.config.environment == "development"
    {
        // Development: allow the frontend origin with credentials (for httpOnly cookies).
        // Can't use Any with allow_credentials(true), so derive from app_url or default.
        let dev_origin = state
            .config
            .app_url
            .replace("/api", "")
            .trim_end_matches('/')
            .parse::<HeaderValue>()
            .unwrap_or_else(|_| "http://localhost:3001".parse().unwrap());
        CorsLayer::new()
            .allow_origin(dev_origin)
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
                HeaderName::from_static("x-api-key"),
                HeaderName::from_static("x-bugwatch-sdk"),
                HeaderName::from_static("x-bugwatch-sdk-version"),
                HeaderName::from_static("x-bugwatch-agent"),
                HeaderName::from_static("x-payment"),
            ])
            .allow_credentials(true)
    } else if state.config.allowed_origins.is_empty() {
        // Non-development with no origins configured: restrictive default
        tracing::warn!("No ALLOWED_ORIGINS configured in non-development mode. CORS will reject cross-origin requests.");
        CorsLayer::new()
            .allow_origin(tower_http::cors::AllowOrigin::list(
                Vec::<HeaderValue>::new(),
            ))
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
                HeaderName::from_static("x-api-key"),
                HeaderName::from_static("x-bugwatch-sdk"),
                HeaderName::from_static("x-bugwatch-sdk-version"),
                HeaderName::from_static("x-bugwatch-agent"),
                HeaderName::from_static("x-payment"),
            ])
            .allow_credentials(true)
    } else {
        // Production: restrict to configured origins
        let origins: Vec<HeaderValue> = state
            .config
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse::<HeaderValue>().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
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
                HeaderName::from_static("x-api-key"),
                HeaderName::from_static("x-bugwatch-sdk"),
                HeaderName::from_static("x-bugwatch-sdk-version"),
                HeaderName::from_static("x-bugwatch-agent"),
                HeaderName::from_static("x-payment"),
            ])
            .allow_credentials(true)
    };

    let router = Router::new()
        .route("/health", get(health_check))
        // Agent install scripts (served for install.bugwatch.dev)
        .route("/install.sh", get(serve_install_script))
        .route("/agent/install.sh", get(serve_install_script))
        .route("/agent/agent.sh", get(serve_agent_script))
        .nest("/api/v1", api::router());

    // x402 on-chain payment middleware is a cloud-only concern; self-host
    // builds omit it entirely (it would be a runtime no-op anyway because
    // x402_enabled is false and deployment_mode is self-hosted).
    #[cfg(feature = "saas")]
    let router = router.layer(axum::middleware::from_fn_with_state(
        state.clone(),
        crate::payments::x402_payment_middleware,
    ));

    router
        .with_state(state)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(cors)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2MB max body size
        // Security headers — prevent clickjacking, MIME sniffing, and control referrer
        .layer(axum::middleware::from_fn(security_headers))
}

/// Security headers middleware — sets X-Frame-Options, X-Content-Type-Options,
/// Referrer-Policy, and X-XSS-Protection on every response.
async fn security_headers(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        HeaderName::from_static("x-xss-protection"),
        HeaderValue::from_static("1; mode=block"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    response
}

async fn health_check(State(state): State<AppState>) -> axum::response::Response {
    use axum::response::IntoResponse;

    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "status": "healthy",
                "database": "connected"
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "status": "unhealthy",
                "database": "disconnected"
            })),
        )
            .into_response(),
    }
}

async fn serve_install_script() -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        include_str!("../../../apps/agent/install.sh"),
    )
        .into_response()
}

async fn serve_agent_script() -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        include_str!("../../../apps/agent/agent.sh"),
    )
        .into_response()
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C signal handler");
    info!("Shutdown signal received, starting graceful shutdown");
}
