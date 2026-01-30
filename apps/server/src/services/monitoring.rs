use anyhow::Result;
use reqwest::Client;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tokio::time;
use tracing::{error, info, warn};

use crate::db::{
    models::Monitor,
    repositories::{MonitorCheckRepository, MonitorIncidentRepository, MonitorRepository},
    DbPool,
};
use super::alerting::AlertingService;

/// Maximum concurrent health checks to prevent OOM from accumulated timeouts
const MAX_CONCURRENT_CHECKS: usize = 10;

/// Health check worker that monitors endpoints
pub struct HealthCheckWorker {
    pool: DbPool,
    client: Client,
    check_interval: Duration,
    alerting: Arc<AlertingService>,
    semaphore: Arc<Semaphore>,
}

impl HealthCheckWorker {
    /// Create a new HealthCheckWorker with its own AlertingService
    #[allow(dead_code)]
    pub async fn new(pool: DbPool, app_url: String) -> Self {
        let alerting = Arc::new(AlertingService::new(pool.clone(), app_url).await);
        Self::with_alerting(pool, alerting)
    }

    /// Create a new HealthCheckWorker with a shared AlertingService
    pub fn with_alerting(pool: DbPool, alerting: Arc<AlertingService>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Bugwatch-Monitor/1.0")
            .danger_accept_invalid_certs(false) // Keep security, but document option
            .build()
            .expect("Failed to create HTTP client");

        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_CHECKS));

        Self {
            pool,
            client,
            // Check for monitors to process every 10 seconds
            check_interval: Duration::from_secs(10),
            alerting,
            semaphore,
        }
    }

    /// Start the health check worker
    pub async fn run(&self) {
        info!("Starting health check worker");

        let mut interval = time::interval(self.check_interval);

        loop {
            interval.tick().await;

            if let Err(e) = self.process_monitors().await {
                error!("Error processing monitors: {}", e);
            }
        }
    }

    /// Process all monitors that need checking
    async fn process_monitors(&self) -> Result<()> {
        let monitors = MonitorRepository::list_active(&self.pool).await?;

        for monitor in monitors {
            if self.should_check(&monitor) {
                // Acquire semaphore permit to limit concurrent checks
                let permit = self.semaphore.clone().acquire_owned().await;
                if permit.is_err() {
                    warn!("Failed to acquire semaphore permit for monitor {}", monitor.id);
                    continue;
                }
                let permit = permit.unwrap();

                // Spawn check in background to not block other checks
                let pool = self.pool.clone();
                let client = self.client.clone();
                let monitor = monitor.clone();
                let alerting = self.alerting.clone();

                tokio::spawn(async move {
                    // Hold permit until check completes
                    let _permit = permit;
                    if let Err(e) = check_monitor(&pool, &client, &monitor, &alerting).await {
                        error!("Error checking monitor {}: {}", monitor.id, e);
                    }
                });
            }
        }

        Ok(())
    }

    /// Check if a monitor needs to be checked
    fn should_check(&self, monitor: &Monitor) -> bool {
        match &monitor.last_checked_at {
            None => true, // Never checked
            Some(last_time) => {
                let now = chrono::Utc::now();
                let elapsed = now.signed_duration_since(*last_time);
                elapsed.num_seconds() >= monitor.interval_seconds as i64
            }
        }
    }
}

/// Perform a health check on a monitor
async fn check_monitor(
    pool: &DbPool,
    client: &Client,
    monitor: &Monitor,
    alerting: &AlertingService,
) -> Result<()> {
    let now = chrono::Utc::now();
    let start = Instant::now();

    // Parse headers
    let headers: std::collections::HashMap<String, String> =
        serde_json::from_str(&monitor.headers).unwrap_or_default();

    // Build request
    let mut request = match monitor.method.to_uppercase().as_str() {
        "GET" => client.get(&monitor.url),
        "POST" => client.post(&monitor.url),
        "PUT" => client.put(&monitor.url),
        "DELETE" => client.delete(&monitor.url),
        "HEAD" => client.head(&monitor.url),
        "PATCH" => client.patch(&monitor.url),
        _ => client.get(&monitor.url),
    };

    // Add headers
    for (key, value) in headers {
        request = request.header(&key, &value);
    }

    // Add body if present
    if let Some(ref body) = monitor.body {
        request = request.body(body.clone());
    }

    // Set timeout
    request = request.timeout(Duration::from_millis(monitor.timeout_ms as u64));

    // Execute request
    let result = request.send().await;
    let response_time_ms = start.elapsed().as_millis() as i32;

    let (status, status_code, error_message) = match result {
        Ok(response) => {
            let code = response.status().as_u16() as i32;
            let expected = monitor.expected_status.unwrap_or(200);

            if code == expected || (expected == 200 && (200..300).contains(&code)) {
                ("up".to_string(), Some(code), None)
            } else {
                (
                    "down".to_string(),
                    Some(code),
                    Some(format!("Unexpected status code: {}", code)),
                )
            }
        }
        Err(e) => {
            let error_msg = if e.is_timeout() {
                "Request timed out".to_string()
            } else if e.is_connect() {
                format!("Connection failed: {}", e.without_url())
            } else if e.is_request() {
                format!("Request error: {}", e.without_url())
            } else {
                format!("Failed: {}", e.without_url())
            };
            ("down".to_string(), None, Some(error_msg))
        }
    };

    // Record the check
    MonitorCheckRepository::create(
        pool,
        &monitor.id,
        &status,
        Some(response_time_ms),
        status_code,
        error_message.as_deref(),
    )
    .await?;

    // Update monitor status
    MonitorRepository::update_status(pool, &monitor.id, &status, now).await?;

    // Handle incident tracking and alerting
    let previous_status = &monitor.current_status;

    if status == "down" && previous_status != "down" {
        // Start new incident
        info!("Monitor {} is DOWN: {:?}", monitor.name, error_message);
        MonitorIncidentRepository::create(pool, &monitor.id, error_message.as_deref()).await?;

        // Trigger alert
        if let Err(e) = alerting
            .on_monitor_down(&monitor.project_id, monitor, error_message.as_deref())
            .await
        {
            error!("Failed to trigger monitor down alert: {}", e);
        }
    } else if status == "up" && previous_status == "down" {
        // Resolve existing incident
        info!("Monitor {} is back UP", monitor.name);
        if let Some(incident) = MonitorIncidentRepository::find_open_by_monitor(pool, &monitor.id).await? {
            MonitorIncidentRepository::resolve(pool, &incident.id).await?;
        }

        // Trigger recovery alert
        if let Err(e) = alerting.on_monitor_recovery(&monitor.project_id, monitor).await {
            error!("Failed to trigger monitor recovery alert: {}", e);
        }
    }

    Ok(())
}

/// Cleanup old monitor checks to prevent database bloat
pub async fn cleanup_old_checks(pool: &DbPool, retention_days: i32) -> Result<u64> {
    let deleted = MonitorCheckRepository::cleanup_old_checks(pool, retention_days).await?;
    if deleted > 0 {
        info!("Cleaned up {} old monitor checks", deleted);
    }
    Ok(deleted)
}
