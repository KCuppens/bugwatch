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
    cors::CorsLayer,
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
pub use services::{AlertingService, HealthCheckWorker, NotificationService, RetentionService};

// BugWatch self-monitoring
use bugwatch::{init as bugwatch_init, install_panic_hook, BugwatchClient, BugwatchOptions};

/// Maximum concurrent alert evaluation tasks
const MAX_CONCURRENT_ALERTS: usize = 100;

/// Records the instant the server process started, for uptime reporting.
static SERVER_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

fn init_server_start() {
    SERVER_START.get_or_init(std::time::Instant::now);
}

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub config: Arc<config::Config>,
    pub rate_limiter: RateLimiter,
    #[cfg(feature = "saas")]
    pub stripe: Option<billing::StripeClient>,
    pub alerting_service: Arc<AlertingService>,
    pub notification_service: Arc<NotificationService>,
    pub bugwatch: Option<Arc<BugwatchClient>>,
    pub alert_semaphore: Arc<tokio::sync::Semaphore>,
    pub payment_store: Arc<crate::payments::store::PaymentStore>,
    pub onchain_verifier: Arc<crate::payments::verify::OnChainVerifier>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Record server start time as early as possible for uptime reporting.
    init_server_start();

    // Load environment variables first (needed for tracing config)
    dotenvy::dotenv().ok();

    // Initialize tracing - JSON format in production, pretty format in dev
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "bugwatch_server=info,tower_http=info,sqlx=warn".into());

    let environment = std::env::var("ENVIRONMENT").unwrap_or_default();
    let use_json_logs = matches!(environment.as_str(), "production" | "staging");

    if !use_json_logs && !environment.is_empty() {
        eprintln!(
            "[WARN] ENVIRONMENT='{}' is not 'production' or 'staging' — using human-readable logs",
            environment
        );
    }

    if use_json_logs {
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

    // Warn if the DB still has legacy 16-char (64-bit) fingerprints from before the 128-bit upgrade.
    // Those issues will not deduplicate with new events until the fingerprints are backfilled.
    // To resolve: DELETE FROM issues WHERE char_length(fingerprint) = 16; (lets them re-create fresh)
    match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM issues WHERE char_length(fingerprint) = 16)",
    )
    .fetch_one(&db)
    .await
    {
        Ok(true) => {
            tracing::warn!(
                "Legacy 16-char fingerprints detected — these issues will not deduplicate with new events. \
                 Run: DELETE FROM issues WHERE char_length(fingerprint) = 16"
            );
        }
        Ok(false) => {}
        Err(e) => {
            tracing::warn!("Could not check for legacy fingerprints at startup: {}", e);
        }
    }

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

    // Initialize notification service (shared to avoid per-request SMTP/SES reconnection)
    let notification_service = Arc::new(NotificationService::new().await);
    info!("Notification service initialized");

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
        notification_service,
        bugwatch,
        alert_semaphore: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_ALERTS)),
        payment_store: Arc::new(crate::payments::store::PaymentStore::new(db.clone())),
        onchain_verifier: Arc::new(crate::payments::verify::OnChainVerifier::new(
            config.x402_rpc_url.clone(),
        )),
    };

    // Build application
    let app = create_app(state.clone());

    // Start health check worker in background — restart with exponential backoff (1s → 60s cap)
    let worker_db = state.db.clone();
    let worker_alerting = alerting_service.clone();
    tokio::spawn(async move {
        let mut backoff_secs: u64 = 1;
        loop {
            let worker =
                HealthCheckWorker::with_alerting(worker_db.clone(), worker_alerting.clone());
            worker.run().await;
            tracing::warn!(backoff_secs, "Health check worker exited — restarting");
            tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs)).await;
            backoff_secs = (backoff_secs * 2).min(60);
        }
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
            // Retry up to 3× on failure with a 5-minute back-off between attempts.
            let mut succeeded = false;
            for attempt in 1..=3u32 {
                match retention.run_cleanup().await {
                    Ok(()) => {
                        succeeded = true;
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(attempt, "Data retention cleanup attempt failed: {}", e);
                        if attempt < 3 {
                            tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
                        }
                    }
                }
            }
            if !succeeded {
                tracing::error!(
                    "Data retention cleanup failed after 3 attempts — will retry in 24 hours"
                );
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
                        // Retry up to 3× with 5s back-off so a transient network
                        // error doesn't silently drop the offline alert.
                        let mut last_err: Option<anyhow::Error> = None;
                        for attempt in 1u32..=3 {
                            match offline_alerting.on_server_offline(server).await {
                                Ok(()) => {
                                    last_err = None;
                                    break;
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        attempt,
                                        server_id = %server.id,
                                        "Server offline alert attempt {}/3 failed: {}",
                                        attempt, e
                                    );
                                    last_err = Some(e);
                                    if attempt < 3 {
                                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                                    }
                                }
                            }
                        }
                        if let Some(e) = last_err {
                            tracing::error!(
                                server_id = %server.id,
                                "Failed to send server offline alert after 3 attempts: {}",
                                e
                            );
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
            // Per-minute buckets: evict after 1 hour of inactivity
            let removed = rate_limiter.cleanup_inactive(3600);
            // Per-hour buckets: evict after 4 hours so the counter is never reset within the
            // 1-hour window (prevents rate-limit bypass via bucket eviction)
            let hourly_removed = rate_limiter.cleanup_hourly_inactive(4 * 3600);
            if removed + hourly_removed > 0 {
                tracing::info!(
                    "Rate limiter cleanup: removed {} per-minute + {} per-hour inactive buckets",
                    removed,
                    hourly_removed
                );
            }
        }
    });
    info!("Rate limiter cleanup task started (runs hourly)");

    // Start expired session cleanup task (runs daily)
    // Removes sessions that have passed their expires_at, including any orphaned sessions
    // left by soft-delete failures during token rotation.
    let session_cleanup_db = state.db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(24 * 60 * 60)); // 24 hours
        loop {
            interval.tick().await;
            // Loop until delete_expired drains the full backlog (batches of 1000).
            let mut total = 0u64;
            'batch: loop {
                for attempt in 1..=3u32 {
                    match crate::db::repositories::SessionRepository::delete_expired(
                        &session_cleanup_db,
                    )
                    .await
                    {
                        Ok(0) => break 'batch, // backlog drained
                        Ok(n) => {
                            total += n;
                            break; // batch succeeded, fetch next batch
                        }
                        Err(e) => {
                            tracing::warn!("Session cleanup attempt {}/3 failed: {}", attempt, e);
                            if attempt == 3 {
                                tracing::error!(
                                    "Session cleanup failed after 3 attempts — will retry next cycle"
                                );
                                break 'batch;
                            }
                            tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
                        }
                    }
                }
            }
            if total > 0 {
                tracing::info!("Session cleanup: deleted {} expired sessions", total);
            }
        }
    });
    info!("Session cleanup task started (runs daily)");

    // Start x402 payment challenge expiry task (runs hourly)
    let payment_store_clone = state.payment_store.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600)); // every hour
        loop {
            interval.tick().await;
            let mut succeeded = false;
            for attempt in 1..=3u32 {
                match payment_store_clone.expire_old().await {
                    Ok(n) => {
                        if n > 0 {
                            tracing::info!("Expired {} stale x402 payment challenges", n);
                        }
                        succeeded = true;
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to expire x402 challenges (attempt {}/3): {}",
                            attempt,
                            e
                        );
                        if attempt < 3 {
                            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        }
                    }
                }
            }
            if !succeeded {
                tracing::error!(
                    "x402 challenge expiry failed after 3 attempts — stale challenges may accumulate"
                );
            }
        }
    });
    info!("x402 payment challenge expiry task started (runs hourly)");

    // Start server
    let listener = TcpListener::bind(&config.server_addr).await?;
    info!("Listening on {}", config.server_addr);

    let grace_secs = config.shutdown_grace_secs;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_signal().await;
        // Allow in-flight requests (e.g. payment verifications with RPC retries) to
        // finish before the process exits. Configurable via SHUTDOWN_GRACE_SECS.
        info!("Graceful shutdown: waiting up to {}s for in-flight requests", grace_secs);
        tokio::time::sleep(std::time::Duration::from_secs(grace_secs)).await;
    })
    .await?;

    Ok(())
}

