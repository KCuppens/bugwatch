use anyhow::Result;
use tracing::info;

use crate::db::{
    repositories::{AlertLogRepository, EventRepository, MonitorCheckRepository},
    DbPool,
};

/// Data retention service for cleaning up old data
pub struct RetentionService {
    pool: DbPool,
    event_retention_days: i32,
    monitor_check_retention_days: i32,
    alert_log_retention_days: i32,
}

impl RetentionService {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            event_retention_days: 90,      // Keep events for 90 days
            monitor_check_retention_days: 30, // Keep monitor checks for 30 days
            alert_log_retention_days: 30,   // Keep alert logs for 30 days
        }
    }

    /// Run all cleanup tasks
    pub async fn run_cleanup(&self) -> Result<()> {
        info!("Running data retention cleanup...");

        // Cleanup old events
        let events_deleted = EventRepository::cleanup_old_events(
            &self.pool,
            self.event_retention_days,
        ).await?;
        if events_deleted > 0 {
            info!("Cleaned up {} old events (older than {} days)", events_deleted, self.event_retention_days);
        }

        // Cleanup old monitor checks
        let checks_deleted = MonitorCheckRepository::cleanup_old_checks(
            &self.pool,
            self.monitor_check_retention_days,
        ).await?;
        if checks_deleted > 0 {
            info!("Cleaned up {} old monitor checks (older than {} days)", checks_deleted, self.monitor_check_retention_days);
        }

        // Cleanup old alert logs
        let logs_deleted = AlertLogRepository::cleanup_old_logs(
            &self.pool,
            self.alert_log_retention_days,
        ).await?;
        if logs_deleted > 0 {
            info!("Cleaned up {} old alert logs (older than {} days)", logs_deleted, self.alert_log_retention_days);
        }

        info!("Data retention cleanup completed");
        Ok(())
    }
}
