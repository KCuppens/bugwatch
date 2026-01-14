use crate::db::{models::{Monitor, MonitorCheck, MonitorIncident}, DbPool};
use anyhow::Result;
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
        let now = chrono::Utc::now().to_rfc3339();

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
        .bind(&now)
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
            "SELECT * FROM monitors WHERE is_active = TRUE ORDER BY last_checked_at ASC NULLS FIRST",
        )
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
        // Perform individual updates for each field
        if let Some(n) = name {
            sqlx::query("UPDATE monitors SET name = $1 WHERE id = $2")
                .bind(n)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(u) = url {
            sqlx::query("UPDATE monitors SET url = $1 WHERE id = $2")
                .bind(u)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(m) = method {
            sqlx::query("UPDATE monitors SET method = $1 WHERE id = $2")
                .bind(m)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(i) = interval_seconds {
            sqlx::query("UPDATE monitors SET interval_seconds = $1 WHERE id = $2")
                .bind(i)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(t) = timeout_ms {
            sqlx::query("UPDATE monitors SET timeout_ms = $1 WHERE id = $2")
                .bind(t)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(e) = expected_status {
            sqlx::query("UPDATE monitors SET expected_status = $1 WHERE id = $2")
                .bind(e)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(h) = headers {
            sqlx::query("UPDATE monitors SET headers = $1 WHERE id = $2")
                .bind(h)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(b) = body {
            sqlx::query("UPDATE monitors SET body = $1 WHERE id = $2")
                .bind(b)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(a) = is_active {
            sqlx::query("UPDATE monitors SET is_active = $1 WHERE id = $2")
                .bind(a)
                .bind(id)
                .execute(pool)
                .await?;
        }

        Self::find_by_id(pool, id)
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
        checked_at: &str,
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
        let now = chrono::Utc::now().to_rfc3339();

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
        .bind(&now)
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
        let stats: (i64, i64, Option<f64>) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
                AVG(response_time_ms) as avg_response
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

    pub async fn cleanup_old_checks(pool: &DbPool, days: i32) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM monitor_checks WHERE checked_at < NOW() - INTERVAL '1 day' * $1",
        )
        .bind(days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
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
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query_as::<_, MonitorIncident>(
            r#"
            INSERT INTO monitor_incidents (id, monitor_id, started_at, cause, created_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(monitor_id)
        .bind(&now)
        .bind(cause)
        .bind(&now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn resolve(pool: &DbPool, id: &str) -> Result<MonitorIncident> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query_as::<_, MonitorIncident>(
            r#"
            UPDATE monitor_incidents
            SET resolved_at = $1
            WHERE id = $2
            RETURNING *
            "#,
        )
        .bind(&now)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_open_by_monitor(pool: &DbPool, monitor_id: &str) -> Result<Option<MonitorIncident>> {
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
