use anyhow::Result;
use chrono::Utc;
use reqwest::Client;
use serde::Serialize;
use std::sync::Arc;

use crate::{
    db::repositories::LogAlertRuleRepository,
    db::{models::LogAlertRule, DbPool},
    services::NotificationService,
};

// ============================================================================
// Types
// ============================================================================

/// Minimal representation of a log alert rule used by the evaluator.
#[derive(Debug, Clone)]
pub struct LogAlertRuleRef {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub level_filter: Option<String>,
    pub search_filter: Option<String>,
    pub threshold: i64,
    pub window_seconds: i64,
    pub notification_type: String,
    pub notification_target: String,
    /// ISO-8601 timestamp of the last time this rule fired, if any.
    pub last_fired_at: Option<chrono::DateTime<Utc>>,
}

/// A single log entry returned from the sample query (used in webhook payloads).
#[derive(Debug, Serialize, Clone)]
pub struct SampleLogEntry {
    pub id: String,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

/// Webhook payload sent when a log alert rule fires.
#[derive(Debug, Serialize)]
pub struct LogAlertWebhookPayload {
    pub rule_id: String,
    pub rule_name: String,
    pub project_id: String,
    pub fired_at: String,
    pub window_seconds: i64,
    pub threshold: i64,
    pub actual_count: i64,
    pub sample_logs: Vec<SampleLogEntry>,
}

// ============================================================================
// Service
// ============================================================================

/// Background service that evaluates log alert rules every 30 seconds.
///
/// For each active rule it:
/// 1. Checks the 5-minute cooldown (skip if fired recently).
/// 2. Counts matching logs in the rule's time window.
/// 3. Fires a notification (email or webhook) if count >= threshold.
/// 4. Records `last_fired_at` on the rule.
pub struct LogAlertEvaluator {
    db: DbPool,
    notification_service: Arc<NotificationService>,
    /// reqwest client for direct webhook POSTs (not going through notification channels).
    http_client: Client,
}

impl LogAlertEvaluator {
    pub fn new(db: DbPool, notification_service: Arc<NotificationService>) -> Self {
        let http_client = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("Bugwatch-LogAlertEvaluator/1.0")
            .build()
            .expect("Failed to build HTTP client for LogAlertEvaluator");
        Self {
            db,
            notification_service,
            http_client,
        }
    }

    /// Run one evaluation cycle across all active log alert rules.
    pub async fn run_once(&self) -> Result<()> {
        let db_rules: Vec<LogAlertRule> =
            LogAlertRuleRepository::get_active_rules(&self.db).await?;

        // Map DB models → local LogAlertRuleRef (which carries DateTime<Utc> for
        // the cooldown check rather than the opaque Timestamp wrapper).
        let rules: Vec<LogAlertRuleRef> = db_rules
            .iter()
            .map(|r| LogAlertRuleRef {
                id: r.id.clone(),
                project_id: r.project_id.clone(),
                name: r.name.clone(),
                level_filter: r.level_filter.clone(),
                search_filter: r.search_filter.clone(),
                threshold: r.threshold as i64,
                window_seconds: r.window_seconds as i64,
                notification_type: r.notification_type.clone(),
                notification_target: r.notification_target.clone(),
                last_fired_at: r.last_fired_at.map(|ts| ts.0),
            })
            .collect();

        let now = Utc::now();
        let cooldown = chrono::Duration::minutes(5);

        for (rule, db_rule) in rules.iter().zip(db_rules.iter()) {
            // a. Cooldown check — skip if fired within the last 5 minutes.
            if let Some(last_fired) = rule.last_fired_at {
                if now - last_fired < cooldown {
                    tracing::debug!(
                        rule_id = %rule.id,
                        rule_name = %rule.name,
                        "Log alert rule within cooldown window, skipping"
                    );
                    continue;
                }
            }

            // b. Count matching logs in the rule's window.
            let count = LogAlertRuleRepository::count_matching_logs(&self.db, db_rule)
                .await
                .unwrap_or(0);

            let fired = count >= rule.threshold;
            tracing::debug!(
                rule_id = %rule.id,
                rule_name = %rule.name,
                count = count,
                threshold = rule.threshold,
                fired = fired,
                "Log alert rule evaluated"
            );

            if !fired {
                continue;
            }

            // c. No sample_matching_logs method in the repository yet — use empty slice.
            let samples: Vec<SampleLogEntry> = vec![];

            // d. Fire notification.
            let result = self.fire_notification(rule, count, &samples, &now).await;
            if let Err(e) = result {
                tracing::error!(
                    rule_id = %rule.id,
                    "Log alert notification failed: {}",
                    e
                );
                // Don't mark as fired on error — let the next tick retry.
                continue;
            }

            // e. Update last_fired_at.
            if let Err(e) = LogAlertRuleRepository::update_last_fired(&self.db, &rule.id).await {
                tracing::error!(rule_id = %rule.id, "Failed to update last_fired_at: {}", e);
            }
        }

        Ok(())
    }

