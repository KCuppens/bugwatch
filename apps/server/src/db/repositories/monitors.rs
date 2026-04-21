use crate::db::{
    models::{Monitor, MonitorCheck, MonitorIncident},
    DbPool,
};
use anyhow::Result;
use chrono::{DateTime, Utc};
use uuid::Uuid;

pub struct MonitorRepository;

impl MonitorRepository {
    pub async fn create(
        pool: &DbPool,
        project_id: &str,
        name: &str,
        url: &str,
        method: &str,
        interval_seconds: i32,
        timeout_ms: i32,
        expected_status: Option<i32>,
        headers: &str,
        body: Option<&str>,
    ) -> Result<Monitor> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, Monitor>(
            r#"
            INSERT INTO monitors (id, project_id, name, url, method, interval_seconds, timeout_ms, expected_status, headers, body, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(url)
        .bind(method)
        .bind(interval_seconds)
        .bind(timeout_ms)
        .bind(expected_status)
        .bind(headers)
        .bind(body)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Monitor>> {
        sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn count_by_project(pool: &DbPool, project_id: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM monitors WHERE project_id = $1")
            .bind(project_id)
            .fetch_one(pool)
            .await?;
        Ok(row.0)
    }

    /// Count total monitors across all projects owned by a user
    pub async fn count_by_owner(pool: &DbPool, owner_id: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM monitors m
            JOIN projects p ON m.project_id = p.id
            WHERE p.owner_id = $1
            "#,
        )
        .bind(owner_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0)
    }

    pub async fn list_by_project(
        pool: &DbPool,
        project_id: &str,
        page: u32,
        per_page: u32,
    ) -> Result<(Vec<Monitor>, i64)> {
        let offset = (page - 1) * per_page;

        let monitors = sqlx::query_as::<_, Monitor>(
            r#"
            SELECT * FROM monitors
            WHERE project_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(project_id)
        .bind(per_page as i64)
        .bind(offset as i64)
        .fetch_all(pool)
        .await?;

        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM monitors WHERE project_id = $1")
            .bind(project_id)
            .fetch_one(pool)
            .await?;

        Ok((monitors, total.0))
    }

    pub async fn list_active(pool: &DbPool) -> Result<Vec<Monitor>> {
        sqlx::query_as::<_, Monitor>(
            "SELECT * FROM monitors WHERE is_active = TRUE ORDER BY last_checked_at ASC NULLS FIRST LIMIT 10000",
        )
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Atomically claim up to `batch_size` monitors that are due for a health check.
    /// Sets `last_checked_at = NOW()` so concurrent workers skip claimed rows via
    /// FOR UPDATE SKIP LOCKED, preventing duplicate checks across replicas.
    pub async fn claim_due_monitors(pool: &DbPool, batch_size: i32) -> Result<Vec<Monitor>> {
        sqlx::query_as::<_, Monitor>(
            r#"
            WITH claimed AS (
                SELECT id FROM monitors
                WHERE is_active = TRUE
                  AND (
                      last_checked_at IS NULL
                      OR last_checked_at + (interval '1 second' * interval_seconds) <= NOW()
                  )
                ORDER BY last_checked_at ASC NULLS FIRST
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE monitors
            SET last_checked_at = NOW()
            WHERE id IN (SELECT id FROM claimed)
            RETURNING *
            "#,
        )
        .bind(batch_size)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_active_across_projects(
        pool: &DbPool,
        project_ids: &[String],
    ) -> Result<Vec<Monitor>> {
        if project_ids.is_empty() {
            return Ok(vec![]);
        }

        sqlx::query_as::<_, Monitor>(
            "SELECT * FROM monitors WHERE project_id = ANY($1) AND is_active = TRUE ORDER BY current_status ASC, name ASC",
        )
        .bind(project_ids)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn update(
        pool: &DbPool,
        id: &str,
        name: Option<&str>,
        url: Option<&str>,
        method: Option<&str>,
        interval_seconds: Option<i32>,
        timeout_ms: Option<i32>,
        expected_status: Option<i32>,
        headers: Option<&str>,
        body: Option<&str>,
        is_active: Option<bool>,
    ) -> Result<Monitor> {
        sqlx::query_as::<_, Monitor>(
            "UPDATE monitors
             SET name = COALESCE($1, name),
                 url = COALESCE($2, url),
                 method = COALESCE($3, method),
                 interval_seconds = COALESCE($4, interval_seconds),
                 timeout_ms = COALESCE($5, timeout_ms),
                 expected_status = COALESCE($6, expected_status),
                 headers = COALESCE($7, headers),
                 body = COALESCE($8, body),
                 is_active = COALESCE($9, is_active)
             WHERE id = $10
             RETURNING *",
        )
        .bind(name)
        .bind(url)
        .bind(method)
        .bind(interval_seconds)
        .bind(timeout_ms)
        .bind(expected_status)
        .bind(headers)
        .bind(body)
        .bind(is_active)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Monitor not found"))
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM monitors WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn update_status(
        pool: &DbPool,
        id: &str,
        status: &str,
        checked_at: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query("UPDATE monitors SET current_status = $1, last_checked_at = $2 WHERE id = $3")
            .bind(status)
            .bind(checked_at)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

pub struct MonitorCheckRepository;

impl MonitorCheckRepository {
    pub async fn create(
        pool: &DbPool,
        monitor_id: &str,
        status: &str,
        response_time_ms: Option<i32>,
        status_code: Option<i32>,
        error_message: Option<&str>,
    ) -> Result<MonitorCheck> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, MonitorCheck>(
            r#"
            INSERT INTO monitor_checks (id, monitor_id, status, response_time_ms, status_code, error_message, checked_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(monitor_id)
        .bind(status)
        .bind(response_time_ms)
        .bind(status_code)
        .bind(error_message)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_by_monitor(
        pool: &DbPool,
        monitor_id: &str,
        limit: u32,
    ) -> Result<Vec<MonitorCheck>> {
        sqlx::query_as::<_, MonitorCheck>(
            r#"
            SELECT * FROM monitor_checks
            WHERE monitor_id = $1
            ORDER BY checked_at DESC
            LIMIT $2
            "#,
        )
        .bind(monitor_id)
        .bind(limit as i64)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_uptime_stats(
        pool: &DbPool,
        monitor_id: &str,
        hours: i32,
    ) -> Result<(i64, i64, Option<f64>)> {
        // Get total checks and up checks in the time window
        // Use COALESCE to ensure SUM never returns NULL (which can't deserialize to i64)
        let stats: (i64, i64, Option<f64>) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END), 0)::BIGINT as up_count,
                AVG(response_time_ms)::double precision as avg_response
            FROM monitor_checks
            WHERE monitor_id = $1
            AND checked_at >= NOW() - INTERVAL '1 hour' * $2
            "#,
        )
        .bind(monitor_id)
        .bind(hours)
        .fetch_one(pool)
        .await?;

        Ok(stats)
    }

    /// Fetch uptime stats for multiple monitors in a single query.
    /// Returns a map from monitor_id to (total_checks, up_checks, avg_response_ms).
    pub async fn batch_uptime_stats(
        pool: &DbPool,
        monitor_ids: &[String],
        hours: i32,
    ) -> Result<std::collections::HashMap<String, (i64, i64, Option<f64>)>> {
        if monitor_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let rows: Vec<(String, i64, i64, Option<f64>)> = sqlx::query_as(
            r#"
            SELECT
                monitor_id,
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END), 0)::BIGINT as up_count,
                AVG(response_time_ms)::double precision as avg_response
            FROM monitor_checks
            WHERE monitor_id = ANY($1)
              AND checked_at >= NOW() - INTERVAL '1 hour' * $2
            GROUP BY monitor_id
            "#,
        )
        .bind(monitor_ids)
        .bind(hours)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(id, total, up, avg)| (id, (total, up, avg)))
            .collect())
    }

    /// Fetch the most recent error message for each "down" monitor in a single query.
    pub async fn batch_last_errors(
        pool: &DbPool,
        monitor_ids: &[String],
    ) -> Result<std::collections::HashMap<String, String>> {
        if monitor_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"
            SELECT DISTINCT ON (monitor_id) monitor_id, error_message
            FROM monitor_checks
            WHERE monitor_id = ANY($1)
              AND status = 'down'
              AND error_message IS NOT NULL
            ORDER BY monitor_id, checked_at DESC
            "#,
        )
        .bind(monitor_ids)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().collect())
    }

    pub async fn cleanup_old_checks(pool: &DbPool, days: i32) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM monitor_checks WHERE checked_at < NOW() - INTERVAL '1 day' * $1",
        )
        .bind(days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Get the last error message for a monitor (if any)
    pub async fn get_last_error(pool: &DbPool, monitor_id: &str) -> Result<Option<String>> {
        let result: Option<(Option<String>,)> = sqlx::query_as(
            r#"
            SELECT error_message FROM monitor_checks
            WHERE monitor_id = $1 AND status = 'down' AND error_message IS NOT NULL
            ORDER BY checked_at DESC
            LIMIT 1
            "#,
        )
        .bind(monitor_id)
        .fetch_optional(pool)
        .await?;

        Ok(result.and_then(|r| r.0))
    }
}

pub struct MonitorIncidentRepository;

impl MonitorIncidentRepository {
    pub async fn create(
        pool: &DbPool,
        monitor_id: &str,
        cause: Option<&str>,
    ) -> Result<MonitorIncident> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, MonitorIncident>(
            r#"
            INSERT INTO monitor_incidents (id, monitor_id, started_at, cause, created_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(monitor_id)
        .bind(now)
        .bind(cause)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn resolve(pool: &DbPool, id: &str) -> Result<MonitorIncident> {
        let now = Utc::now();

        sqlx::query_as::<_, MonitorIncident>(
            r#"
            UPDATE monitor_incidents
            SET resolved_at = $1
            WHERE id = $2
            RETURNING *
            "#,
        )
        .bind(now)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_open_by_monitor(
        pool: &DbPool,
        monitor_id: &str,
    ) -> Result<Option<MonitorIncident>> {
        sqlx::query_as::<_, MonitorIncident>(
            "SELECT * FROM monitor_incidents WHERE monitor_id = $1 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
        )
        .bind(monitor_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_by_monitor(
        pool: &DbPool,
        monitor_id: &str,
        limit: u32,
    ) -> Result<Vec<MonitorIncident>> {
        sqlx::query_as::<_, MonitorIncident>(
            r#"
            SELECT * FROM monitor_incidents
            WHERE monitor_id = $1
            ORDER BY started_at DESC
            LIMIT $2
            "#,
        )
        .bind(monitor_id)
        .bind(limit as i64)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}
