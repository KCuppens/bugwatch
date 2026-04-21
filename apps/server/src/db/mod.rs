use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;
use tracing::info;

pub mod models;
pub mod repositories;

pub type DbPool = PgPool;

/// Initialize the database connection pool and run migrations
pub async fn init(database_url: &str) -> Result<DbPool> {
    init_with_pool_size(database_url, 100).await
}

/// Initialize the database connection pool with a configurable max size
pub async fn init_with_pool_size(database_url: &str, max_connections: u32) -> Result<DbPool> {
    // Keep a warm floor of connections so bursty traffic doesn't pay the
    // full handshake cost on the first few requests. ~15% of max, clamped.
    let min_connections = max_connections.saturating_div(7).clamp(10, 25);
    info!(
        "Connecting to database (max_connections={}, min_connections={}): {}",
        max_connections, min_connections, database_url
    );

    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect(database_url)
        .await?;

    // Run migrations
    run_migrations(&pool).await?;

    info!("Database initialized successfully");
    Ok(pool)
}

async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations...");

    // Create migrations tracking table if not exists
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    // Run each migration if not already applied
    let migrations = [
        (
            "001_initial",
            include_str!("../../migrations/001_initial_pg.sql"),
        ),
        (
            "002_add_user_credits",
            include_str!("../../migrations/002_add_user_credits_pg.sql"),
        ),
        (
            "003_add_monitors",
            include_str!("../../migrations/003_add_monitors_pg.sql"),
        ),
        (
            "004_expand_alerts",
            include_str!("../../migrations/004_expand_alerts_pg.sql"),
        ),
        (
            "005_add_issue_comments",
            include_str!("../../migrations/005_add_issue_comments_pg.sql"),
        ),
        (
            "006_add_project_sdk",
            include_str!("../../migrations/006_add_project_sdk_pg.sql"),
        ),
        (
            "007_billing",
            include_str!("../../migrations/007_billing_pg.sql"),
        ),
        (
            "008_email_rate_limits",
            include_str!("../../migrations/008_email_rate_limits_pg.sql"),
        ),
        (
            "009_payment_failure_tracking",
            include_str!("../../migrations/009_payment_failure_tracking_pg.sql"),
        ),
        (
            "010_tax_handling",
            include_str!("../../migrations/010_tax_handling_pg.sql"),
        ),
        (
            "011_server_metrics",
            include_str!("../../migrations/011_server_metrics_pg.sql"),
        ),
        (
            "012_add_issue_environment",
            include_str!("../../migrations/012_add_issue_environment_pg.sql"),
        ),
        (
            "013_agent_keys",
            include_str!("../../migrations/013_agent_keys_pg.sql"),
        ),
        (
            "014_alert_enhancements",
            include_str!("../../migrations/014_alert_enhancements_pg.sql"),
        ),
        (
            "015_performance_monitoring",
            include_str!("../../migrations/015_performance_monitoring_pg.sql"),
        ),
        (
            "016_integrations",
            include_str!("../../migrations/016_integrations_pg.sql"),
        ),
        (
            "017_session_replay",
            include_str!("../../migrations/017_session_replay_pg.sql"),
        ),
        (
            "018_api_key_hash",
            include_str!("../../migrations/018_api_key_hash_pg.sql"),
        ),
        (
            "019_add_indexes",
            include_str!("../../migrations/019_add_indexes_pg.sql"),
        ),
        (
            "020_agent_payments",
            include_str!("../../migrations/020_agent_payments_pg.sql"),
        ),
        (
            "021_agent_payments_tx_hash_unique",
            include_str!("../../migrations/021_agent_payments_tx_hash_unique_pg.sql"),
        ),
        (
            "022_perf_indexes",
            include_str!("../../migrations/022_perf_indexes_pg.sql"),
        ),
    ];

    for (name, sql) in migrations {
        let already_applied: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = $1)")
                .bind(name)
                .fetch_one(pool)
                .await
                .unwrap_or(false);

        if !already_applied {
            // Atomic: SQL + migration record in one transaction so a crash between
            // the two steps cannot cause the migration to re-run on the next start.
            let mut tx = pool.begin().await?;
            sqlx::raw_sql(sql).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO _migrations (name) VALUES ($1)")
                .bind(name)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            info!("Migration {} completed", name);
        } else {
            info!("Migration {} skipped (already applied)", name);
        }
    }

    info!("All migrations completed");
    Ok(())
}