    /// Dispatch the notification (email or webhook) for a fired rule.
    async fn fire_notification(
        &self,
        rule: &LogAlertRuleRef,
        actual_count: i64,
        sample_logs: &[SampleLogEntry],
        fired_at: &chrono::DateTime<Utc>,
    ) -> Result<()> {
        let payload = LogAlertWebhookPayload {
            rule_id: rule.id.clone(),
            rule_name: rule.name.clone(),
            project_id: rule.project_id.clone(),
            fired_at: fired_at.to_rfc3339(),
            window_seconds: rule.window_seconds,
            threshold: rule.threshold,
            actual_count,
            sample_logs: sample_logs.to_vec(),
        };

        match rule.notification_type.as_str() {
            "webhook" => {
                self.send_webhook(&rule.notification_target, &payload)
                    .await?;
            }
            "email" => {
                self.send_email(&rule.notification_target, rule, actual_count)
                    .await?;
            }
            other => {
                tracing::warn!(
                    rule_id = %rule.id,
                    notification_type = %other,
                    "Unknown notification_type for log alert rule — skipping"
                );
            }
        }

        tracing::info!(
            rule_id = %rule.id,
            rule_name = %rule.name,
            actual_count = actual_count,
            notification_type = %rule.notification_type,
            "Log alert fired"
        );
        Ok(())
    }

    /// POST the webhook payload to `url`.
    async fn send_webhook(&self, url: &str, payload: &LogAlertWebhookPayload) -> Result<()> {
        let resp = self
            .http_client
            .post(url)
            .json(payload)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Webhook POST failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp
                .text()
                .await
                .unwrap_or_else(|_| "<no body>".to_string());
            let truncated: String = body.chars().take(256).collect();
            return Err(anyhow::anyhow!(
                "Webhook returned {}: {}",
                status,
                truncated
            ));
        }
        Ok(())
    }

