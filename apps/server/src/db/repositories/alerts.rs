use crate::db::{models::{AlertRule, NotificationChannel, AlertLog, EmailRateLimit}, DbPool};
use chrono::{DateTime, Utc};
use anyhow::Result;
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
            "SELECT * FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_active_by_project(pool: &DbPool, project_id: &str) -> Result<Vec<AlertRule>> {
        sqlx::query_as::<_, AlertRule>(
            "SELECT * FROM alert_rules WHERE project_id = $1 AND is_active = TRUE ORDER BY created_at DESC",
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
        if let Some(n) = name {
            sqlx::query("UPDATE alert_rules SET name = $1 WHERE id = $2")
                .bind(n)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(c) = condition {
            sqlx::query("UPDATE alert_rules SET condition = $1 WHERE id = $2")
                .bind(c)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(a) = actions {
            sqlx::query("UPDATE alert_rules SET actions = $1 WHERE id = $2")
                .bind(a)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(active) = is_active {
            sqlx::query("UPDATE alert_rules SET is_active = $1 WHERE id = $2")
                .bind(active)
                .bind(id)
                .execute(pool)
                .await?;
        }

        Self::find_by_id(pool, id)
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
        sqlx::query_as::<_, NotificationChannel>("SELECT * FROM notification_channels WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn list_by_project(pool: &DbPool, project_id: &str) -> Result<Vec<NotificationChannel>> {
        sqlx::query_as::<_, NotificationChannel>(
            "SELECT * FROM notification_channels WHERE project_id = $1 ORDER BY created_at DESC",
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
        if let Some(n) = name {
            sqlx::query("UPDATE notification_channels SET name = $1 WHERE id = $2")
                .bind(n)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(c) = config {
            sqlx::query("UPDATE notification_channels SET config = $1 WHERE id = $2")
                .bind(c)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(active) = is_active {
            sqlx::query("UPDATE notification_channels SET is_active = $1 WHERE id = $2")
                .bind(active)
                .bind(id)
                .execute(pool)
                .await?;
        }

        Self::find_by_id(pool, id)
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
        sqlx::query("UPDATE alert_logs SET status = 'sent', sent_at = $1 WHERE id = $2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn mark_failed(pool: &DbPool, id: &str, error: &str) -> Result<()> {
        sqlx::query("UPDATE alert_logs SET status = 'failed', error_message = $1 WHERE id = $2")
            .bind(error)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn list_by_project(
        pool: &DbPool,
        project_id: &str,
        limit: u32,
    ) -> Result<Vec<AlertLog>> {
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
        .bind(limit as i64)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn list_by_rule(pool: &DbPool, rule_id: &str, limit: u32) -> Result<Vec<AlertLog>> {
        sqlx::query_as::<_, AlertLog>(
            r#"
            SELECT * FROM alert_logs
            WHERE alert_rule_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(rule_id)
        .bind(limit as i64)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Cleanup old alert logs to prevent database bloat
    pub async fn cleanup_old_logs(pool: &DbPool, days: i32) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM alert_logs WHERE created_at < NOW() - INTERVAL '1 day' * $1",
        )
        .bind(days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
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

        let result = sqlx::query_as::<_, EmailRateLimit>(
            r#"
            SELECT * FROM email_rate_limits
            WHERE project_id = $1 AND issue_fingerprint = $2 AND channel_id = $3
            AND last_sent_at > NOW() - INTERVAL '1 minute' * $4
            "#,
        )
        .bind(project_id)
        .bind(issue_fingerprint)
        .bind(channel_id)
        .bind(cooldown_minutes)
        .fetch_optional(pool)
        .await?;

        Ok(result.map(|r| r.last_sent_at))
    }

    /// Record that an email was sent
    pub async fn record_sent(
        pool: &DbPool,
        project_id: &str,
        issue_fingerprint: &str,
        channel_id: &str,
    ) -> Result<()> {
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO email_rate_limits (id, project_id, issue_fingerprint, channel_id, last_sent_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (project_id, issue_fingerprint, channel_id)
            DO UPDATE SET last_sent_at = NOW()
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(issue_fingerprint)
        .bind(channel_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Cleanup old rate limit records (older than 24 hours)
    pub async fn cleanup_old_records(pool: &DbPool) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM email_rate_limits WHERE last_sent_at < NOW() - INTERVAL '24 hours'",
        )
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }
}
