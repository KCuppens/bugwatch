use crate::db::{models::LogAlertRule, DbPool};
use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

pub struct LogAlertRuleRepository;

impl LogAlertRuleRepository {
    // ── Write ────────────────────────────────────────────────────────────────

    /// Create a new log alert rule.
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &DbPool,
        project_id: &str,
        name: &str,
        level_filter: Option<&str>,
        search_filter: Option<&str>,
        threshold: i32,
        window_seconds: i32,
        notification_type: &str,
        notification_target: &str,
    ) -> Result<LogAlertRule> {
        if threshold < 1 {
            return Err(anyhow::anyhow!("threshold must be >= 1"));
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, LogAlertRule>(
            r#"
            INSERT INTO log_alert_rules
                (id, project_id, name, level_filter, search_filter,
                 threshold, window_seconds, notification_type, notification_target,
                 is_active, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(level_filter)
        .bind(search_filter)
        .bind(threshold)
        .bind(window_seconds)
        .bind(notification_type)
        .bind(notification_target)
        .bind(now.to_rfc3339())
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /// List all alert rules for a project, newest first.
    pub async fn list(pool: &DbPool, project_id: &str) -> Result<Vec<LogAlertRule>> {
        sqlx::query_as::<_, LogAlertRule>(
            r#"
            SELECT * FROM log_alert_rules
            WHERE project_id = $1
            ORDER BY created_at DESC
            LIMIT 1000
            "#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// List all active rules across all projects (used by the alerting scheduler).
    pub async fn get_active_rules(pool: &DbPool) -> Result<Vec<LogAlertRule>> {
        sqlx::query_as::<_, LogAlertRule>(
            r#"
            SELECT * FROM log_alert_rules
            WHERE is_active = TRUE
            ORDER BY created_at ASC
            LIMIT 5000
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    // ── Write — update ───────────────────────────────────────────────────────

    /// Update mutable fields on an alert rule.  `None` fields are left unchanged.
    /// Returns `None` if the rule does not exist or belongs to a different project.
    #[allow(clippy::too_many_arguments)]
    pub async fn update(
        pool: &DbPool,
        id: &str,
        project_id: &str,
        name: Option<&str>,
        level_filter: Option<Option<&str>>,
        search_filter: Option<Option<&str>>,
        threshold: Option<i32>,
        window_seconds: Option<i32>,
        notification_type: Option<&str>,
        notification_target: Option<&str>,
        is_active: Option<bool>,
    ) -> Result<Option<LogAlertRule>> {
        if let Some(t) = threshold {
            if t < 1 {
                return Err(anyhow::anyhow!("threshold must be >= 1"));
            }
        }

        // COALESCE-based single-round-trip UPDATE
        sqlx::query_as::<_, LogAlertRule>(
            r#"
            UPDATE log_alert_rules
            SET
                name               = COALESCE($1,  name),
                level_filter       = CASE WHEN $2  THEN $3  ELSE level_filter  END,
                search_filter      = CASE WHEN $4  THEN $5  ELSE search_filter END,
                threshold          = COALESCE($6,  threshold),
                window_seconds     = COALESCE($7,  window_seconds),
                notification_type  = COALESCE($8,  notification_type),
                notification_target= COALESCE($9,  notification_target),
                is_active          = COALESCE($10, is_active)
            WHERE id = $11 AND project_id = $12
            RETURNING *
            "#,
        )
        .bind(name)
        .bind(level_filter.is_some()) // $2 — sentinel: update level_filter?
        .bind(level_filter.and_then(|v| v)) // $3 — new value (possibly NULL)
        .bind(search_filter.is_some()) // $4
        .bind(search_filter.and_then(|v| v)) // $5
        .bind(threshold)
        .bind(window_seconds)
        .bind(notification_type)
        .bind(notification_target)
        .bind(is_active)
        .bind(id)
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    // ── Write — delete ───────────────────────────────────────────────────────

    /// Delete a rule by id, scoped to project_id.
    /// Returns `true` if a row was deleted.
    pub async fn delete(pool: &DbPool, id: &str, project_id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM log_alert_rules WHERE id = $1 AND project_id = $2")
            .bind(id)
            .bind(project_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    // ── Write — scheduling helpers ────────────────────────────────────────────

    /// Record that an alert rule fired right now.
    pub async fn update_last_fired(pool: &DbPool, id: &str) -> Result<()> {
        let now = Utc::now();
        sqlx::query("UPDATE log_alert_rules SET last_fired_at = $1 WHERE id = $2")
            .bind(now.to_rfc3339())
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Count logs that match the rule's criteria within its rolling time window.
    /// Used by the alerting scheduler to decide whether to fire.
    ///
    /// NOTE: Uses PostgreSQL ILIKE and INTERVAL — PG-only.
    pub async fn count_matching_logs(pool: &DbPool, rule: &LogAlertRule) -> Result<i64> {
        // Build SQL dynamically so we can optionally add level / search filters
        // without leaving dead parameter slots.
        let window_start = Utc::now() - chrono::Duration::seconds(rule.window_seconds as i64);

        let mut conditions = vec![
            "project_id = $1".to_string(),
            "created_at >= $2".to_string(),
        ];
        let mut extra_str_bindings: Vec<String> = vec![];
        let mut param_idx: usize = 3;

        if let Some(ref level) = rule.level_filter {
            conditions.push(format!("level = ${}", param_idx));
            extra_str_bindings.push(level.clone());
            param_idx += 1;
        }

        if let Some(ref search) = rule.search_filter {
            conditions.push(format!("message ILIKE ${}", param_idx));
            extra_str_bindings.push(format!("%{}%", search));
            // param_idx would increment here but it's the last dynamic param
        }

        let sql = format!(
            "SELECT COUNT(*) FROM logs WHERE {}",
            conditions.join(" AND ")
        );

        let mut q = sqlx::query_as::<_, (i64,)>(&sql)
            .bind(&rule.project_id)
            .bind(window_start.to_rfc3339());

        for s in &extra_str_bindings {
            q = q.bind(s.as_str());
        }

        let (count,) = q.fetch_one(pool).await?;
        Ok(count)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    async fn create_rule(pool: &crate::db::DbPool, project: &str, name: &str) -> LogAlertRule {
        LogAlertRuleRepository::create(
            pool,
            project,
            name,
            Some("error"),
            None,
            5,
            300,
            "email",
            "ops@example.com",
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn create_and_list_rule() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-1", "High Error Rate").await;
        assert_eq!(rule.name, "High Error Rate");
        assert_eq!(rule.threshold, 5);
        assert!(*rule.is_active);

        let list = LogAlertRuleRepository::list(&pool, "proj-lar-1")
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, rule.id);
    }

    #[tokio::test]
    async fn list_is_scoped_to_project() {
        let pool = test_any_pool().await;
        create_rule(&pool, "proj-lar-a", "Rule A").await;
        create_rule(&pool, "proj-lar-b", "Rule B").await;

        let list_a = LogAlertRuleRepository::list(&pool, "proj-lar-a")
            .await
            .unwrap();
        assert_eq!(list_a.len(), 1);

        let list_b = LogAlertRuleRepository::list(&pool, "proj-lar-b")
            .await
            .unwrap();
        assert_eq!(list_b.len(), 1);
    }

    #[tokio::test]
    async fn delete_rule_returns_true() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-2", "To Delete").await;

        let deleted = LogAlertRuleRepository::delete(&pool, &rule.id, "proj-lar-2")
            .await
            .unwrap();
        assert!(deleted);

        let list = LogAlertRuleRepository::list(&pool, "proj-lar-2")
            .await
            .unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn delete_wrong_project_returns_false() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-3", "Protected").await;

        let deleted = LogAlertRuleRepository::delete(&pool, &rule.id, "proj-lar-wrong")
            .await
            .unwrap();
        assert!(!deleted);
    }

    #[tokio::test]
    async fn update_rule_name() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-4", "Old Name").await;

        let updated = LogAlertRuleRepository::update(
            &pool,
            &rule.id,
            "proj-lar-4",
            Some("New Name"),
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
        assert!(updated.is_some());
        assert_eq!(updated.unwrap().name, "New Name");
    }

    #[tokio::test]
    async fn update_is_active_to_false() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-5", "Disableable").await;

        let updated = LogAlertRuleRepository::update(
            &pool,
            &rule.id,
            "proj-lar-5",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(false),
        )
        .await
        .unwrap();
        assert!(updated.is_some());
        assert!(!*updated.unwrap().is_active);
    }

    #[tokio::test]
    async fn update_nonexistent_returns_none() {
        let pool = test_any_pool().await;
        let updated = LogAlertRuleRepository::update(
            &pool,
            "nonexistent-id",
            "proj-x",
            Some("Name"),
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
        assert!(updated.is_none());
    }

    #[tokio::test]
    async fn get_active_rules_excludes_inactive() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-6", "Active One").await;
        create_rule(&pool, "proj-lar-6", "Also Active").await;

        // Deactivate the first rule
        LogAlertRuleRepository::update(
            &pool,
            &rule.id,
            "proj-lar-6",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(false),
        )
        .await
        .unwrap();

        let active = LogAlertRuleRepository::get_active_rules(&pool)
            .await
            .unwrap();
        // At least "Also Active" should be present; none of the inactive ones
        assert!(active.iter().all(|r| *r.is_active));
    }

    #[tokio::test]
    async fn update_last_fired_succeeds() {
        let pool = test_any_pool().await;
        let rule = create_rule(&pool, "proj-lar-7", "Fired Rule").await;
        // Should complete without error
        LogAlertRuleRepository::update_last_fired(&pool, &rule.id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn create_threshold_zero_returns_error() {
        let pool = test_any_pool().await;
        let result = LogAlertRuleRepository::create(
            &pool,
            "proj-lar-8",
            "Bad",
            None,
            None,
            0,
            300,
            "email",
            "x@x.com",
        )
        .await;
        assert!(result.is_err());
    }
}
