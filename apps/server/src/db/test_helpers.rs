use sqlx::{postgres::PgPoolOptions, PgPool, SqlitePool};

pub async fn test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::any::install_default_drivers();
    apply_schema_sqlite(&pool).await;
    pool
}

/// Returns a PgPool with a fresh per-test schema for isolation.
/// Reads TEST_DATABASE_URL, then DATABASE_URL, then falls back to a local default.
pub async fn test_any_pool() -> crate::db::DbPool {
    let url = std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost/bugwatch_test".to_string());

    // Create a unique schema so parallel tests don't interfere.
    let schema = format!("t{}", uuid::Uuid::new_v4().simple());

    let setup = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("TEST_DATABASE_URL or DATABASE_URL must point to a running Postgres server");
    sqlx::query(&format!("CREATE SCHEMA \"{}\"", schema))
        .execute(&setup)
        .await
        .unwrap();
    setup.close().await;

    let schema_hook = schema.clone();
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |conn, _| {
            let s = schema_hook.clone();
            Box::pin(async move {
                sqlx::query(&format!("SET search_path TO \"{}\"", s))
                    .execute(&mut *conn)
                    .await
                    .map(|_| ())
            })
        })
        .connect(&url)
        .await
        .unwrap();

    apply_schema_pg(&pool).await;
    pool
}

async fn apply_schema_pg(pool: &PgPool) {
    sqlx::raw_sql(SCHEMA_PG).execute(pool).await.unwrap();
}

async fn apply_schema_sqlite(pool: &SqlitePool) {
    sqlx::raw_sql(SCHEMA_SQLITE).execute(pool).await.unwrap();
}

/// Build a minimal `AppState` backed by an in-memory Postgres test schema.
/// All optional third-party services (SMTP, Stripe, BugWatch) are disabled.
/// Deployment mode is SelfHosted so all tier/feature checks are bypassed.
pub async fn test_app_state() -> crate::AppState {
    use crate::config::{Config, DeploymentMode};
    use std::sync::Arc;

    let pool = test_any_pool().await;

    let config = Config {
        server_addr: "127.0.0.1:0".to_string(),
        database_url: std::env::var("TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| "postgres://postgres:postgres@localhost/bugwatch_test".to_string()),
        jwt_secret: "test-jwt-secret-exactly-32-chars!!".to_string(),
        jwt_access_expiration: 900,
        jwt_refresh_expiration: 604800,
        deployment_mode: DeploymentMode::SelfHosted,
        environment: "test".to_string(),
        app_url: "http://localhost:3001".to_string(),
        allowed_origins: vec![],
        retention_days: 90,
        rate_limit_per_minute: 10000,
        smtp_host: None,
        smtp_port: None,
        smtp_user: None,
        smtp_password: None,
        smtp_from: None,
        stripe_secret_key: None,
        stripe_webhook_secret: None,
        stripe_price_id_pro_monthly: None,
        stripe_price_id_pro_annual: None,
        stripe_price_id_team_monthly: None,
        stripe_price_id_team_annual: None,
        bugwatch_api_key: None,
        bugwatch_endpoint: None,
        bugwatch_enabled: false,
        github_client_id: None,
        github_client_secret: None,
        jira_client_id: None,
        jira_client_secret: None,
        linear_client_id: None,
        linear_client_secret: None,
        trust_proxy: false,
        cookie_secure: false,
        encryption_key: None,
        password_reset_secret: "test-pw-reset-secret-exactly-32ch".to_string(),
        oauth_state_secret: "test-oauth-state-secret-exactly32!".to_string(),
        github_webhook_secret: None,
        jira_webhook_secret: None,
        linear_webhook_secret: None,
        database_max_connections: 1,
        shutdown_grace_secs: 5,
        x402_enabled: false,
        x402_wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
        x402_rpc_url: "https://mainnet.base.org".to_string(),
        x402_usdc_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".to_string(),
    };

    let alerting_service =
        Arc::new(crate::AlertingService::new(pool.clone(), config.app_url.clone()).await);
    let notification_service = Arc::new(crate::NotificationService::new().await);

    crate::AppState {
        db: pool.clone(),
        config: Arc::new(config),
        rate_limiter: crate::RateLimiter::new(),
        alerting_service,
        notification_service,
        bugwatch: None,
        alert_semaphore: Arc::new(tokio::sync::Semaphore::new(100)),
        payment_store: Arc::new(crate::payments::store::PaymentStore::new(pool)),
        onchain_verifier: Arc::new(
            crate::payments::verify::OnChainVerifier::new("https://mainnet.base.org".to_string())
                .expect("reqwest client init cannot fail in tests"),
        ),
    }
}

const SCHEMA_PG: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'active',
    seats INTEGER NOT NULL DEFAULT 1,
    billing_interval TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_failed_at TIMESTAMPTZ,
    grace_period_ends TIMESTAMPTZ,
    tax_id TEXT,
    tax_exempt BOOLEAN,
    billing_country TEXT,
    billing_address TEXT,
    x402_extra_projects INTEGER NOT NULL DEFAULT 0,
    x402_extra_monitors INTEGER NOT NULL DEFAULT 0,
    x402_extra_storage_bytes INTEGER NOT NULL DEFAULT 0,
    x402_extra_retention_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    api_key_hash TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settings TEXT NOT NULL DEFAULT '{}',
    platform TEXT,
    framework TEXT,
    onboarding_completed_at TIMESTAMPTZ,
    organization_id TEXT
);

CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unresolved',
    level TEXT NOT NULL DEFAULT 'error',
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    count INTEGER NOT NULL DEFAULT 1,
    user_count INTEGER NOT NULL DEFAULT 0,
    environment TEXT NOT NULL DEFAULT 'production',
    UNIQUE(project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    event_id TEXT UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    payload TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_recording_id TEXT,
    next_js_digest TEXT
);

CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    condition TEXT NOT NULL,
    actions TEXT NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    muted_until TIMESTAMPTZ,
    snooze_duration_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY NOT NULL,
    alert_rule_id TEXT NOT NULL,
    channel_id TEXT,
    trigger_type TEXT NOT NULL,
    trigger_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS issue_comments (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    expected_status INTEGER DEFAULT 200,
    headers TEXT NOT NULL DEFAULT '{}',
    body TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ,
    current_status TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS monitor_checks (
    id TEXT PRIMARY KEY NOT NULL,
    monitor_id TEXT NOT NULL,
    status TEXT NOT NULL,
    response_time_ms INTEGER,
    status_code INTEGER,
    error_message TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitor_incidents (
    id TEXT PRIMARY KEY NOT NULL,
    monitor_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    cause TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, metric, period_start)
);

CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stripe_event_id TEXT,
    amount_cents INTEGER,
    currency TEXT DEFAULT 'usd',
    metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(stripe_event_id)
);

CREATE TABLE IF NOT EXISTS email_rate_limits (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_fingerprint TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, issue_fingerprint, channel_id)
);

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    os TEXT,
    kernel TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(project_id, server_id)
);

CREATE TABLE IF NOT EXISTS server_metrics (
    id TEXT PRIMARY KEY NOT NULL,
    server_db_id TEXT NOT NULL,
    cpu_usage_percent REAL,
    load_avg_1 REAL,
    load_avg_5 REAL,
    load_avg_15 REAL,
    mem_total_bytes BIGINT,
    mem_used_bytes BIGINT,
    mem_available_bytes BIGINT,
    mem_usage_percent REAL,
    swap_total_bytes BIGINT,
    swap_used_bytes BIGINT,
    net_rx_bytes_per_sec BIGINT,
    net_tx_bytes_per_sec BIGINT,
    uptime_seconds BIGINT,
    disks_json TEXT,
    processes_json TEXT,
    docker_json TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_keys (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '["read"]',
    created_by TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    agent_key_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    transaction_name TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    op TEXT NOT NULL DEFAULT 'default',
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    duration_ms DOUBLE PRECISION NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    environment TEXT,
    release TEXT,
    tags TEXT,
    data TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    op TEXT NOT NULL,
    description TEXT,
    status TEXT,
    duration_ms DOUBLE PRECISION NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    data TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    external_user_id TEXT,
    external_username TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, provider)
);

