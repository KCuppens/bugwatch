use anyhow::Result;
use tracing::{error, info};
use uuid::Uuid;

use crate::db::{
    repositories::{
        AlertLogRepository, EventRepository, MonitorCheckRepository, PerformanceRepository,
        ReplayRepository, ServerMetricsRepository,
    },
    DbPool,
};

/// Data retention service for cleaning up old data
pub struct RetentionService {
    pool: DbPool,
    event_retention_days: i32,
    monitor_check_retention_days: i32,
    alert_log_retention_days: i32,
    server_metrics_retention_days: i32,
    transaction_retention_days: i32,
    recording_retention_days: i32,
}

impl RetentionService {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            event_retention_days: 90,
            monitor_check_retention_days: 30,
            alert_log_retention_days: 30,
            server_metrics_retention_days: 7,
            transaction_retention_days: 30,
            recording_retention_days: 30,
        }
    }

    /// Create with custom retention days (from config).
    /// A value of -1 disables cleanup (unlimited retention).
    pub fn with_retention_days(pool: DbPool, retention_days: i32) -> Self {
        Self {
            pool,
            event_retention_days: retention_days,
            monitor_check_retention_days: if retention_days < 0 {
                -1
            } else {
                retention_days.min(30)
            },
            alert_log_retention_days: if retention_days < 0 {
                -1
            } else {
                retention_days.min(30)
            },
            server_metrics_retention_days: if retention_days < 0 {
                -1
            } else {
                retention_days.min(7)
            },
            transaction_retention_days: if retention_days < 0 {
                -1
            } else {
                retention_days.min(30)
            },
            recording_retention_days: if retention_days < 0 {
                -1
            } else {
                retention_days.min(30)
            },
        }
    }

    /// Run all cleanup tasks. Retention values of -1 skip cleanup (unlimited).
    /// Each step runs independently — a failure in one step is logged but does not
    /// prevent subsequent steps from running.
    pub async fn run_cleanup(&self) -> Result<()> {
        let run_id = Uuid::new_v4();
        info!(run_id = %run_id, "Running data retention cleanup...");
        let mut first_err: Option<anyhow::Error> = None;

        // Cleanup old events using per-org effective retention:
        // each org's cutoff is (event_retention_days + org.x402_extra_retention_days) days.
        if self.event_retention_days >= 0 {
            match EventRepository::cleanup_old_events(&self.pool, self.event_retention_days).await {
                Ok(n) if n > 0 => info!(
                    "Cleaned up {} old events (per-org effective retention, {} day base)",
                    n, self.event_retention_days
                ),
                Ok(_) => {}
                Err(e) => {
                    error!("Failed to cleanup old events: {}", e);
                    first_err.get_or_insert(e);
                }
            }
        }

        // Cleanup old monitor checks
        if self.monitor_check_retention_days >= 0 {
            match MonitorCheckRepository::cleanup_old_checks(
                &self.pool,
                self.monitor_check_retention_days,
            )
            .await
            {
                Ok(n) if n > 0 => info!(
                    "Cleaned up {} old monitor checks (older than {} days)",
                    n, self.monitor_check_retention_days
                ),
                Ok(_) => {}
                Err(e) => {
                    error!("Failed to cleanup old monitor checks: {}", e);
                    first_err.get_or_insert(e);
                }
            }
        }

        // Cleanup old alert logs
        if self.alert_log_retention_days >= 0 {
            match AlertLogRepository::cleanup_old_logs(&self.pool, self.alert_log_retention_days)
                .await
            {
                Ok(n) if n > 0 => info!(
                    "Cleaned up {} old alert logs (older than {} days)",
                    n, self.alert_log_retention_days
                ),
                Ok(_) => {}
                Err(e) => {
                    error!("Failed to cleanup old alert logs: {}", e);
                    first_err.get_or_insert(e);
                }
            }
        }

        // Cleanup old server metrics
        if self.server_metrics_retention_days >= 0 {
            match ServerMetricsRepository::cleanup_old_metrics(
                &self.pool,
                self.server_metrics_retention_days,
            )
            .await
            {
                Ok(n) if n > 0 => info!(
                    "Cleaned up {} old server metrics (older than {} days)",
                    n, self.server_metrics_retention_days
                ),
                Ok(_) => {}
                Err(e) => {
                    error!("Failed to cleanup old server metrics: {}", e);
                    first_err.get_or_insert(e);
                }
            }
        }

        // Cleanup old transactions (and their spans via cascade)
        if self.transaction_retention_days >= 0 {
            match PerformanceRepository::cleanup_old_transactions(
                &self.pool,
                self.transaction_retention_days,
            )
            .await
            {
                Ok(n) if n > 0 => info!(
                    "Cleaned up {} old transactions (older than {} days)",
                    n, self.transaction_retention_days
                ),
                Ok(_) => {}
                Err(e) => {
                    error!("Failed to cleanup old transactions: {}", e);
                    first_err.get_or_insert(e);
                }
            }
        }

        // Cleanup old session recordings (and their segments via cascade)
        if self.recording_retention_days >= 0 {
            match ReplayRepository::cleanup_old_recordings(
                &self.pool,
                self.recording_retention_days,
            )
            .await
            {
                Ok(n) if n > 0 => info!(
                    "Cleaned up {} old session recordings (older than {} days)",
                    n, self.recording_retention_days
                ),
                Ok(_) => {}
                Err(e) => {
                    error!("Failed to cleanup old session recordings: {}", e);
                    first_err.get_or_insert(e);
                }
            }
        }

        info!("Data retention cleanup completed");
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}