fn create_app(state: AppState) -> Router {
    let allowed_headers = [
        header::CONTENT_TYPE,
        header::AUTHORIZATION,
        header::ACCEPT,
        header::ORIGIN,
        HeaderName::from_static("x-api-key"),
        HeaderName::from_static("x-bugwatch-sdk"),
        HeaderName::from_static("x-bugwatch-sdk-version"),
        HeaderName::from_static("x-bugwatch-agent"),
        HeaderName::from_static("x-payment"),
    ];

    // CORS configuration
    let cors = if state.config.allowed_origins.is_empty()
        && state.config.environment == "development"
    {
        // Development: allow the frontend origin with credentials (for httpOnly cookies).
        // Can't use Any with allow_credentials(true), so derive from app_url or default.
        let dev_origin = {
            let url = state.config.app_url.trim_end_matches('/');
            let url = url.strip_suffix("/api").unwrap_or(url);
            url.parse::<HeaderValue>()
                .unwrap_or_else(|_| "http://localhost:3001".parse().unwrap())
        };
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
            .allow_headers(allowed_headers)
            .allow_credentials(true)
    } else if state.config.allowed_origins.is_empty() {
        // Non-development with no origins configured: restrictive default — no credentials
        // because no origin is permitted, so credential sharing would be meaningless and misleading.
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
            .allow_headers(allowed_headers)
            .allow_credentials(false)
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
            .allow_headers(allowed_headers)
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
    let router = {
        let s = state.clone();
        router.layer(axum::middleware::from_fn(move |req, next| {
            crate::payments::x402_payment_middleware(s.clone(), req, next)
        }))
    };

    router
        .with_state(state)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(
                    DefaultOnResponse::new()
                        .level(Level::INFO)
                        .latency_unit(tower_http::LatencyUnit::Micros),
                ),
        )
        .layer(cors)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2MB max body size
        // Security headers — prevent clickjacking, MIME sniffing, and control referrer
        .layer(axum::middleware::from_fn(security_headers))
        // Request correlation IDs — propagate or generate x-request-id for tracing
        .layer(axum::middleware::from_fn(request_id_middleware))
}

