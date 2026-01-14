-- Expand alert rules with more detailed configuration
-- Note: alert_rules table already exists from initial schema

-- Alert notification channels table
CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL, -- 'email', 'webhook', 'slack'
    config TEXT NOT NULL, -- JSON config (email addresses, webhook URL, slack webhook)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_project_id ON notification_channels(project_id);

-- Alert history/log table
CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY NOT NULL,
    alert_rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel_id TEXT REFERENCES notification_channels(id) ON DELETE SET NULL,
    trigger_type TEXT NOT NULL, -- 'issue', 'monitor', 'threshold'
    trigger_id TEXT, -- ID of issue or monitor that triggered
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    message TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alert_logs_alert_rule_id ON alert_logs(alert_rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_created_at ON alert_logs(created_at DESC);