CREATE TABLE IF NOT EXISTS issue_links (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_issue_id TEXT NOT NULL,
    external_issue_key TEXT NOT NULL,
    external_issue_url TEXT NOT NULL,
    external_status TEXT,
    sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_recordings (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER,
    is_complete BOOLEAN NOT NULL DEFAULT FALSE,
    segment_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes INTEGER NOT NULL DEFAULT 0,
    environment TEXT,
    release TEXT,
    user_agent TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_segments (
    id TEXT PRIMARY KEY NOT NULL,
    recording_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    data BYTEA NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(recording_id, segment_index)
);

CREATE TABLE IF NOT EXISTS agent_payments (
    id TEXT PRIMARY KEY NOT NULL,
    nonce TEXT UNIQUE NOT NULL,
    organization_id TEXT NOT NULL,
    agent_key_id TEXT,
    resource TEXT NOT NULL,
    payment_type TEXT NOT NULL,
    feature TEXT,
    grant_type TEXT,
    grant_quantity INTEGER,
    amount_usdc INTEGER NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log monitoring tables (simplified flat table for PG unit tests;
-- production uses a monthly range-partitioned table from migration 034).
CREATE TABLE IF NOT EXISTS logs (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    log_id TEXT NOT NULL UNIQUE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    logger_name TEXT,
    service_name TEXT,
    environment TEXT,
    release TEXT,
    tags JSONB,
    extra JSONB,
    attributes JSONB,
    issue_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS log_saved_searches (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    filters TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS log_alert_rules (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    level_filter TEXT,
    search_filter TEXT,
    threshold INTEGER NOT NULL DEFAULT 1,
    window_seconds INTEGER NOT NULL,
    notification_type TEXT NOT NULL,
    notification_target TEXT NOT NULL,
    last_fired_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"#;

const SCHEMA_SQLITE: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ip_address TEXT,
    user_agent TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'active',
    seats INTEGER NOT NULL DEFAULT 1,
    billing_interval TEXT,
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    payment_failed_at TEXT,
    grace_period_ends TEXT,
    tax_id TEXT,
    tax_exempt INTEGER,
    billing_country TEXT,
    billing_address TEXT,
    x402_extra_projects INTEGER NOT NULL DEFAULT 0,
    x402_extra_monitors INTEGER NOT NULL DEFAULT 0,
    x402_extra_storage_bytes INTEGER NOT NULL DEFAULT 0,
    x402_extra_retention_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    api_key_hash TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    settings TEXT NOT NULL DEFAULT '{}',
    platform TEXT,
    framework TEXT,
    onboarding_completed_at TEXT,
    organization_id TEXT
);

CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unresolved',
    level TEXT NOT NULL DEFAULT 'error',
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    count INTEGER NOT NULL DEFAULT 1,
    user_count INTEGER NOT NULL DEFAULT 0,
    environment TEXT NOT NULL DEFAULT 'production',
    UNIQUE(project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    event_id TEXT UNIQUE NOT NULL,
    timestamp TEXT NOT NULL,
    payload TEXT NOT NULL,
    processed_at TEXT NOT NULL DEFAULT (datetime('now')),
    session_recording_id TEXT,
    next_js_digest TEXT
);

CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    condition TEXT NOT NULL,
    actions TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    muted_until TEXT,
    snooze_duration_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY NOT NULL,
    alert_rule_id TEXT NOT NULL,
    channel_id TEXT,
    trigger_type TEXT NOT NULL,
    trigger_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_comments (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    expected_status INTEGER DEFAULT 200,
    headers TEXT NOT NULL DEFAULT '{}',
    body TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked_at TEXT,
    current_status TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS monitor_checks (
    id TEXT PRIMARY KEY NOT NULL,
    monitor_id TEXT NOT NULL,
    status TEXT NOT NULL,
    response_time_ms INTEGER,
    status_code INTEGER,
    error_message TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitor_incidents (
    id TEXT PRIMARY KEY NOT NULL,
    monitor_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    resolved_at TEXT,
    cause TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS organization_members (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(organization_id, metric, period_start)
);

CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stripe_event_id TEXT,
    amount_cents INTEGER,
    currency TEXT DEFAULT 'usd',
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(stripe_event_id)
);

CREATE TABLE IF NOT EXISTS email_rate_limits (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_fingerprint TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    last_sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, issue_fingerprint, channel_id)
);

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    os TEXT,
    kernel TEXT,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(project_id, server_id)
);

CREATE TABLE IF NOT EXISTS server_metrics (
    id TEXT PRIMARY KEY NOT NULL,
    server_db_id TEXT NOT NULL,
    cpu_usage_percent REAL,
    load_avg_1 REAL,
    load_avg_5 REAL,
    load_avg_15 REAL,
    mem_total_bytes INTEGER,
    mem_used_bytes INTEGER,
    mem_available_bytes INTEGER,
    mem_usage_percent REAL,
    swap_total_bytes INTEGER,
    swap_used_bytes INTEGER,
    net_rx_bytes_per_sec INTEGER,
    net_tx_bytes_per_sec INTEGER,
    uptime_seconds INTEGER,
    disks_json TEXT,
    processes_json TEXT,
    docker_json TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_keys (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '["read"]',
    created_by TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    agent_key_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    transaction_name TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    op TEXT NOT NULL DEFAULT 'default',
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    duration_ms REAL NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    environment TEXT,
    release TEXT,
    tags TEXT,
    data TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    op TEXT NOT NULL,
    description TEXT,
    status TEXT,
    duration_ms REAL NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TEXT,
    external_user_id TEXT,
    external_username TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(organization_id, provider)
);

CREATE TABLE IF NOT EXISTS issue_links (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_issue_id TEXT NOT NULL,
    external_issue_key TEXT NOT NULL,
    external_issue_url TEXT NOT NULL,
    external_status TEXT,
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_recordings (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT,
    started_at TEXT NOT NULL,
    duration_ms INTEGER,
    is_complete INTEGER NOT NULL DEFAULT 0,
    segment_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes INTEGER NOT NULL DEFAULT 0,
    environment TEXT,
    release TEXT,
    user_agent TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_segments (
    id TEXT PRIMARY KEY NOT NULL,
    recording_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    data BLOB NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(recording_id, segment_index)
);

CREATE TABLE IF NOT EXISTS agent_payments (
    id TEXT PRIMARY KEY NOT NULL,
    nonce TEXT UNIQUE NOT NULL,
    organization_id TEXT NOT NULL,
    agent_key_id TEXT,
    resource TEXT NOT NULL,
    payment_type TEXT NOT NULL,
    feature TEXT,
    grant_type TEXT,
    grant_quantity INTEGER,
    amount_usdc INTEGER NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at TEXT,
    consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;
