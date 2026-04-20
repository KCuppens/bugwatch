use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::{error, info, Instrument};

use super::notifications::{AlertPayload, NotificationService};
use crate::db::{
    models::{
        AlertCondition, AlertRule, Issue, Monitor, NotificationChannel, Project, ServerMetric,
    },
    repositories::{
        AlertLogRepository, AlertRuleRepository, IssueRepository, NotificationChannelRepository,
        ProjectRepository, ServerRepository,
    },
    DbPool,
};

/// Alerting service for triggering and sending alerts
pub struct AlertingService {
    pool: DbPool,
    notification_service: Arc<NotificationService>,
    app_url: String,
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

// ─────────────────────────────────────────────────────────────────────────────

impl AlertingService {
    /// Send a notification with up to 3 attempts (exponential back-off: 500ms, 1000ms).
    async fn send_with_retry(
        notification_service: Arc<NotificationService>,
        channel: &NotificationChannel,
        payload: &AlertPayload,
        rule_id: &str,
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
                        rule_id = %rule_id,
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

    /// Loop over `rules`, evaluate each with `matcher`, and call `send_alert`
    /// for every rule that produces a payload. Centralises the parse→match→send
    /// pattern shared by all event-driven `on_*` handlers.
    ///
    /// Phase 1 (sequential, CPU-only): parse conditions and collect matching
    /// (rule, payload) pairs. Phase 2 (concurrent): fan out send_alert tasks
    /// via JoinSet so multiple matching rules don't block each other.
    async fn evaluate_rules_and_alert(
        &self,
        rules: Vec<AlertRule>,
        cooldown_minutes: Option<i32>,
        matcher: impl Fn(&AlertCondition) -> Option<AlertPayload>,
    ) -> Result<()> {
        // Phase 1: collect matches (CPU-only, no I/O)
        let mut matches: Vec<(AlertRule, AlertPayload)> = Vec::new();
        for rule in rules {
            let condition = match parse_alert_condition(&rule) {
                Some(c) => c,
                None => continue,
            };
            if let Some(payload) = matcher(&condition) {
                matches.push((rule, payload));
            } else {
                tracing::debug!(rule_id = %rule.id, rule_name = %rule.name, "Alert rule evaluated — no match");
            }
        }

        if matches.is_empty() {
            return Ok(());
        }

        // Phase 2: fan out sends concurrently — each rule is independent.
        // Semaphore caps concurrent DB + HTTP calls to prevent connection pool exhaustion.
        let pool = self.pool.clone();
        let notification_service = Arc::clone(&self.notification_service);
        let app_url = self.app_url.clone();
        let semaphore = Arc::new(Semaphore::new(10));
        let mut join_set: tokio::task::JoinSet<(String, Result<()>)> = tokio::task::JoinSet::new();

        for (rule, payload) in matches {
            let pool = pool.clone();
            let notification_service = Arc::clone(&notification_service);
            let app_url = app_url.clone();
            let sem = Arc::clone(&semaphore);
            let task_span = tracing::info_span!("alert_send", rule_id = %rule.id);
            join_set.spawn(
                async move {
                    let _semaphore_permit =
                        sem.acquire_owned().await.expect("alert semaphore closed"); // held for task duration to cap concurrency
                    let svc = AlertingService {
                        pool,
                        notification_service,
                        app_url,
                    };
                    let rule_id = rule.id.clone();
                    let result = svc.send_alert(&rule, &payload, cooldown_minutes).await;
                    (rule_id, result)
                }
                .instrument(task_span),
            );
        }

        while let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok((rule_id, Err(e))) => {
                    error!(rule_id = %rule_id, "Alert delivery failed after retries: {}", e);
                }
                Ok((_, Ok(()))) => {}
                Err(e) => {
                    error!("Alert send task panicked: {}", e);
                }
            }
        }

        Ok(())
    }

