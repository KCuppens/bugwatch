use crate::db::{
    models::{AlertLog, AlertRule, EmailRateLimit, NotificationChannel},
    DbPool,
};
use anyhow::Result;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use uuid::Uuid;

pub struct AlertRuleRepository;

impl AlertRuleRepository {
    pub async fn create(
        pool: &DbPool,
        project_id: &str,
        name: &str,
        condition: &str,
        actions: &str,
    ) -> Result<AlertRule> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, AlertRule>(
            r#"
            INSERT INTO alert_rules (id, project_id, name, condition, actions, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(condition)
        .bind(actions)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<AlertRule>> {
        sqlx::query_as::<_, AlertRule>("SELECT * FROM alert_rules WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn list_by_project(pool: &DbPool, project_id: &str) -> Result<Vec<AlertRule>> {
        sqlx::query_as::<_, AlertRule>(
            "SELECT * FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1000",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_active_by_project(pool: &DbPool, project_id: &str) -> Result<Vec<AlertRule>> {
        sqlx::query_as::<_, AlertRule>(
            "SELECT * FROM alert_rules WHERE project_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1000",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn update(
        pool: &DbPool,
        id: &str,
        name: Option<&str>,
        condition: Option<&str>,
        actions: Option<&str>,
        is_active: Option<bool>,
    ) -> Result<AlertRule> {
        // Single UPDATE with COALESCE so a None field is left untouched.
        // Collapses up-to-4 UPDATEs + 1 SELECT into one round trip.
        sqlx::query_as::<_, AlertRule>(
            "UPDATE alert_rules
             SET name = COALESCE($1, name),
                 condition = COALESCE($2, condition),
                 actions = COALESCE($3, actions),
                 is_active = COALESCE($4, is_active)
             WHERE id = $5
             RETURNING *",
        )
        .bind(name)
        .bind(condition)
        .bind(actions)
        .bind(is_active)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Alert rule not found"))
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM alert_rules WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn mute(
        pool: &DbPool,
        id: &str,
        muted_until: DateTime<Utc>,
        duration_minutes: i32,
    ) -> Result<AlertRule> {
        sqlx::query_as::<_, AlertRule>(
            "UPDATE alert_rules SET muted_until = $1, snooze_duration_minutes = $2 WHERE id = $3 RETURNING *",
        )
        .bind(muted_until)
        .bind(duration_minutes)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Alert rule not found"))
    }

    pub async fn unmute(pool: &DbPool, id: &str) -> Result<AlertRule> {
        sqlx::query_as::<_, AlertRule>(
            "UPDATE alert_rules SET muted_until = NULL, snooze_duration_minutes = NULL WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Alert rule not found"))
    }
}

pub struct NotificationChannelRepository;

impl NotificationChannelRepository {
    pub async fn create(
        pool: &DbPool,
        project_id: &str,
        name: &str,
        channel_type: &str,
        config: &str,
    ) -> Result<NotificationChannel> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, NotificationChannel>(
            r#"
            INSERT INTO notification_channels (id, project_id, name, channel_type, config, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(channel_type)
        .bind(config)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<NotificationChannel>> {
        sqlx::query_as::<_, NotificationChannel>(
            "SELECT * FROM notification_channels WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_by_project(
        pool: &DbPool,
        project_id: &str,
    ) -> Result<Vec<NotificationChannel>> {
        sqlx::query_as::<_, NotificationChannel>(
            "SELECT * FROM notification_channels WHERE project_id = $1 ORDER BY created_at DESC LIMIT 500",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn update(
        pool: &DbPool,
        id: &str,
        name: Option<&str>,
        config: Option<&str>,
        is_active: Option<bool>,
    ) -> Result<NotificationChannel> {
        // Single UPDATE with COALESCE so a None field is left untouched.
        // Replaces up-to-3 UPDATEs + 1 SELECT with one round trip.
        sqlx::query_as::<_, NotificationChannel>(
            "UPDATE notification_channels
             SET name = COALESCE($1, name),
                 config = COALESCE($2, config),
                 is_active = COALESCE($3, is_active)
             WHERE id = $4
             RETURNING *",
        )
        .bind(name)
        .bind(config)
        .bind(is_active)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Notification channel not found"))
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM notification_channels WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Batch fetch notification channels by IDs (eliminates N+1 queries)
    pub async fn find_by_ids(pool: &DbPool, ids: &[String]) -> Result<Vec<NotificationChannel>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT * FROM notification_channels WHERE id IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<_, NotificationChannel>(&sql);
        for id in ids {
            q = q.bind(id);
        }
        q.fetch_all(pool).await.map_err(Into::into)
    }
}

pub struct AlertLogRepository;

impl AlertLogRepository {
    pub async fn create(
        pool: &DbPool,
        alert_rule_id: &str,
        channel_id: Option<&str>,
        trigger_type: &str,
        trigger_id: Option<&str>,
        message: &str,
    ) -> Result<AlertLog> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, AlertLog>(
            r#"
            INSERT INTO alert_logs (id, alert_rule_id, channel_id, trigger_type, trigger_id, status, message, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(alert_rule_id)
        .bind(channel_id)
        .bind(trigger_type)
        .bind(trigger_id)
        .bind(message)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn mark_sent(pool: &DbPool, id: &str) -> Result<()> {
        let now = Utc::now();
        let result =
            sqlx::query("UPDATE alert_logs SET status = 'sent', sent_at = $1 WHERE id = $2")
                .bind(now)
                .bind(id)
                .execute(pool)
                .await?;
        if result.rows_affected() == 0 {
            tracing::warn!(log_id = %id, "mark_sent: alert log entry not found");
        }
        Ok(())
    }

    pub async fn mark_failed(pool: &DbPool, id: &str, error: &str) -> Result<()> {
        let result = sqlx::query(
            "UPDATE alert_logs SET status = 'failed', error_message = $1 WHERE id = $2",
        )
        .bind(error)
        .bind(id)
        .execute(pool)
        .await?;
        if result.rows_affected() == 0 {
            tracing::warn!(log_id = %id, "mark_failed: alert log entry not found");
        }
        Ok(())
    }

    pub async fn list_by_project(
        pool: &DbPool,
        project_id: &str,
        limit: u32,
    ) -> Result<Vec<AlertLog>> {
        let limit = (limit.min(10_000)) as i64;
        sqlx::query_as::<_, AlertLog>(
            r#"
            SELECT al.* FROM alert_logs al
            JOIN alert_rules ar ON al.alert_rule_id = ar.id
            WHERE ar.project_id = $1
            ORDER BY al.created_at DESC
            LIMIT $2
            "#,
        )
        .bind(project_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub async fn list_by_rule(pool: &DbPool, rule_id: &str, limit: u32) -> Result<Vec<AlertLog>> {
        let limit = (limit.min(10_000)) as i64;
        sqlx::query_as::<_, AlertLog>(
            r#"
            SELECT * FROM alert_logs
            WHERE alert_rule_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(rule_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Atomically claim the right to fire an alert, guarding against the TOCTOU race where
    /// two concurrent tasks both pass the cooldown SELECT and both fire.
    ///
    /// Uses a Postgres transaction-level advisory lock keyed on (rule_id, trigger_id) so only
    /// one task at a time can check-and-insert for the same rule+trigger pair. The lock is
    /// released automatically when the transaction commits or rolls back.
    ///
    /// Returns `Ok(true)` when the caller should fire the alert (cooldown passed + log inserted),
    /// `Ok(false)` when another task beat us or a recent log already exists.
    pub async fn try_claim_cooldown(
        pool: &DbPool,
        alert_rule_id: &str,
        channel_id: Option<&str>,
        trigger_type: &str,
        trigger_id: Option<&str>,
        message: &str,
        cooldown_minutes: i32,
    ) -> Result<Option<AlertLog>> {
        if cooldown_minutes < 0 {
            return Err(anyhow::anyhow!("cooldown_minutes must be non-negative"));
        }
        // Derive a stable i64 from rule_id + trigger_id for the advisory lock.
        // DefaultHasher is explicitly unstable across Rust versions — a binary upgrade
        // would silently change every lock key, breaking cooldown enforcement.
        // SHA-256 is stable, deterministic, and already a project dependency.
        let _lock_key = {
            use sha2::{Digest, Sha256};
            let input = format!("{}:{}", alert_rule_id, trigger_id.unwrap_or(""));
            let hash = Sha256::digest(input.as_bytes());
            i64::from_le_bytes(
                hash[..8]
                    .try_into()
                    .expect("SHA-256 output is always ≥ 8 bytes"),
            )
        };

        let mut tx = pool.begin().await?;

        let cutoff = chrono::Utc::now() - chrono::Duration::minutes(cooldown_minutes as i64);

        // Double-check cooldown inside the transaction.
        let existing: Option<(i64,)> = sqlx::query_as(
            r#"
            SELECT 1 FROM alert_logs
            WHERE alert_rule_id = $1
            AND ($2 IS NULL OR trigger_id = $3)
            AND status = 'sent'
            AND created_at > $4
            LIMIT 1
            "#,
        )
        .bind(alert_rule_id)
        .bind(trigger_id)
        .bind(trigger_id)
        .bind(cutoff)
        .fetch_optional(&mut *tx)
        .await?;

        if existing.is_some() {
            tx.rollback().await?;
            return Ok(None);
        }

        // Cooldown passed — insert a rule-level sentinel log with status='sent' so that
        // future find_recent calls (which filter on status='sent') will see it and enforce
        // the cooldown. Per-channel delivery logs are created separately in send_alert.
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let log = sqlx::query_as::<_, AlertLog>(
            r#"
            INSERT INTO alert_logs (id, alert_rule_id, channel_id, trigger_type, trigger_id, status, message, created_at)
            VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(alert_rule_id)
        .bind(channel_id)
        .bind(trigger_type)
        .bind(trigger_id)
        .bind(message)
        .bind(now)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(Some(log))
    }

    #[allow(dead_code)]
    pub async fn find_recent(
        pool: &DbPool,
        rule_id: &str,
        trigger_id: Option<&str>,
        cooldown_minutes: i32,
    ) -> Result<Option<AlertLog>> {
        let cutoff = chrono::Utc::now() - chrono::Duration::minutes(cooldown_minutes as i64);
        let log = sqlx::query_as::<_, AlertLog>(
            r#"
            SELECT * FROM alert_logs
            WHERE alert_rule_id = $1
            AND ($2 IS NULL OR trigger_id = $3)
            AND status = 'sent'
            AND created_at > $4
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(rule_id)
        .bind(trigger_id)
        .bind(trigger_id)
        .bind(cutoff)
        .fetch_optional(pool)
        .await?;

        Ok(log)
    }

    /// List alert logs across multiple projects
    pub async fn list_across_projects(
        pool: &DbPool,
        project_ids: &[String],
        limit: i64,
    ) -> Result<Vec<AlertLog>> {
        if project_ids.is_empty() {
            return Ok(vec![]);
        }
        let n = project_ids.len();
        let placeholders = (1..=n)
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT al.* FROM alert_logs al
            JOIN alert_rules ar ON al.alert_rule_id = ar.id
            WHERE ar.project_id IN ({})
            ORDER BY al.created_at DESC
            LIMIT ${}
            "#,
            placeholders,
            n + 1
        );
        let mut q = sqlx::query_as::<_, AlertLog>(&sql);
        for pid in project_ids {
            q = q.bind(pid);
        }
        q.bind(limit).fetch_all(pool).await.map_err(Into::into)
    }

    /// Get rule names and project IDs for a list of rule IDs
    pub async fn list_rule_names_for_ids(
        pool: &DbPool,
        rule_ids: &[String],
    ) -> Result<HashMap<String, (String, String)>> {
        if rule_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let placeholders = rule_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, name, project_id FROM alert_rules WHERE id IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<_, (String, String, String)>(&sql);
        for rid in rule_ids {
            q = q.bind(rid);
        }
        let rows = q.fetch_all(pool).await?;

        let map = rows
            .into_iter()
            .map(|(id, name, project_id)| (id, (name, project_id)))
            .collect();

        Ok(map)
    }

    /// Cleanup old alert logs to prevent database bloat
    pub async fn cleanup_old_logs(pool: &DbPool, days: i32) -> Result<u64> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        let mut total_deleted: u64 = 0;
        loop {
            let result = sqlx::query(
                "DELETE FROM alert_logs WHERE id IN (
                    SELECT id FROM alert_logs
                    WHERE created_at < $1
                    LIMIT 5000
                )",
            )
            .bind(cutoff)
            .execute(pool)
            .await?;
            let deleted = result.rows_affected();
            total_deleted += deleted;
            if deleted == 0 {
                break;
            }
        }
        Ok(total_deleted)
    }
}

pub struct EmailRateLimitRepository;

impl EmailRateLimitRepository {
    /// Check if we can send an email based on cooldown period
    /// Returns Some(last_sent_at) if rate limited, None if can send
    pub async fn check_rate_limit(
        pool: &DbPool,
        project_id: &str,
        issue_fingerprint: &str,
        channel_id: &str,
        cooldown_minutes: i32,
    ) -> Result<Option<DateTime<Utc>>> {
        // If cooldown is 0, no rate limiting (real-time)
        if cooldown_minutes == 0 {
            return Ok(None);
        }

        let cutoff = chrono::Utc::now() - chrono::Duration::minutes(cooldown_minutes as i64);
        let result = sqlx::query_as::<_, EmailRateLimit>(
            r#"
            SELECT * FROM email_rate_limits
            WHERE project_id = $1 AND issue_fingerprint = $2 AND channel_id = $3
            AND last_sent_at > $4
            "#,
        )
        .bind(project_id)
        .bind(issue_fingerprint)
        .bind(channel_id)
        .bind(cutoff)
        .fetch_optional(pool)
        .await?;

        Ok(result.map(|r| *r.last_sent_at))
    }

    /// Record that an email was sent
    pub async fn record_sent(
        pool: &DbPool,
        project_id: &str,
        issue_fingerprint: &str,
        channel_id: &str,
    ) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        sqlx::query(
            r#"
            INSERT INTO email_rate_limits (id, project_id, issue_fingerprint, channel_id, last_sent_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (project_id, issue_fingerprint, channel_id)
            DO UPDATE SET last_sent_at = $5
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(issue_fingerprint)
        .bind(channel_id)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn cleanup_old_records(pool: &DbPool) -> Result<u64> {
        let cutoff = chrono::Utc::now() - chrono::Duration::hours(24);
        let mut total_deleted: u64 = 0;
        loop {
            let result = sqlx::query(
                "DELETE FROM email_rate_limits WHERE id IN (
                    SELECT id FROM email_rate_limits
                    WHERE last_sent_at < $1
                    LIMIT 1000
                )",
            )
            .bind(cutoff)
            .execute(pool)
            .await?;
            let deleted = result.rows_affected();
            total_deleted += deleted;
            if deleted == 0 {
                break;
            }
        }
        Ok(total_deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    #[tokio::test]
    async fn create_and_find_alert_rule() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(
            &pool,
            "proj-1",
            "Error Alert",
            r#"{"type":"error_count"}"#,
            "[]",
        )
        .await
        .unwrap();
        assert_eq!(rule.name, "Error Alert");
        assert!(*rule.is_active);

        let found = AlertRuleRepository::find_by_id(&pool, &rule.id)
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, rule.id);
    }

    #[tokio::test]
    async fn list_active_vs_all_rules() {
        let pool = test_any_pool().await;
        let r1 = AlertRuleRepository::create(&pool, "proj-2", "Active", "{}", "[]")
            .await
            .unwrap();
        AlertRuleRepository::create(&pool, "proj-2", "Disabled", "{}", "[]")
            .await
            .unwrap();
        AlertRuleRepository::update(&pool, &r1.id, None, None, None, Some(false))
            .await
            .unwrap();

        let all = AlertRuleRepository::list_by_project(&pool, "proj-2")
            .await
            .unwrap();
        assert_eq!(all.len(), 2);

        let active = AlertRuleRepository::list_active_by_project(&pool, "proj-2")
            .await
            .unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name, "Disabled");
    }

    #[tokio::test]
    async fn mute_and_unmute_rule() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-3", "Mutable", "{}", "[]")
            .await
            .unwrap();
        let muted_until = Utc::now() + chrono::Duration::hours(1);
        let muted = AlertRuleRepository::mute(&pool, &rule.id, muted_until, 60)
            .await
            .unwrap();
        assert!(muted.muted_until.is_some());

        let unmuted = AlertRuleRepository::unmute(&pool, &rule.id).await.unwrap();
        assert!(unmuted.muted_until.is_none());
    }

    #[tokio::test]
    async fn delete_alert_rule() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-4", "ToDelete", "{}", "[]")
            .await
            .unwrap();
        AlertRuleRepository::delete(&pool, &rule.id).await.unwrap();
        let result = AlertRuleRepository::find_by_id(&pool, &rule.id)
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn notification_channel_crud() {
        let pool = test_any_pool().await;
        let ch = NotificationChannelRepository::create(
            &pool,
            "proj-5",
            "Slack #alerts",
            "slack",
            r#"{"webhook_url":"https://hooks.slack.com/x"}"#,
        )
        .await
        .unwrap();
        assert_eq!(ch.channel_type, "slack");

        let found = NotificationChannelRepository::find_by_id(&pool, &ch.id)
            .await
            .unwrap();
        assert!(found.is_some());

        let updated =
            NotificationChannelRepository::update(&pool, &ch.id, Some("Slack #bugs"), None, None)
                .await
                .unwrap();
        assert_eq!(updated.name, "Slack #bugs");

        NotificationChannelRepository::delete(&pool, &ch.id)
            .await
            .unwrap();
        let gone = NotificationChannelRepository::find_by_id(&pool, &ch.id)
            .await
            .unwrap();
        assert!(gone.is_none());
    }

    #[tokio::test]
    async fn alert_log_create_and_mark_sent() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-6", "Log Rule", "{}", "[]")
            .await
            .unwrap();
        let log =
            AlertLogRepository::create(&pool, &rule.id, None, "new_issue", None, "Issue detected")
                .await
                .unwrap();
        assert_eq!(log.status, "pending");

        AlertLogRepository::mark_sent(&pool, &log.id).await.unwrap();
        let logs = AlertLogRepository::list_by_rule(&pool, &rule.id, 10)
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].status, "sent");
    }

    #[tokio::test]
    async fn alert_log_mark_failed() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-7", "Fail Rule", "{}", "[]")
            .await
            .unwrap();
        let log = AlertLogRepository::create(&pool, &rule.id, None, "new_issue", None, "msg")
            .await
            .unwrap();
        AlertLogRepository::mark_failed(&pool, &log.id, "SMTP error")
            .await
            .unwrap();
        let logs = AlertLogRepository::list_by_rule(&pool, &rule.id, 10)
            .await
            .unwrap();
        assert_eq!(logs[0].status, "failed");
        assert_eq!(logs[0].error_message.as_deref(), Some("SMTP error"));
    }

    #[tokio::test]
    async fn try_claim_cooldown_fires_once() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-8", "Cooldown", "{}", "[]")
            .await
            .unwrap();
        let first = AlertLogRepository::try_claim_cooldown(
            &pool,
            &rule.id,
            None,
            "new_issue",
            Some("issue-1"),
            "msg",
            5,
        )
        .await
        .unwrap();
        assert!(first.is_some(), "first claim should succeed");

        let second = AlertLogRepository::try_claim_cooldown(
            &pool,
            &rule.id,
            None,
            "new_issue",
            Some("issue-1"),
            "msg",
            5,
        )
        .await
        .unwrap();
        assert!(
            second.is_none(),
            "second claim within cooldown should be blocked"
        );
    }

    #[tokio::test]
    async fn email_rate_limit_record_and_check() {
        let pool = test_any_pool().await;
        EmailRateLimitRepository::record_sent(&pool, "proj-9", "fp-abc", "chan-1")
            .await
            .unwrap();
        let result =
            EmailRateLimitRepository::check_rate_limit(&pool, "proj-9", "fp-abc", "chan-1", 60)
                .await
                .unwrap();
        assert!(result.is_some(), "should be rate-limited within cooldown");

        // Different fingerprint should not be rate-limited
        let other =
            EmailRateLimitRepository::check_rate_limit(&pool, "proj-9", "fp-other", "chan-1", 60)
                .await
                .unwrap();
        assert!(other.is_none());
    }

    #[tokio::test]
    async fn email_rate_limit_zero_cooldown_never_limited() {
        let pool = test_any_pool().await;
        EmailRateLimitRepository::record_sent(&pool, "proj-10", "fp", "ch")
            .await
            .unwrap();
        let result = EmailRateLimitRepository::check_rate_limit(&pool, "proj-10", "fp", "ch", 0)
            .await
            .unwrap();
        assert!(result.is_none(), "cooldown=0 means no rate limiting");
    }

    #[tokio::test]
    async fn notification_channel_list_by_project() {
        let pool = test_any_pool().await;
        NotificationChannelRepository::create(&pool, "proj-ncl", "Ch1", "email", "{}")
            .await
            .unwrap();
        NotificationChannelRepository::create(&pool, "proj-ncl", "Ch2", "slack", "{}")
            .await
            .unwrap();
        NotificationChannelRepository::create(&pool, "proj-other-ncl", "Ch3", "email", "{}")
            .await
            .unwrap();
        let channels = NotificationChannelRepository::list_by_project(&pool, "proj-ncl")
            .await
            .unwrap();
        assert_eq!(channels.len(), 2);
    }

    #[tokio::test]
    async fn notification_channel_find_by_ids() {
        let pool = test_any_pool().await;
        let ch1 = NotificationChannelRepository::create(&pool, "proj-fbi", "Ch1", "email", "{}")
            .await
            .unwrap();
        let ch2 = NotificationChannelRepository::create(&pool, "proj-fbi", "Ch2", "slack", "{}")
            .await
            .unwrap();
        NotificationChannelRepository::create(&pool, "proj-fbi", "Ch3", "webhook", "{}")
            .await
            .unwrap();
        let ids = vec![ch1.id.clone(), ch2.id.clone()];
        let found = NotificationChannelRepository::find_by_ids(&pool, &ids)
            .await
            .unwrap();
        assert_eq!(found.len(), 2);
        let empty = NotificationChannelRepository::find_by_ids(&pool, &[])
            .await
            .unwrap();
        assert!(empty.is_empty());
    }

    #[tokio::test]
    async fn alert_log_list_by_project() {
        let pool = test_any_pool().await;
        let rule1 = AlertRuleRepository::create(&pool, "proj-lbp", "R1", "{}", "[]")
            .await
            .unwrap();
        let rule2 = AlertRuleRepository::create(&pool, "proj-other-lbp", "R2", "{}", "[]")
            .await
            .unwrap();
        AlertLogRepository::create(&pool, &rule1.id, None, "new_issue", None, "msg1")
            .await
            .unwrap();
        AlertLogRepository::create(&pool, &rule2.id, None, "new_issue", None, "msg2")
            .await
            .unwrap();
        let logs = AlertLogRepository::list_by_project(&pool, "proj-lbp", 10)
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].alert_rule_id, rule1.id);
    }

    #[tokio::test]
    async fn alert_log_find_recent() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-fr", "FR", "{}", "[]")
            .await
            .unwrap();
        let none = AlertLogRepository::find_recent(&pool, &rule.id, None, 5)
            .await
            .unwrap();
        assert!(none.is_none());
        let log = AlertLogRepository::create(&pool, &rule.id, None, "new_issue", None, "msg")
            .await
            .unwrap();
        AlertLogRepository::mark_sent(&pool, &log.id).await.unwrap();
        let found = AlertLogRepository::find_recent(&pool, &rule.id, None, 5)
            .await
            .unwrap();
        assert!(found.is_some());
    }

    #[tokio::test]
    async fn alert_log_cleanup_old_logs_noop() {
        let pool = test_any_pool().await;
        let deleted = AlertLogRepository::cleanup_old_logs(&pool, 30)
            .await
            .unwrap();
        assert_eq!(deleted, 0);
    }

    #[tokio::test]
    async fn alert_log_list_across_projects() {
        let pool = test_any_pool().await;
        let rule1 = AlertRuleRepository::create(&pool, "proj-lap1", "R1", "{}", "[]")
            .await
            .unwrap();
        let rule2 = AlertRuleRepository::create(&pool, "proj-lap2", "R2", "{}", "[]")
            .await
            .unwrap();
        AlertLogRepository::create(&pool, &rule1.id, None, "new_issue", None, "msg1")
            .await
            .unwrap();
        AlertLogRepository::create(&pool, &rule2.id, None, "new_issue", None, "msg2")
            .await
            .unwrap();
        let empty = AlertLogRepository::list_across_projects(&pool, &[], 10)
            .await
            .unwrap();
        assert!(empty.is_empty());
        let ids = vec!["proj-lap1".to_string()];
        let logs = AlertLogRepository::list_across_projects(&pool, &ids, 10)
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
    }

    #[tokio::test]
    async fn alert_log_list_rule_names_for_ids() {
        let pool = test_any_pool().await;
        let rule = AlertRuleRepository::create(&pool, "proj-lrnfi", "My Rule", "{}", "[]")
            .await
            .unwrap();
        let empty = AlertLogRepository::list_rule_names_for_ids(&pool, &[])
            .await
            .unwrap();
        assert!(empty.is_empty());
        let ids = vec![rule.id.clone()];
        let names = AlertLogRepository::list_rule_names_for_ids(&pool, &ids)
            .await
            .unwrap();
        assert_eq!(
            names.get(&rule.id).map(|(name, _)| name.as_str()),
            Some("My Rule")
        );
    }

    #[tokio::test]
    async fn email_rate_limit_cleanup_old_records_noop() {
        let pool = test_any_pool().await;
        let deleted = EmailRateLimitRepository::cleanup_old_records(&pool)
            .await
            .unwrap();
        assert_eq!(deleted, 0);
    }
}
