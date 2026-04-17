use anyhow::Result;
use chrono::{DateTime, Utc};

use crate::db::{
    models::{Server, ServerMetric},
    DbPool,
};

pub struct ServerRepository;

impl ServerRepository {
    /// Upsert a server record (insert or update last_seen/metadata)
    pub async fn upsert(
        pool: &DbPool,
        project_id: &str,
        server_id: &str,
        hostname: &str,
        os: Option<&str>,
        kernel: Option<&str>,
    ) -> Result<Server> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        let server = sqlx::query_as::<_, Server>(
            "INSERT INTO servers (id, project_id, server_id, hostname, os, kernel, first_seen, last_seen, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7, TRUE)
             ON CONFLICT (project_id, server_id) DO UPDATE SET
                hostname = EXCLUDED.hostname,
                os = COALESCE(EXCLUDED.os, servers.os),
                kernel = COALESCE(EXCLUDED.kernel, servers.kernel),
                last_seen = EXCLUDED.last_seen,
                is_active = TRUE
             RETURNING *"
        )
        .bind(&id)
        .bind(project_id)
        .bind(server_id)
        .bind(hostname)
        .bind(os)
        .bind(kernel)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(server)
    }

    /// List all servers for a project
    pub async fn list_by_project(pool: &DbPool, project_id: &str) -> Result<Vec<Server>> {
        let servers = sqlx::query_as::<_, Server>(
            "SELECT * FROM servers WHERE project_id = $1 ORDER BY last_seen DESC",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        Ok(servers)
    }

    /// Find a server by its agent-reported server_id within a project
    pub async fn find_by_server_id(
        pool: &DbPool,
        project_id: &str,
        server_id: &str,
    ) -> Result<Option<Server>> {
        let server = sqlx::query_as::<_, Server>(
            "SELECT * FROM servers WHERE project_id = $1 AND server_id = $2",
        )
        .bind(project_id)
        .bind(server_id)
        .fetch_optional(pool)
        .await?;

        Ok(server)
    }

    /// Find a server by its database ID
    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Server>> {
        let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;

        Ok(server)
    }

    /// Check if a project has any servers registered
    pub async fn has_servers(pool: &DbPool, project_id: &str) -> Result<bool> {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE project_id = $1)")
                .bind(project_id)
                .fetch_one(pool)
                .await?;

        Ok(exists)
    }

    /// Count servers for a project
    pub async fn count_by_project(pool: &DbPool, project_id: &str) -> Result<i64> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE project_id = $1")
            .bind(project_id)
            .fetch_one(pool)
            .await?;

        Ok(count)
    }

    /// Mark servers as inactive if they haven't reported in recently
    pub async fn mark_inactive(pool: &DbPool, threshold: DateTime<Utc>) -> Result<Vec<Server>> {
        let servers = sqlx::query_as::<_, Server>(
            "UPDATE servers SET is_active = FALSE
             WHERE is_active = TRUE AND last_seen < $1
             RETURNING *",
        )
        .bind(threshold)
        .fetch_all(pool)
        .await?;

        Ok(servers)
    }
}

pub struct ServerMetricsRepository;

impl ServerMetricsRepository {
    /// Insert a new metrics snapshot
    pub async fn create(
        pool: &DbPool,
        server_db_id: &str,
        cpu_usage_percent: Option<f64>,
        load_avg_1: Option<f64>,
        load_avg_5: Option<f64>,
        load_avg_15: Option<f64>,
        mem_total_bytes: Option<i64>,
        mem_used_bytes: Option<i64>,
        mem_available_bytes: Option<i64>,
        mem_usage_percent: Option<f64>,
        swap_total_bytes: Option<i64>,
        swap_used_bytes: Option<i64>,
        net_rx_bytes_per_sec: Option<i64>,
        net_tx_bytes_per_sec: Option<i64>,
        uptime_seconds: Option<i64>,
        disks_json: Option<&str>,
        processes_json: Option<&str>,
        docker_json: Option<&str>,
    ) -> Result<ServerMetric> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        let metric = sqlx::query_as::<_, ServerMetric>(
            "INSERT INTO server_metrics (
                id, server_db_id, cpu_usage_percent, load_avg_1, load_avg_5, load_avg_15,
                mem_total_bytes, mem_used_bytes, mem_available_bytes, mem_usage_percent,
                swap_total_bytes, swap_used_bytes, net_rx_bytes_per_sec, net_tx_bytes_per_sec,
                uptime_seconds, disks_json, processes_json, docker_json, recorded_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
             RETURNING *"
        )
        .bind(&id)
        .bind(server_db_id)
        .bind(cpu_usage_percent)
        .bind(load_avg_1)
        .bind(load_avg_5)
        .bind(load_avg_15)
        .bind(mem_total_bytes)
        .bind(mem_used_bytes)
        .bind(mem_available_bytes)
        .bind(mem_usage_percent)
        .bind(swap_total_bytes)
        .bind(swap_used_bytes)
        .bind(net_rx_bytes_per_sec)
        .bind(net_tx_bytes_per_sec)
        .bind(uptime_seconds)
        .bind(disks_json)
        .bind(processes_json)
        .bind(docker_json)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(metric)
    }

    /// Get the latest metrics for a server
    pub async fn get_latest(pool: &DbPool, server_db_id: &str) -> Result<Option<ServerMetric>> {
        let metric = sqlx::query_as::<_, ServerMetric>(
            "SELECT * FROM server_metrics WHERE server_db_id = $1 ORDER BY recorded_at DESC LIMIT 1"
        )
        .bind(server_db_id)
        .fetch_optional(pool)
        .await?;

        Ok(metric)
    }

    /// Get metrics in a time range
    pub async fn get_range(
        pool: &DbPool,
        server_db_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<ServerMetric>> {
        let metrics = sqlx::query_as::<_, ServerMetric>(
            "SELECT * FROM server_metrics
             WHERE server_db_id = $1 AND recorded_at >= $2 AND recorded_at <= $3
             ORDER BY recorded_at ASC
             LIMIT 10000",
        )
        .bind(server_db_id)
        .bind(from)
        .bind(to)
        .fetch_all(pool)
        .await?;

        Ok(metrics)
    }

    /// Cleanup metrics older than given number of days
    pub async fn cleanup_old_metrics(pool: &DbPool, retention_days: i32) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM server_metrics WHERE recorded_at < NOW() - make_interval(days => $1)",
        )
        .bind(retention_days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }
}
