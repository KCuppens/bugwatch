use anyhow::Result;
use serde::Deserialize;
use tracing::{error, info};

use super::notifications::{AlertPayload, NotificationService};
use crate::db::{
    models::{AlertRule, Issue, Monitor, NotificationChannel, Project, ServerMetric},
    repositories::{
        AlertLogRepository, AlertRuleRepository, IssueRepository, NotificationChannelRepository,
        ProjectRepository, ServerRepository,
    },
    DbPool,
};

/// Alerting service for triggering and sending alerts
pub struct AlertingService {
    pool: DbPool,
    notification_service: NotificationService,
    app_url: String,
}

/// Alert condition types (deserialized from JSON)
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum AlertCondition {
    #[serde(rename = "new_issue")]
    NewIssue {
        #[serde(default)]
        level: Option<String>,
    },
    #[serde(rename = "issue_frequency")]
    IssueFrequency {
        #[allow(dead_code)]
        threshold: u32,
        #[allow(dead_code)]
        window_minutes: u32,
    },
    #[serde(rename = "monitor_down")]
    MonitorDown {
        #[serde(default)]
        monitor_id: Option<String>,
    },
    #[serde(rename = "monitor_recovery")]
    MonitorRecovery {
        #[serde(default)]
        monitor_id: Option<String>,
    },
    #[serde(rename = "server_cpu_high")]
    ServerCpuHigh {
        threshold_percent: f64,
        #[serde(default)]
        server_id: Option<String>,
    },
    #[serde(rename = "server_memory_high")]
    ServerMemoryHigh {
        threshold_percent: f64,
        #[serde(default)]
        server_id: Option<String>,
    },
    #[serde(rename = "server_disk_high")]
    ServerDiskHigh {
        threshold_percent: f64,
        #[serde(default)]
        mount: Option<String>,
        #[serde(default)]
        server_id: Option<String>,
    },
    #[serde(rename = "server_offline")]
    ServerOffline {
        #[allow(dead_code)]
        #[serde(default = "default_missing_minutes")]
        missing_minutes: u32,
        #[serde(default)]
        server_id: Option<String>,
    },
}