/// Security headers middleware — sets X-Frame-Options, X-Content-Type-Options,
/// Referrer-Policy, and X-XSS-Protection on every response.
async fn security_headers(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
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
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=63072000; includeSubDomains"),
    );
    response
}

/// Propagates an incoming `x-request-id` header or generates a new UUID,
/// then echoes it back in the response for end-to-end request tracing.
async fn request_id_middleware(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let request_id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    tracing::Span::current().record("request_id", request_id.as_str());

    let mut response = next.run(req).await;
    if let Ok(val) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static("x-request-id"), val);
    }
    response
}

async fn health_check(State(state): State<AppState>) -> axum::response::Response {
    use axum::response::IntoResponse;

    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();
    let status = if db_ok { "healthy" } else { "unhealthy" };
    let code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let timestamp = chrono::Utc::now().to_rfc3339();

    // In production, return only the fields a load-balancer needs: status,
    // timestamp, and whether the database is reachable.  Version strings and
    // pool internals are stripped to reduce information leakage.
    let body = if state.config.is_production() {
        serde_json::json!({
            "status": status,
            "timestamp": timestamp,
            "database": if db_ok { "connected" } else { "disconnected" },
        })
    } else {
        let uptime_secs = SERVER_START
            .get()
            .map(|s| s.elapsed().as_secs())
            .unwrap_or(0);
        serde_json::json!({
            "status": status,
            "version": env!("CARGO_PKG_VERSION"),
            "timestamp": timestamp,
            "uptime_secs": uptime_secs,
            "database": if db_ok { "connected" } else { "disconnected" },
            "db_pool": {
                "size": state.db.size(),
                "idle": state.db.num_idle()
            }
        })
    };

    (code, axum::Json(body)).into_response()
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
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install CTRL+C signal handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("Shutdown signal received, starting graceful shutdown");
}
