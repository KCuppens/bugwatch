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
        .bind(now.to_rfc3339())
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

    #[allow(dead_code)]
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

    /// Count total monitors across all projects belonging to an organization.
    /// Used for agent-auth limit enforcement so the count is scoped to the org
    /// rather than to a single user's projects.
    pub async fn count_by_organization(pool: &DbPool, organization_id: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM monitors m
            JOIN projects p ON m.project_id = p.id
            WHERE p.organization_id = $1
            "#,
        )
        .bind(organization_id)
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
            "SELECT * FROM monitors WHERE is_active = 1 ORDER BY created_at DESC",
        )
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Atomically claim up to `batch_size` monitors that are due for a health check.
    /// Sets `last_checked_at = CURRENT_TIMESTAMP` so concurrent workers skip claimed rows.
    pub async fn claim_due_monitors(pool: &DbPool, batch_size: i32) -> Result<Vec<Monitor>> {
        sqlx::query_as::<_, Monitor>(
            r#"
            UPDATE monitors
            SET last_checked_at = CURRENT_TIMESTAMP
            WHERE id IN (
                SELECT id FROM monitors
                WHERE is_active = TRUE
                  AND (
                      last_checked_at IS NULL
                      OR (julianday(CURRENT_TIMESTAMP) - julianday(last_checked_at)) * 86400.0 >= interval_seconds
                  )
                ORDER BY last_checked_at ASC
                LIMIT $1
            )
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

        let placeholders = project_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT * FROM monitors WHERE project_id IN ({}) AND is_active = TRUE ORDER BY current_status ASC, name ASC",
            placeholders
        );
        let mut q = sqlx::query_as::<_, Monitor>(&sql);
        for pid in project_ids {
            q = q.bind(pid);
        }
        q.fetch_all(pool).await.map_err(Into::into)
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
            .bind(checked_at.to_rfc3339())
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
        .bind(now.to_rfc3339())
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
        let cutoff = (chrono::Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339();
        let stats: (i64, i64, Option<f64>) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END), 0) as up_count,
                AVG(response_time_ms) as avg_response
            FROM monitor_checks
            WHERE monitor_id = $1
            AND checked_at >= $2
            "#,
        )
        .bind(monitor_id)
        .bind(&cutoff)
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

        let cutoff = (chrono::Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339();
        let n = monitor_ids.len();
        let placeholders = (1..=n)
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT
                monitor_id,
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END), 0) as up_count,
                AVG(response_time_ms) as avg_response
            FROM monitor_checks
            WHERE monitor_id IN ({})
              AND checked_at >= ${}
            GROUP BY monitor_id
            "#,
            placeholders,
            n + 1
        );
        let mut q = sqlx::query_as::<_, (String, i64, i64, Option<f64>)>(&sql);
        for mid in monitor_ids {
            q = q.bind(mid);
        }
        let rows = q.bind(&cutoff).fetch_all(pool).await?;

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

        let n = monitor_ids.len();
        let placeholders = (1..=n)
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT monitor_id, error_message
            FROM monitor_checks mc1
            WHERE monitor_id IN ({})
              AND status = 'down'
              AND error_message IS NOT NULL
              AND checked_at = (
                  SELECT MAX(checked_at) FROM monitor_checks mc2
                  WHERE mc2.monitor_id = mc1.monitor_id AND mc2.status = 'down'
              )
            "#,
            placeholders
        );
        let mut q = sqlx::query_as::<_, (String, String)>(&sql);
        for mid in monitor_ids {
            q = q.bind(mid);
        }
        let rows = q.fetch_all(pool).await?;

        Ok(rows.into_iter().collect())
    }

    pub async fn cleanup_old_checks(pool: &DbPool, days: i32) -> Result<u64> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(days as i64)).to_rfc3339();
        let result = sqlx::query("DELETE FROM monitor_checks WHERE checked_at < $1")
            .bind(&cutoff)
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
        .bind(now.to_rfc3339())
        .bind(cause)
        .bind(now.to_rfc3339())
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
        .bind(now.to_rfc3339())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    #[tokio::test]
    async fn create_and_find_monitor() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "proj-1",
            "Homepage",
            "https://example.com",
            "GET",
            60,
            5000,
            Some(200),
            "{}",
            None,
        )
        .await
        .unwrap();
        assert_eq!(m.name, "Homepage");
        assert_eq!(m.current_status, "unknown");

        let found = MonitorRepository::find_by_id(&pool, &m.id).await.unwrap();
        assert_eq!(found.unwrap().id, m.id);
    }

    #[tokio::test]
    async fn count_by_project() {
        let pool = test_any_pool().await;
        MonitorRepository::create(
            &pool,
            "pm",
            "M1",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorRepository::create(
            &pool,
            "pm",
            "M2",
            "http://b.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let count = MonitorRepository::count_by_project(&pool, "pm")
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn list_by_project_pagination() {
        let pool = test_any_pool().await;
        MonitorRepository::create(
            &pool,
            "pp",
            "M1",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorRepository::create(
            &pool,
            "pp",
            "M2",
            "http://b.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let (monitors, total) = MonitorRepository::list_by_project(&pool, "pp", 1, 10)
            .await
            .unwrap();
        assert_eq!(monitors.len(), 2);
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn update_monitor() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "pu",
            "Old",
            "http://old.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let updated = MonitorRepository::update(
            &pool,
            &m.id,
            Some("New"),
            Some("http://new.com"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(updated.name, "New");
        assert_eq!(updated.url, "http://new.com");
    }

    #[tokio::test]
    async fn delete_monitor() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "pd",
            "Del",
            "http://d.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorRepository::delete(&pool, &m.id).await.unwrap();
        assert!(MonitorRepository::find_by_id(&pool, &m.id)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn monitor_check_create_and_list() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "pc",
            "Check",
            "http://c.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "up", Some(120), Some(200), None)
            .await
            .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "down", None, Some(500), Some("timeout"))
            .await
            .unwrap();

        let checks = MonitorCheckRepository::list_by_monitor(&pool, &m.id, 10)
            .await
            .unwrap();
        assert_eq!(checks.len(), 2);
    }

    #[tokio::test]
    async fn get_uptime_stats() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "pus",
            "Stats",
            "http://s.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "up", Some(100), Some(200), None)
            .await
            .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "up", Some(110), Some(200), None)
            .await
            .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "down", None, Some(500), Some("err"))
            .await
            .unwrap();

        let (total, up, _avg) = MonitorCheckRepository::get_uptime_stats(&pool, &m.id, 24)
            .await
            .unwrap();
        assert_eq!(total, 3);
        assert_eq!(up, 2);
    }

    #[tokio::test]
    async fn incident_create_and_resolve() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "pi",
            "Inc",
            "http://i.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let inc = MonitorIncidentRepository::create(&pool, &m.id, Some("timeout"))
            .await
            .unwrap();
        assert!(inc.resolved_at.is_none());

        let open = MonitorIncidentRepository::find_open_by_monitor(&pool, &m.id)
            .await
            .unwrap();
        assert!(open.is_some());

        MonitorIncidentRepository::resolve(&pool, &inc.id)
            .await
            .unwrap();
        let open_after = MonitorIncidentRepository::find_open_by_monitor(&pool, &m.id)
            .await
            .unwrap();
        assert!(open_after.is_none());
    }

    #[tokio::test]
    async fn update_monitor_status() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "pst",
            "Status",
            "http://st.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorRepository::update_status(&pool, &m.id, "up", Utc::now())
            .await
            .unwrap();
        let updated = MonitorRepository::find_by_id(&pool, &m.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.current_status, "up");
    }

    #[tokio::test]
    async fn count_by_owner() {
        let pool = test_any_pool().await;
        sqlx::query("INSERT INTO projects (id, name, slug, api_key, api_key_hash, owner_id) VALUES (?, ?, ?, ?, '', ?)")
            .bind("proj-cbo").bind("P").bind("slug-cbo").bind("key-cbo").bind("owner-x")
            .execute(&pool).await.unwrap();
        MonitorRepository::create(
            &pool,
            "proj-cbo",
            "M",
            "http://x.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let count = MonitorRepository::count_by_owner(&pool, "owner-x")
            .await
            .unwrap();
        assert_eq!(count, 1);
        let zero = MonitorRepository::count_by_owner(&pool, "owner-none")
            .await
            .unwrap();
        assert_eq!(zero, 0);
    }

    #[tokio::test]
    async fn count_by_organization() {
        let pool = test_any_pool().await;
        sqlx::query("INSERT INTO projects (id, name, slug, api_key, api_key_hash, owner_id, organization_id) VALUES (?, ?, ?, ?, '', ?, ?)")
            .bind("proj-cborg").bind("P").bind("slug-cborg").bind("key-cborg").bind("u1").bind("org-x")
            .execute(&pool).await.unwrap();
        MonitorRepository::create(
            &pool,
            "proj-cborg",
            "M",
            "http://x.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let count = MonitorRepository::count_by_organization(&pool, "org-x")
            .await
            .unwrap();
        assert_eq!(count, 1);
        let zero = MonitorRepository::count_by_organization(&pool, "org-none")
            .await
            .unwrap();
        assert_eq!(zero, 0);
    }

    #[tokio::test]
    async fn list_active_monitors() {
        let pool = test_any_pool().await;
        MonitorRepository::create(
            &pool,
            "la-proj",
            "Active",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let all = MonitorRepository::list_active(&pool).await.unwrap();
        assert!(!all.is_empty());
        assert!(all.iter().any(|m| m.name == "Active"));
    }

    #[tokio::test]
    async fn list_active_across_projects_empty_input() {
        let pool = test_any_pool().await;
        let result = MonitorRepository::list_active_across_projects(&pool, &[])
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn list_active_across_projects_scoped() {
        let pool = test_any_pool().await;
        MonitorRepository::create(
            &pool,
            "laap-a",
            "Ma",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorRepository::create(
            &pool,
            "laap-b",
            "Mb",
            "http://b.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let ids = vec!["laap-a".to_string()];
        let result = MonitorRepository::list_active_across_projects(&pool, &ids)
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].project_id, "laap-a");
    }

    #[tokio::test]
    async fn batch_uptime_stats_empty_input() {
        let pool = test_any_pool().await;
        let result = MonitorCheckRepository::batch_uptime_stats(&pool, &[], 24)
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn batch_uptime_stats_with_data() {
        let pool = test_any_pool().await;
        let m1 = MonitorRepository::create(
            &pool,
            "bus-proj",
            "BUS1",
            "http://x.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let m2 = MonitorRepository::create(
            &pool,
            "bus-proj",
            "BUS2",
            "http://y.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorCheckRepository::create(&pool, &m1.id, "up", Some(100), Some(200), None)
            .await
            .unwrap();
        MonitorCheckRepository::create(&pool, &m1.id, "down", None, Some(500), Some("err"))
            .await
            .unwrap();
        MonitorCheckRepository::create(&pool, &m2.id, "up", Some(50), Some(200), None)
            .await
            .unwrap();
        let ids = vec![m1.id.clone(), m2.id.clone()];
        let stats = MonitorCheckRepository::batch_uptime_stats(&pool, &ids, 24)
            .await
            .unwrap();
        let (total1, up1, _) = stats[&m1.id];
        assert_eq!(total1, 2);
        assert_eq!(up1, 1);
        let (total2, up2, _) = stats[&m2.id];
        assert_eq!(total2, 1);
        assert_eq!(up2, 1);
    }

    #[tokio::test]
    async fn batch_last_errors_empty_input() {
        let pool = test_any_pool().await;
        let result = MonitorCheckRepository::batch_last_errors(&pool, &[])
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn batch_last_errors_with_down_check() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "ble-proj",
            "BLE",
            "http://z.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "down", None, Some(500), Some("conn refused"))
            .await
            .unwrap();
        let ids = vec![m.id.clone()];
        let errors = MonitorCheckRepository::batch_last_errors(&pool, &ids)
            .await
            .unwrap();
        assert_eq!(errors.get(&m.id).map(|s| s.as_str()), Some("conn refused"));
    }

    #[tokio::test]
    async fn cleanup_old_checks_noop() {
        let pool = test_any_pool().await;
        let deleted = MonitorCheckRepository::cleanup_old_checks(&pool, 30)
            .await
            .unwrap();
        assert_eq!(deleted, 0);
    }

    #[tokio::test]
    async fn get_last_error_no_checks() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "gle-proj",
            "GLE",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        let result = MonitorCheckRepository::get_last_error(&pool, &m.id)
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn get_last_error_returns_message() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "gler-proj",
            "GLER",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorCheckRepository::create(&pool, &m.id, "up", Some(100), Some(200), None)
            .await
            .unwrap();
        MonitorCheckRepository::create(
            &pool,
            &m.id,
            "down",
            None,
            Some(503),
            Some("service unavailable"),
        )
        .await
        .unwrap();
        let result = MonitorCheckRepository::get_last_error(&pool, &m.id)
            .await
            .unwrap();
        assert_eq!(result.as_deref(), Some("service unavailable"));
    }

    #[tokio::test]
    async fn incident_list_by_monitor() {
        let pool = test_any_pool().await;
        let m = MonitorRepository::create(
            &pool,
            "ilbm-proj",
            "ILBM",
            "http://a.com",
            "GET",
            60,
            5000,
            None,
            "{}",
            None,
        )
        .await
        .unwrap();
        MonitorIncidentRepository::create(&pool, &m.id, Some("first"))
            .await
            .unwrap();
        MonitorIncidentRepository::create(&pool, &m.id, Some("second"))
            .await
            .unwrap();
        let incidents = MonitorIncidentRepository::list_by_monitor(&pool, &m.id, 10)
            .await
            .unwrap();
        assert_eq!(incidents.len(), 2);
    }
}