fn default_missing_minutes() -> u32 {
    5
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/// Load the project and its active alert rules. Returns `None` if the project
/// does not exist so callers can early-return without duplicating the DB calls.
async fn get_project_and_rules(
    pool: &DbPool,
    project_id: &str,
) -> Result<Option<(Project, Vec<AlertRule>)>> {
    let project = match ProjectRepository::find_by_id(pool, project_id).await? {
        Some(p) => p,
        None => return Ok(None),
    };
    let rules = AlertRuleRepository::list_active_by_project(pool, project_id).await?;
    Ok(Some((project, rules)))
}

/// Evaluate whether a metric reading matches a server-metric alert condition.
/// Returns `Some(alert_message)` on a match, `None` otherwise.
/// Accepts pre-parsed `disks` so the JSON is not deserialized once per rule.
fn evaluate_metric_condition(
    condition: &AlertCondition,
    server_db_id: &str,
    metric: &ServerMetric,
    hostname: &str,
    disks: &[serde_json::Value],
) -> Option<String> {
    match condition {
        AlertCondition::ServerCpuHigh {
            threshold_percent,
            server_id,
        } => {
            let applies = server_id.is_none() || server_id.as_deref() == Some(server_db_id);
            applies
                .then(|| metric.cpu_usage_percent)
                .flatten()
                .filter(|&cpu| cpu >= *threshold_percent)
                .map(|cpu| {
                    format!(
                        "CPU at {:.1}% on {} (threshold: {:.0}%)",
                        cpu, hostname, threshold_percent
                    )
                })
        }
        AlertCondition::ServerMemoryHigh {
            threshold_percent,
            server_id,
        } => {
            let applies = server_id.is_none() || server_id.as_deref() == Some(server_db_id);
            applies
                .then(|| metric.mem_usage_percent)
                .flatten()
                .filter(|&mem| mem >= *threshold_percent)
                .map(|mem| {
                    format!(
                        "Memory at {:.1}% on {} (threshold: {:.0}%)",
                        mem, hostname, threshold_percent
                    )
                })
        }
        AlertCondition::ServerDiskHigh {
            threshold_percent,
            mount,
            server_id,
        } => {
            let applies = server_id.is_none() || server_id.as_deref() == Some(server_db_id);
            if !applies {
                return None;
            }
            disks.iter().find_map(|disk| {
                let disk_mount = disk["mount"].as_str().unwrap_or("");
                let usage = disk["usage_percent"].as_f64().unwrap_or(0.0);
                let mount_matches = mount.is_none() || mount.as_deref() == Some(disk_mount);
                if mount_matches && usage >= *threshold_percent {
                    Some(format!(
                        "Disk {} at {:.1}% on {} (threshold: {:.0}%)",
                        disk_mount, usage, hostname, threshold_percent
                    ))
                } else {
                    None
                }
            })
        }
        _ => None,
    }
}

/// Parse a rule's condition JSON, logging a structured error and returning
/// `None` on failure so the caller can `continue` the rule loop cleanly.
fn parse_alert_condition(rule: &AlertRule) -> Option<AlertCondition> {
    match serde_json::from_str(&rule.condition) {
        Ok(c) => Some(c),
        Err(e) => {
            error!(rule_id = %rule.id, rule_name = %rule.name, "Failed to parse alert condition: {}", e);
            None
        }
    }
}

/// Send a notification with up to 3 attempts (exponential back-off: 500ms,
/// 1000ms). Transient delivery failures no longer silently drop alerts.
async fn send_with_retry(
    notification_service: &NotificationService,
    channel: &NotificationChannel,
    payload: &AlertPayload,
) -> Result<Option<String>> {
    use rand::Rng;
    let mut last_err = anyhow::anyhow!("no attempts made");
    for attempt in 0u32..3 {
        if attempt > 0 {
            let base_ms = 500u64 * (1 << (attempt - 1));
            let jitter_ms = rand::thread_rng().gen_range(0u64..=100);
            tokio::time::sleep(std::time::Duration::from_millis(base_ms + jitter_ms)).await;
        }
        match notification_service.send(channel, payload).await {
            Ok(action) => return Ok(action),
            Err(e) => {
                tracing::warn!(
                    attempt = attempt + 1,
                    channel_id = %channel.id,
                    "Alert send attempt {} of 3 failed: {}",
                    attempt + 1,
                    e
                );
                last_err = e;
            }
        }
    }
    Err(last_err)
}

// ─────────────────────────────────────────────────────────────────────────────

impl AlertingService {
    pub async fn new(pool: DbPool, app_url: String) -> Self {
        Self {
            pool,
            notification_service: NotificationService::new().await,
            app_url,
        }
    }

    /// Trigger alerts for a new issue
    pub async fn on_new_issue(&self, project_id: &str, issue: &Issue) -> Result<()> {
        tracing::debug!(
            "on_new_issue triggered for issue '{}' ({})",
            issue.title,
            issue.id
        );

        let (project, rules) = match get_project_and_rules(&self.pool, project_id).await? {
            Some(pr) => pr,
            None => {
                tracing::debug!("Project {} not found, skipping alerts", project_id);
                return Ok(());
            }
        };
        tracing::debug!(
            "Found {} active alert rules for project {}",
            rules.len(),
            project_id
        );

        for rule in rules {
            let condition = match parse_alert_condition(&rule) {
                Some(c) => c,
                None => continue,
            };

            // Check if condition matches
            let matches = match &condition {
                AlertCondition::NewIssue { level } => {
                    level.is_none() || level.as_deref() == Some(&issue.level)
                }
                _ => false,
            };

            if matches {
                tracing::debug!("Alert rule '{}' matches new_issue condition", rule.name);
                let payload = AlertPayload {
                    title: format!("New {} in {}", issue.level, project.name),
                    message: issue.title.clone(),
                    severity: issue.level.clone(),
                    project_name: project.name.clone(),
                    trigger_type: "new_issue".to_string(),
                    trigger_id: Some(issue.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/issues/{}?project={}",
                        self.app_url, issue.id, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                };

                if let Err(e) = self.send_alert(&rule, &payload, None).await {
                    error!(rule_id = %rule.id, "Alert delivery failed after retries: {}", e);
                }
            } else {
                tracing::debug!(
                    "Alert rule '{}' does not match (condition: {:?})",
                    rule.name,
                    condition
                );
            }
        }

        Ok(())
    }

    /// Trigger alerts for a monitor going down
    pub async fn on_monitor_down(
        &self,
        project_id: &str,
        monitor: &Monitor,
        error_message: Option<&str>,
    ) -> Result<()> {
        tracing::debug!(
            "on_monitor_down triggered for monitor '{}' ({})",
            monitor.name,
            monitor.id
        );

        let (project, rules) = match get_project_and_rules(&self.pool, project_id).await? {
            Some(pr) => pr,
            None => {
                tracing::debug!("Project {} not found, skipping alerts", project_id);
                return Ok(());
            }
        };
        tracing::debug!(
            "Found {} active alert rules for project {}",
            rules.len(),
            project_id
        );

        for rule in rules {
            let condition = match parse_alert_condition(&rule) {
                Some(c) => c,
                None => continue,
            };

            // Check if condition matches
            let matches = match &condition {
                AlertCondition::MonitorDown { monitor_id } => {
                    monitor_id.is_none() || monitor_id.as_deref() == Some(&monitor.id)
                }
                _ => false,
            };

            if matches {
                tracing::debug!("Alert rule '{}' matches monitor_down condition", rule.name);
                let message = match error_message {
                    Some(e) => format!("{} is DOWN: {}", monitor.name, e),
                    None => format!("{} is DOWN", monitor.name),
                };

                let payload = AlertPayload {
                    title: format!("Monitor Down: {}", monitor.name),
                    message,
                    severity: "error".to_string(),
                    project_name: project.name.clone(),
                    trigger_type: "monitor_down".to_string(),
                    trigger_id: Some(monitor.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/uptime?project={}",
                        self.app_url, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                };

                if let Err(e) = self.send_alert(&rule, &payload, None).await {
                    error!(rule_id = %rule.id, "Alert delivery failed after retries: {}", e);
                }
            } else {
                tracing::debug!(
                    "Alert rule '{}' does not match (condition type: {:?})",
                    rule.name,
                    condition
                );
            }
        }

        Ok(())
    }

    /// Trigger alerts for a monitor recovering
    pub async fn on_monitor_recovery(&self, project_id: &str, monitor: &Monitor) -> Result<()> {
        let (project, rules) = match get_project_and_rules(&self.pool, project_id).await? {
            Some(pr) => pr,
            None => return Ok(()),
        };

        for rule in rules {
            let condition = match parse_alert_condition(&rule) {
                Some(c) => c,
                None => continue,
            };

            // Check if condition matches
            let matches = match &condition {
                AlertCondition::MonitorRecovery { monitor_id } => {
                    monitor_id.is_none() || monitor_id.as_deref() == Some(&monitor.id)
                }
                _ => false,
            };

            if matches {
                let payload = AlertPayload {
                    title: format!("Monitor Recovered: {}", monitor.name),
                    message: format!("{} is back UP", monitor.name),
                    severity: "info".to_string(),
                    project_name: project.name.clone(),
                    trigger_type: "monitor_recovery".to_string(),
                    trigger_id: Some(monitor.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/uptime?project={}",
                        self.app_url, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                };

                if let Err(e) = self.send_alert(&rule, &payload, None).await {
                    error!(rule_id = %rule.id, "Alert delivery failed after retries: {}", e);
                }
            }
        }

        Ok(())
    }

    /// Trigger alerts for server metric thresholds
    pub async fn on_metrics_threshold(
        &self,
        project_id: &str,
        server_db_id: &str,
        metric: &ServerMetric,
    ) -> Result<()> {
        let (project, rules) = match get_project_and_rules(&self.pool, project_id).await? {
            Some(pr) => pr,
            None => return Ok(()),
        };

        let server = match ServerRepository::find_by_id(&self.pool, server_db_id).await? {
            Some(s) => s,
            None => return Ok(()),
        };

        // Parse disks_json once before the loop so it is not re-deserialized
        // for each active rule that includes a ServerDiskHigh condition.
        let disks: Vec<serde_json::Value> = metric
            .disks_json
            .as_deref()
            .and_then(|s| {
                serde_json::from_str(s)
                    .map_err(|e| tracing::warn!("Failed to parse disks_json: {}", e))
                    .ok()
            })
            .unwrap_or_default();

        for rule in rules {
            let condition = match parse_alert_condition(&rule) {
                Some(c) => c,
                None => continue,
            };

            let Some(alert_msg) = evaluate_metric_condition(
                &condition,
                server_db_id,
                metric,
                &server.hostname,
                &disks,
            ) else {
                continue;
            };

            let payload = AlertPayload {
                title: format!("Server Alert: {}", server.hostname),
                message: alert_msg,
                severity: "warning".to_string(),
                project_name: project.name.clone(),
                trigger_type: "server_metric".to_string(),
                trigger_id: Some(server_db_id.to_string()),
                url: Some(format!(
                    "{}/dashboard/server?project={}",
                    self.app_url, project_id
                )),
                timestamp: chrono::Utc::now().to_rfc3339(),
                project_id: None,
                issue: None,
                stack_trace: None,
                affected_users: None,
                frequency: None,
            };

            // Cooldown enforced atomically inside send_alert (15-minute window)
            if let Err(e) = self.send_alert(&rule, &payload, Some(15)).await {
                error!(rule_id = %rule.id, "Alert delivery failed after retries: {}", e);
            }
        }

        Ok(())
    }

    /// Trigger alerts for servers that have gone offline
    pub async fn on_server_offline(&self, server: &crate::db::models::Server) -> Result<()> {
        let (project, rules) = match get_project_and_rules(&self.pool, &server.project_id).await? {
            Some(pr) => pr,
            None => return Ok(()),
        };

        for rule in rules {
            let condition = match parse_alert_condition(&rule) {
                Some(c) => c,
                None => continue,
            };

            let matches = match &condition {
                AlertCondition::ServerOffline { server_id, .. } => {
                    server_id.is_none() || server_id.as_deref() == Some(&server.id)
                }
                _ => false,
            };

            if matches {
                let payload = AlertPayload {
                    title: format!("Server Offline: {}", server.hostname),
                    message: format!(
                        "{} has not reported metrics since {}",
                        server.hostname,
                        server.last_seen.format("%Y-%m-%d %H:%M:%S UTC")
                    ),
                    severity: "error".to_string(),
                    project_name: project.name.clone(),
                    trigger_type: "server_offline".to_string(),
                    trigger_id: Some(server.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/server?project={}",
                        self.app_url, &server.project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                };

                // Cooldown enforced atomically inside send_alert (15-minute window)
                if let Err(e) = self.send_alert(&rule, &payload, Some(15)).await {
                    error!(rule_id = %rule.id, "Alert delivery failed after retries: {}", e);
                }
            }
        }

        Ok(())
    }

    /// Send alert to all configured channels.
    ///
    /// Accepts the already-loaded `AlertRule` so callers avoid a redundant
    /// `find_by_id` round-trip (the rule is fetched once by the calling loop).
    ///
    /// `cooldown_minutes`: when `Some(n)`, atomically checks the cooldown window using a
    /// Postgres advisory xact lock before sending — eliminating the TOCTOU race where two
    /// concurrent tasks both pass a plain `find_recent` check and both fire. Pass `None`
    /// for event-driven alerts (new_issue, monitor) that have no cooldown requirement.
    async fn send_alert(
        &self,
        rule: &AlertRule,
        payload: &AlertPayload,
        cooldown_minutes: Option<i32>,
    ) -> Result<()> {
        let rule_id = &rule.id;

        // Atomic cooldown gate — must run before any per-channel work.
        if let Some(minutes) = cooldown_minutes {
            match AlertLogRepository::try_claim_cooldown(
                &self.pool,
                rule_id,
                None,
                &payload.trigger_type,
                payload.trigger_id.as_deref(),
                &payload.message,
                minutes,
            )
            .await
            {
                Ok(Some(_)) => {} // claimed — proceed
                Ok(None) => {
                    info!(
                        rule_id = %rule_id,
                        "Alert cooldown active or concurrent evaluation in progress — skipping"
                    );
                    return Ok(());
                }
                Err(e) => {
                    // Fail-safe: skip rather than risk an alert storm on DB error
                    tracing::warn!(
                        rule_id = %rule_id,
                        "Failed to claim alert cooldown slot: {}; skipping",
                        e
                    );
                    return Ok(());
                }
            }
        }

        // Check mute status using the already-loaded rule — no extra DB query.
        if let Some(muted_until) = rule.muted_until {
            if muted_until > chrono::Utc::now() {
                info!(
                    rule_id = %rule_id,
                    "Alert rule '{}' is muted until {}, skipping",
                    rule.name,
                    muted_until
                );
                return Ok(());
            }
        }

        let channel_ids: Vec<String> = match serde_json::from_str(&rule.actions) {
            Ok(ids) => ids,
            Err(e) => {
                error!(rule_id = %rule_id, "Failed to parse channel IDs from actions JSON: {}", e);
                return Ok(());
            }
        };

        info!(
            rule_id = %rule_id,
            channel_count = channel_ids.len(),
            "Sending alert"
        );

        if channel_ids.is_empty() {
            info!(rule_id = %rule_id, "No channels configured for this alert rule");
            return Ok(());
        }

        // Batch-fetch all channels in a single query instead of N+1
        let channels =
            match NotificationChannelRepository::find_by_ids(&self.pool, &channel_ids).await {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to batch-fetch channels: {}", e);
                    return Ok(());
                }
            };

        // Index channels by ID for quick lookup
        let channel_map: std::collections::HashMap<String, _> =
            channels.into_iter().map(|c| (c.id.clone(), c)).collect();

        // Collect the first webhook action that requests a status change — applied
        // once after the loop so multiple channels can't race to overwrite each other.
        let mut webhook_action: Option<String> = None;

        for channel_id in &channel_ids {
            let channel = match channel_map.get(channel_id) {
                Some(c) if c.is_active => c,
                Some(c) => {
                    info!("Channel '{}' is inactive, skipping", c.name);
                    continue;
                }
                None => {
                    error!("Channel {} not found", channel_id);
                    continue;
                }
            };

            // Create log entry
            let log = match AlertLogRepository::create(
                &self.pool,
                rule_id.as_str(),
                Some(channel_id),
                &payload.trigger_type,
                payload.trigger_id.as_deref(),
                &payload.message,
            )
            .await
            {
                Ok(l) => l,
                Err(e) => {
                    error!("Failed to create alert log: {}", e);
                    continue;
                }
            };

            // Send notification (3 attempts with exponential back-off)
            match send_with_retry(&self.notification_service, channel, payload).await {
                Ok(action) => {
                    if let Err(e) = AlertLogRepository::mark_sent(&self.pool, &log.id).await {
                        error!("Failed to mark log as sent: {}", e);
                    }
                    info!(
                        "Alert sent via {} channel '{}'",
                        channel.channel_type, channel.name
                    );

                    // Record the first resolve/ignore action; later channels are ignored
                    // so the issue status is only updated once per alert evaluation.
                    if webhook_action.is_none() {
                        if let Some(action) = action {
                            if matches!(action.as_str(), "resolve" | "ignore") {
                                webhook_action = Some(action);
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    error!("Failed to send alert: {}", error_msg);
                    if let Err(e) =
                        AlertLogRepository::mark_failed(&self.pool, &log.id, &error_msg).await
                    {
                        error!("Failed to mark log as failed: {}", e);
                    }
                }
            }
        }

        // Apply the webhook action (if any) once, outside the channel loop.
        if let (Some(action), Some(issue_id)) = (&webhook_action, &payload.trigger_id) {
            if payload.trigger_type == "new_issue" || payload.trigger_type == "issue_frequency" {
                let new_status = match action.as_str() {
                    "resolve" => "resolved",
                    "ignore" => "ignored",
                    // Unknown actions are no-ops — don't early-return the whole function
                    _ => return Ok(()),
                };
                match IssueRepository::update_status(&self.pool, issue_id, new_status).await {
                    Ok(_) => info!(
                        rule_id = %rule_id,
                        "Webhook action '{}' applied to issue {}",
                        action, issue_id
                    ),
                    Err(e) => error!(
                        rule_id = %rule_id,
                        "Failed to apply webhook action '{}' to issue {}: {}",
                        action, issue_id, e
                    ),
                }
            }
        }

        Ok(())
    }
}