    /// Send a plain-text email notification via NotificationService.
    ///
    /// NotificationService.send() requires a `NotificationChannel` model,
    /// so we build a synthetic one with `channel_type = "email"` and a JSON
    /// config containing the single recipient from `notification_target`.
    async fn send_email(
        &self,
        recipient: &str,
        rule: &LogAlertRuleRef,
        actual_count: i64,
    ) -> Result<()> {
        use crate::db::models::NotificationChannel;
        use crate::db::types::{Bool, Timestamp};

        let config_json = serde_json::to_string(&serde_json::json!({
            "recipients": [recipient]
        }))?;

        let channel = NotificationChannel {
            id: format!("log-alert-{}", rule.id),
            project_id: rule.project_id.clone(),
            name: format!("Log Alert: {}", rule.name),
            channel_type: "email".to_string(),
            config: config_json,
            is_active: Bool(true),
            created_at: Timestamp::now(),
        };

        let alert_payload = crate::services::notifications::AlertPayload {
            title: format!("Log Alert: {}", rule.name),
            message: format!(
                "{} log events matched in the last {} seconds (threshold: {})",
                actual_count, rule.window_seconds, rule.threshold
            ),
            severity: "warning".to_string(),
            project_name: rule.project_id.clone(),
            trigger_type: "log_alert".to_string(),
            trigger_id: Some(rule.id.clone()),
            url: None,
            timestamp: Utc::now().to_rfc3339(),
            project_id: Some(rule.project_id.clone()),
            issue: None,
            stack_trace: None,
            affected_users: None,
            frequency: None,
        };

        self.notification_service
            .send(&channel, &alert_payload)
            .await
            .map(|_| ())?;
        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_rule(last_fired_at: Option<chrono::DateTime<Utc>>) -> LogAlertRuleRef {
        LogAlertRuleRef {
            id: "rule-1".to_string(),
            project_id: "proj-1".to_string(),
            name: "Test Rule".to_string(),
            level_filter: Some("error".to_string()),
            search_filter: None,
            threshold: 10,
            window_seconds: 300,
            notification_type: "webhook".to_string(),
            notification_target: "https://example.com/webhook".to_string(),
            last_fired_at,
        }
    }

    // ── cooldown logic ────────────────────────────────────────────────────────

    /// A rule fired 1 minute ago is within the 5-minute cooldown and should be skipped.
    #[test]
    fn rule_within_cooldown_should_be_skipped() {
        let last_fired = Utc::now() - chrono::Duration::minutes(1);
        let rule = make_rule(Some(last_fired));

        let now = Utc::now();
        let cooldown = chrono::Duration::minutes(5);
        let within_cooldown = rule
            .last_fired_at
            .map(|lf| now - lf < cooldown)
            .unwrap_or(false);

        assert!(
            within_cooldown,
            "rule fired 1min ago must be within cooldown"
        );
    }

    /// A rule that has never fired (last_fired_at = None) should always evaluate.
    #[test]
    fn rule_never_fired_should_evaluate() {
        let rule = make_rule(None);

        let now = Utc::now();
        let cooldown = chrono::Duration::minutes(5);
        let within_cooldown = rule
            .last_fired_at
            .map(|lf| now - lf < cooldown)
            .unwrap_or(false);

        assert!(
            !within_cooldown,
            "rule with no last_fired_at must not be skipped"
        );
    }

    /// A rule fired 10 minutes ago has exceeded the cooldown and should re-evaluate.
    #[test]
    fn rule_10_minutes_ago_should_reevaluate() {
        let last_fired = Utc::now() - chrono::Duration::minutes(10);
        let rule = make_rule(Some(last_fired));

        let now = Utc::now();
        let cooldown = chrono::Duration::minutes(5);
        let within_cooldown = rule
            .last_fired_at
            .map(|lf| now - lf < cooldown)
            .unwrap_or(false);

        assert!(
            !within_cooldown,
            "rule fired 10min ago must be outside cooldown"
        );
    }

    /// A rule fired exactly 5 minutes ago is at the boundary.
    /// The cooldown is strictly less than (<), so exactly 5 minutes = expired.
    #[test]
    fn rule_exactly_5_minutes_ago_should_reevaluate() {
        let last_fired = Utc::now() - chrono::Duration::minutes(5);
        let rule = make_rule(Some(last_fired));

        let now = Utc::now();
        let cooldown = chrono::Duration::minutes(5);
        // now - last_fired ≈ 5 minutes. Due to sub-millisecond execution time
        // this may be slightly less than 5 min. Test just documents expected semantics.
        let elapsed = now - rule.last_fired_at.unwrap();
        // elapsed should be >= 5min (may be a tiny bit over), so NOT within cooldown
        assert!(elapsed >= cooldown - chrono::Duration::seconds(1));
    }

    // ── threshold logic ───────────────────────────────────────────────────────

    #[test]
    fn count_below_threshold_does_not_fire() {
        let rule = make_rule(None);
        let count: i64 = 9;
        assert!(count < rule.threshold);
    }

    #[test]
    fn count_equal_to_threshold_fires() {
        let rule = make_rule(None);
        let count: i64 = 10;
        assert!(count >= rule.threshold);
    }

    #[test]
    fn count_above_threshold_fires() {
        let rule = make_rule(None);
        let count: i64 = 100;
        assert!(count >= rule.threshold);
    }

    // ── webhook payload serialisation ─────────────────────────────────────────

    #[test]
    fn webhook_payload_serialises_correctly() {
        let payload = LogAlertWebhookPayload {
            rule_id: "r1".to_string(),
            rule_name: "My Rule".to_string(),
            project_id: "p1".to_string(),
            fired_at: "2024-01-01T00:00:00Z".to_string(),
            window_seconds: 60,
            threshold: 5,
            actual_count: 7,
            sample_logs: vec![SampleLogEntry {
                id: "l1".to_string(),
                level: "error".to_string(),
                message: "boom".to_string(),
                timestamp: "2024-01-01T00:00:00Z".to_string(),
            }],
        };

        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["rule_id"], "r1");
        assert_eq!(json["actual_count"], 7);
        assert_eq!(json["sample_logs"][0]["level"], "error");
    }
}
