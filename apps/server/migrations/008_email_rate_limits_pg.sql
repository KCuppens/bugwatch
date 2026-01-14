-- Email rate limiting table for tracking email notifications
-- Used to enforce cooldown periods between emails per issue

CREATE TABLE IF NOT EXISTS email_rate_limits (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_fingerprint TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, issue_fingerprint, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_email_rate_limits_lookup
    ON email_rate_limits(project_id, issue_fingerprint, channel_id);

CREATE INDEX IF NOT EXISTS idx_email_rate_limits_cleanup
    ON email_rate_limits(last_sent_at);
