CREATE INDEX IF NOT EXISTS idx_alert_logs_rule_trigger_sent
    ON alert_logs(alert_rule_id, trigger_id, created_at DESC)
    WHERE status = 'sent';
