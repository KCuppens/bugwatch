use anyhow::Result;
use serde::Deserialize;
use tracing::{error, info};

use super::notifications::{AlertPayload, NotificationService};
use crate::db::{
    models::{Issue, Monitor, NotificationChannel, ServerMetric},
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

        let project = match ProjectRepository::find_by_id(&self.pool, project_id).await? {
            Some(p) => p,
            None => {
                tracing::debug!("Project {} not found, skipping alerts", project_id);
                return Ok(());
            }
        };

        let rules = AlertRuleRepository::list_active_by_project(&self.pool, project_id).await?;
        tracing::debug!(
            "Found {} active alert rules for project {}",
            rules.len(),
            project_id
        );

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(e) => {
                    error!(rule_id = %rule.id, rule_name = %rule.name, "Failed to parse alert condition: {}", e);
                    continue;
                }
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

                self.send_alert(&rule.id, &rule.actions, &payload).await;
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

        let project = match ProjectRepository::find_by_id(&self.pool, project_id).await? {
            Some(p) => p,
            None => {
                tracing::debug!("Project {} not found, skipping alerts", project_id);
                return Ok(());
            }
        };

        let rules = AlertRuleRepository::list_active_by_project(&self.pool, project_id).await?;
        tracing::debug!(
            "Found {} active alert rules for project {}",
            rules.len(),
            project_id
        );

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(e) => {
                    error!(rule_id = %rule.id, rule_name = %rule.name, "Failed to parse alert condition: {}", e);
                    continue;
                }
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

                self.send_alert(&rule.id, &rule.actions, &payload).await;
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
        let project = match ProjectRepository::find_by_id(&self.pool, project_id).await? {
            Some(p) => p,
            None => return Ok(()),
        };

        let rules = AlertRuleRepository::list_active_by_project(&self.pool, project_id).await?;

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(e) => {
                    error!(rule_id = %rule.id, rule_name = %rule.name, "Failed to parse alert condition: {}", e);
                    continue;
                }
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

                self.send_alert(&rule.id, &rule.actions, &payload).await;
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
        let project = match ProjectRepository::find_by_id(&self.pool, project_id).await? {
            Some(p) => p,
            None => return Ok(()),
        };

        let server = match ServerRepository::find_by_id(&self.pool, server_db_id).await? {
            Some(s) => s,
            None => return Ok(()),
        };

        let rules = AlertRuleRepository::list_active_by_project(&self.pool, project_id).await?;

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (matches, alert_msg) = match &condition {
                AlertCondition::ServerCpuHigh {
                    threshold_percent,
                    server_id,
                } => {
                    let applies = server_id.is_none() || server_id.as_deref() == Some(server_db_id);
                    if applies {
                        if let Some(cpu) = metric.cpu_usage_percent {
                            if cpu >= *threshold_percent {
                                (
                                    true,
                                    format!(
                                        "CPU at {:.1}% on {} (threshold: {:.0}%)",
                                        cpu, server.hostname, threshold_percent
                                    ),
                                )
                            } else {
                                (false, String::new())
                            }
                        } else {
                            (false, String::new())
                        }
                    } else {
                        (false, String::new())
                    }
                }
                AlertCondition::ServerMemoryHigh {
                    threshold_percent,
                    server_id,
                } => {
                    let applies = server_id.is_none() || server_id.as_deref() == Some(server_db_id);
                    if applies {
                        if let Some(mem) = metric.mem_usage_percent {
                            if mem >= *threshold_percent {
                                (
                                    true,
                                    format!(
                                        "Memory at {:.1}% on {} (threshold: {:.0}%)",
                                        mem, server.hostname, threshold_percent
                                    ),
                                )
                            } else {
                                (false, String::new())
                            }
                        } else {
                            (false, String::new())
                        }
                    } else {
                        (false, String::new())
                    }
                }
                AlertCondition::ServerDiskHigh {
                    threshold_percent,
                    mount,
                    server_id,
                } => {
                    let applies = server_id.is_none() || server_id.as_deref() == Some(server_db_id);
                    if applies {
                        if let Some(ref disks_str) = metric.disks_json {
                            let disks: Vec<serde_json::Value> = serde_json::from_str(disks_str)
                                .unwrap_or_else(|e| {
                                    tracing::warn!("Failed to parse disks_json: {}", e);
                                    vec![]
                                });
                            let mut triggered = false;
                            let mut msg = String::new();
                            for disk in &disks {
                                let disk_mount = disk["mount"].as_str().unwrap_or("");
                                let usage = disk["usage_percent"].as_f64().unwrap_or(0.0);
                                let mount_matches =
                                    mount.is_none() || mount.as_deref() == Some(disk_mount);
                                if mount_matches && usage >= *threshold_percent {
                                    triggered = true;
                                    msg = format!(
                                        "Disk {} at {:.1}% on {} (threshold: {:.0}%)",
                                        disk_mount, usage, server.hostname, threshold_percent
                                    );
                                    break;
                                }
                            }
                            (triggered, msg)
                        } else {
                            (false, String::new())
                        }
                    } else {
                        (false, String::new())
                    }
                }
                _ => (false, String::new()),
            };

            if matches {
                // Cooldown: check if we've already fired this rule+server within 15 minutes
                let recent_log =
                    AlertLogRepository::find_recent(&self.pool, &rule.id, Some(server_db_id), 15)
                        .await;

                if let Ok(Some(_)) = recent_log {
                    // Already fired recently, skip
                    continue;
                }

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

                self.send_alert(&rule.id, &rule.actions, &payload).await;
            }
        }

        Ok(())
    }

    /// Trigger alerts for servers that have gone offline
    pub async fn on_server_offline(&self, server: &crate::db::models::Server) -> Result<()> {
        let project = match ProjectRepository::find_by_id(&self.pool, &server.project_id).await? {
            Some(p) => p,
            None => return Ok(()),
        };

        let rules =
            AlertRuleRepository::list_active_by_project(&self.pool, &server.project_id).await?;

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let matches = match &condition {
                AlertCondition::ServerOffline { server_id, .. } => {
                    server_id.is_none() || server_id.as_deref() == Some(&server.id)
                }
                _ => false,
            };

            if matches {
                // Cooldown check
                let recent_log =
                    AlertLogRepository::find_recent(&self.pool, &rule.id, Some(&server.id), 15)
                        .await;

                if let Ok(Some(_)) = recent_log {
                    continue;
                }

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

                self.send_alert(&rule.id, &rule.actions, &payload).await;
            }
        }

        Ok(())
    }

    /// Send alert to all configured channels
    async fn send_alert(&self, rule_id: &str, actions_json: &str, payload: &AlertPayload) {
        // Check mute status
        let rule = AlertRuleRepository::find_by_id(&self.pool, rule_id).await;
        if let Ok(Some(rule)) = &rule {
            if let Some(muted_until) = rule.muted_until {
                if muted_until > chrono::Utc::now() {
                    info!(
                        "Alert rule '{}' is muted until {}, skipping",
                        rule.name, muted_until
                    );
                    return;
                }
            }
        }

        let channel_ids: Vec<String> = match serde_json::from_str(actions_json) {
            Ok(ids) => ids,
            Err(e) => {
                error!("Failed to parse channel IDs from '{}': {}", actions_json, e);
                return;
            }
        };

        info!(
            "Sending alert to {} channels: {:?}",
            channel_ids.len(),
            channel_ids
        );

        if channel_ids.is_empty() {
            info!("No channels configured for this alert rule");
            return;
        }

        // Batch-fetch all channels in a single query instead of N+1
        let channels =
            match NotificationChannelRepository::find_by_ids(&self.pool, &channel_ids).await {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to batch-fetch channels: {}", e);
                    return;
                }
            };

        // Index channels by ID for quick lookup
        let channel_map: std::collections::HashMap<String, _> =
            channels.into_iter().map(|c| (c.id.clone(), c)).collect();

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
                rule_id,
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

            // Send notification
            match self.notification_service.send(channel, payload).await {
                Ok(action) => {
                    if let Err(e) = AlertLogRepository::mark_sent(&self.pool, &log.id).await {
                        error!("Failed to mark log as sent: {}", e);
                    }
                    info!(
                        "Alert sent via {} channel '{}'",
                        channel.channel_type, channel.name
                    );

                    // Handle webhook response actions (resolve/ignore)
                    if let Some(action) = action {
                        if let Some(issue_id) = &payload.trigger_id {
                            if payload.trigger_type == "new_issue"
                                || payload.trigger_type == "issue_frequency"
                            {
                                let new_status = match action.as_str() {
                                    "resolve" => "resolved",
                                    "ignore" => "ignored",
                                    _ => continue,
                                };
                                match IssueRepository::update_status(
                                    &self.pool, issue_id, new_status,
                                )
                                .await
                                {
                                    Ok(_) => info!(
                                        "Webhook action '{}' applied to issue {}",
                                        action, issue_id
                                    ),
                                    Err(e) => error!(
                                        "Failed to apply webhook action '{}' to issue {}: {}",
                                        action, issue_id, e
                                    ),
                                }
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
    }
}