    pub async fn new(pool: DbPool, app_url: String) -> Self {
        Self {
            pool,
            notification_service: Arc::new(NotificationService::new().await),
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

        let app_url = self.app_url.clone();
        // 5-minute cooldown prevents duplicate alerts from SDK retries on
        // the same error (on_new_issue is fired for every ingest, not just
        // the first one that creates the issue).
        self.evaluate_rules_and_alert(rules, Some(5), |condition| match condition {
            AlertCondition::NewIssue { level }
                if level.is_none() || level.as_deref() == Some(&issue.level) =>
            {
                tracing::debug!("Alert rule matches new_issue condition");
                Some(AlertPayload {
                    title: format!("New {} in {}", issue.level, project.name),
                    message: issue.title.clone(),
                    severity: issue.level.clone(),
                    project_name: project.name.clone(),
                    trigger_type: "new_issue".to_string(),
                    trigger_id: Some(issue.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/issues/{}?project={}",
                        app_url, issue.id, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                })
            }
            _ => None,
        })
        .await
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

        let app_url = self.app_url.clone();
        let message = match error_message {
            Some(e) => format!("{} is DOWN: {}", monitor.name, e),
            None => format!("{} is DOWN", monitor.name),
        };
        // 5-minute cooldown prevents duplicate alerts from repeated down checks.
        self.evaluate_rules_and_alert(rules, Some(5), |condition| match condition {
            AlertCondition::MonitorDown { monitor_id }
                if monitor_id.is_none() || monitor_id.as_deref() == Some(&monitor.id) =>
            {
                Some(AlertPayload {
                    title: format!("Monitor Down: {}", monitor.name),
                    message: message.clone(),
                    severity: "error".to_string(),
                    project_name: project.name.clone(),
                    trigger_type: "monitor_down".to_string(),
                    trigger_id: Some(monitor.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/uptime?project={}",
                        app_url, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                })
            }
            _ => None,
        })
        .await
    }

    /// Trigger alerts for a monitor recovering
    pub async fn on_monitor_recovery(&self, project_id: &str, monitor: &Monitor) -> Result<()> {
        tracing::debug!(
            monitor_id = %monitor.id,
            monitor_name = %monitor.name,
            "on_monitor_recovery triggered"
        );
        let (project, rules) = match get_project_and_rules(&self.pool, project_id).await? {
            Some(pr) => pr,
            None => return Ok(()),
        };

        let app_url = self.app_url.clone();
        // 5-minute cooldown prevents duplicate alerts from rapid recovery/down cycling.
        self.evaluate_rules_and_alert(rules, Some(5), |condition| match condition {
            AlertCondition::MonitorRecovery { monitor_id }
                if monitor_id.is_none() || monitor_id.as_deref() == Some(&monitor.id) =>
            {
                Some(AlertPayload {
                    title: format!("Monitor Recovered: {}", monitor.name),
                    message: format!("{} is back UP", monitor.name),
                    severity: "info".to_string(),
                    project_name: project.name.clone(),
                    trigger_type: "monitor_recovery".to_string(),
                    trigger_id: Some(monitor.id.clone()),
                    url: Some(format!(
                        "{}/dashboard/uptime?project={}",
                        app_url, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                })
            }
            _ => None,
        })
        .await
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

        // Parse disks_json once — re-deserializing per rule would be wasteful.
        let disks: Vec<serde_json::Value> = metric
            .disks_json
            .as_deref()
            .and_then(|s| {
                serde_json::from_str(s)
                    .map_err(|e| tracing::warn!("Failed to parse disks_json: {}", e))
                    .ok()
            })
            .unwrap_or_default();

        let app_url = self.app_url.clone();
        // 15-minute cooldown enforced atomically inside send_alert.
        self.evaluate_rules_and_alert(rules, Some(15), |condition| {
            evaluate_metric_condition(condition, server_db_id, metric, &server.hostname, &disks)
                .map(|alert_msg| AlertPayload {
                    title: format!("Server Alert: {}", server.hostname),
                    message: alert_msg,
                    severity: "warning".to_string(),
                    project_name: project.name.clone(),
                    trigger_type: "server_metric".to_string(),
                    trigger_id: Some(server_db_id.to_string()),
                    url: Some(format!(
                        "{}/dashboard/server?project={}",
                        app_url, project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                })
        })
        .await
    }

    /// Trigger alerts for servers that have gone offline
    pub async fn on_server_offline(&self, server: &crate::db::models::Server) -> Result<()> {
        let (project, rules) = match get_project_and_rules(&self.pool, &server.project_id).await? {
            Some(pr) => pr,
            None => return Ok(()),
        };

        let app_url = self.app_url.clone();
        self.evaluate_rules_and_alert(rules, Some(15), |condition| match condition {
            AlertCondition::ServerOffline { server_id, .. }
                if server_id.is_none() || server_id.as_deref() == Some(&server.id) =>
            {
                Some(AlertPayload {
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
                        app_url, &server.project_id
                    )),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    project_id: None,
                    issue: None,
                    stack_trace: None,
                    affected_users: None,
                    frequency: None,
                })
            }
            _ => None,
        })
        .await
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

        let channel_ids: Vec<String> = match serde_json::from_str::<Vec<String>>(&rule.actions) {
            Ok(ids) => ids.into_iter().filter(|id| !id.trim().is_empty()).collect(),
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

        // Index channels by ID using owned values so channels can be moved into tasks.
        let mut channel_map: std::collections::HashMap<String, _> =
            channels.into_iter().map(|c| (c.id.clone(), c)).collect();

        // Phase 1: create alert logs for all active channels (sequential, fast DB writes).
        let mut channel_log_pairs: Vec<(NotificationChannel, String)> = Vec::new();
        for channel_id in &channel_ids {
            let channel = match channel_map.remove(channel_id) {
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

            channel_log_pairs.push((channel, log.id));
        }

        // Phase 2: fan out notification sends concurrently — each channel is
        // independent, so serialising them just adds latency for no benefit.
        type SendOutcome = (NotificationChannel, String, Result<Option<String>>);
        let mut join_set: tokio::task::JoinSet<SendOutcome> = tokio::task::JoinSet::new();

        for (channel, log_id) in channel_log_pairs {
            let svc = Arc::clone(&self.notification_service);
            let payload_clone = payload.clone();
            let rule_id_str = rule_id.to_string();
            join_set.spawn(async move {
                let result =
                    AlertingService::send_with_retry(svc, &channel, &payload_clone, &rule_id_str)
                        .await;
                (channel, log_id, result)
            });
        }

        // Phase 3: collect results and mark logs; record the first webhook action.
        // Collect the first resolve/ignore action — applied once after the loop so
        // multiple channels can't race to overwrite each other.
        let mut webhook_action: Option<String> = None;
        while let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok((channel, log_id, Ok(action))) => {
                    if let Err(e) = AlertLogRepository::mark_sent(&self.pool, &log_id).await {
                        error!("Failed to mark log as sent: {}", e);
                    }
                    info!(
                        "Alert sent via {} channel '{}'",
                        channel.channel_type, channel.name
                    );
                    if webhook_action.is_none() {
                        if let Some(action) = action {
                            if matches!(action.as_str(), "resolve" | "ignore") {
                                webhook_action = Some(action);
                            }
                        }
                    }
                }
                Ok((_, log_id, Err(e))) => {
                    let error_msg = e.to_string();
                    error!("Failed to send alert: {}", error_msg);
                    if let Err(e) =
                        AlertLogRepository::mark_failed(&self.pool, &log_id, &error_msg).await
                    {
                        error!("Failed to mark log as failed: {}", e);
                    }
                }
                Err(e) => {
                    error!("Alert send task panicked: {}", e);
                }
            }
        }

        // Apply the webhook action (if any) once, outside the channel loop.
        if let (Some(action), Some(issue_id)) = (&webhook_action, &payload.trigger_id) {
            if payload.trigger_type == "new_issue" || payload.trigger_type == "issue_frequency" {
                let new_status = match action.as_str() {
                    "resolve" => Some("resolved"),
                    "ignore" => Some("ignored"),
                    _ => None, // Unknown actions are no-ops
                };
                if let Some(status) = new_status {
                    match IssueRepository::update_status_for_project(
                        &self.pool,
                        issue_id,
                        &rule.project_id,
                        status,
                    )
                    .await
                    {
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
        }

        Ok(())
    }
}
