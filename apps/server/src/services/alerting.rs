use anyhow::Result;
use serde::Deserialize;
use tracing::{error, info};

use crate::db::{
    models::{Issue, Monitor, NotificationChannel},
    repositories::{
        AlertLogRepository, AlertRuleRepository, NotificationChannelRepository, ProjectRepository,
    },
    DbPool,
};
use super::notifications::{AlertPayload, NotificationService};

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
        threshold: u32,
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
        let project = match ProjectRepository::find_by_id(&self.pool, project_id).await? {
            Some(p) => p,
            None => return Ok(()),
        };

        let rules = AlertRuleRepository::list_active_by_project(&self.pool, project_id).await?;

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to parse alert condition: {}", e);
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
                };

                self.send_alert(&rule.id, &rule.actions, &payload).await;
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
        let project = match ProjectRepository::find_by_id(&self.pool, project_id).await? {
            Some(p) => p,
            None => return Ok(()),
        };

        let rules = AlertRuleRepository::list_active_by_project(&self.pool, project_id).await?;

        for rule in rules {
            let condition: AlertCondition = match serde_json::from_str(&rule.condition) {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to parse alert condition: {}", e);
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
                };

                self.send_alert(&rule.id, &rule.actions, &payload).await;
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
                    error!("Failed to parse alert condition: {}", e);
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
                };

                self.send_alert(&rule.id, &rule.actions, &payload).await;
            }
        }

        Ok(())
    }

    /// Send alert to all configured channels
    async fn send_alert(&self, rule_id: &str, actions_json: &str, payload: &AlertPayload) {
        let channel_ids: Vec<String> = match serde_json::from_str(actions_json) {
            Ok(ids) => ids,
            Err(e) => {
                error!("Failed to parse channel IDs: {}", e);
                return;
            }
        };

        for channel_id in channel_ids {
            let channel = match NotificationChannelRepository::find_by_id(&self.pool, &channel_id).await
            {
                Ok(Some(c)) if c.is_active => c,
                _ => continue,
            };

            // Create log entry
            let log = match AlertLogRepository::create(
                &self.pool,
                rule_id,
                Some(&channel_id),
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
            match self.notification_service.send(&channel, payload).await {
                Ok(_) => {
                    if let Err(e) = AlertLogRepository::mark_sent(&self.pool, &log.id).await {
                        error!("Failed to mark log as sent: {}", e);
                    }
                    info!(
                        "Alert sent via {} channel '{}'",
                        channel.channel_type, channel.name
                    );
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
