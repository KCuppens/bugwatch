use anyhow::Result;
use tracing::info;

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
    pub async fn run_cleanup(&self) -> Result<()> {
        info!("Running data retention cleanup...");

        // Cleanup old events using per-org effective retention:
        // each org's cutoff is (event_retention_days + org.x402_extra_retention_days) days.
        if self.event_retention_days >= 0 {
            let events_deleted =
                EventRepository::cleanup_old_events(&self.pool, self.event_retention_days).await?;
            if events_deleted > 0 {
                info!(
                    "Cleaned up {} old events (per-org effective retention, {} day base)",
                    events_deleted, self.event_retention_days
                );
            }
        }

        // Cleanup old monitor checks
        if self.monitor_check_retention_days >= 0 {
            let checks_deleted = MonitorCheckRepository::cleanup_old_checks(
                &self.pool,
                self.monitor_check_retention_days,
            )
            .await?;
            if checks_deleted > 0 {
                info!(
                    "Cleaned up {} old monitor checks (older than {} days)",
                    checks_deleted, self.monitor_check_retention_days
                );
            }
        }

        // Cleanup old alert logs
        if self.alert_log_retention_days >= 0 {
            let logs_deleted =
                AlertLogRepository::cleanup_old_logs(&self.pool, self.alert_log_retention_days)
                    .await?;
            if logs_deleted > 0 {
                info!(
                    "Cleaned up {} old alert logs (older than {} days)",
                    logs_deleted, self.alert_log_retention_days
                );
            }
        }

        // Cleanup old server metrics
        if self.server_metrics_retention_days >= 0 {
            let metrics_deleted = ServerMetricsRepository::cleanup_old_metrics(
                &self.pool,
                self.server_metrics_retention_days,
            )
            .await?;
            if metrics_deleted > 0 {
                info!(
                    "Cleaned up {} old server metrics (older than {} days)",
                    metrics_deleted, self.server_metrics_retention_days
                );
            }
        }

        // Cleanup old transactions (and their spans via cascade)
        if self.transaction_retention_days >= 0 {
            let txns_deleted = PerformanceRepository::cleanup_old_transactions(
                &self.pool,
                self.transaction_retention_days,
            )
            .await?;
            if txns_deleted > 0 {
                info!(
                    "Cleaned up {} old transactions (older than {} days)",
                    txns_deleted, self.transaction_retention_days
                );
            }
        }

        // Cleanup old session recordings (and their segments via cascade)
        if self.recording_retention_days >= 0 {
            let recordings_deleted =
                ReplayRepository::cleanup_old_recordings(&self.pool, self.recording_retention_days)
                    .await?;
            if recordings_deleted > 0 {
                info!(
                    "Cleaned up {} old session recordings (older than {} days)",
                    recordings_deleted, self.recording_retention_days
                );
            }
        }

        info!("Data retention cleanup completed");
        Ok(())
    }
}
