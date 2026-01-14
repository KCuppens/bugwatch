use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;
use tracing::info;

pub mod models;
pub mod repositories;

pub type DbPool = PgPool;

/// Initialize the database connection pool and run migrations
pub async fn init(database_url: &str) -> Result<DbPool> {
    info!("Connecting to database: {}", database_url);

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(5)
        .acquire_timeout(Duration::from_secs(3))
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
        )"
    )
    .execute(pool)
    .await?;

    // Run each migration if not already applied
    let migrations = [
        ("001_initial", include_str!("../../migrations/001_initial_pg.sql")),
        ("002_add_user_credits", include_str!("../../migrations/002_add_user_credits_pg.sql")),
        ("003_add_monitors", include_str!("../../migrations/003_add_monitors_pg.sql")),
        ("004_expand_alerts", include_str!("../../migrations/004_expand_alerts_pg.sql")),
        ("005_add_issue_comments", include_str!("../../migrations/005_add_issue_comments_pg.sql")),
        ("006_add_project_sdk", include_str!("../../migrations/006_add_project_sdk_pg.sql")),
        ("007_billing", include_str!("../../migrations/007_billing_pg.sql")),
        ("008_email_rate_limits", include_str!("../../migrations/008_email_rate_limits_pg.sql")),
        ("009_payment_failure_tracking", include_str!("../../migrations/009_payment_failure_tracking_pg.sql")),
        ("010_tax_handling", include_str!("../../migrations/010_tax_handling_pg.sql")),
    ];

    for (name, sql) in migrations {
        let already_applied: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = $1)"
        )
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap_or(false);

        if !already_applied {
            sqlx::raw_sql(sql).execute(pool).await?;
            sqlx::query("INSERT INTO _migrations (name) VALUES ($1)")
                .bind(name)
                .execute(pool)
                .await?;
            info!("Migration {} completed", name);
        } else {
            info!("Migration {} skipped (already applied)", name);
        }
    }

    info!("All migrations completed");
    Ok(())
}
