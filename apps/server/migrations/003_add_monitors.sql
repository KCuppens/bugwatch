-- Uptime monitors table
CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    expected_status INTEGER DEFAULT 200,
    headers TEXT NOT NULL DEFAULT '{}',
    body TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked_at TEXT,
    current_status TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_monitors_project_id ON monitors(project_id);
CREATE INDEX IF NOT EXISTS idx_monitors_is_active ON monitors(is_active);
CREATE INDEX IF NOT EXISTS idx_monitors_next_check ON monitors(is_active, last_checked_at);

-- Monitor check history table
CREATE TABLE IF NOT EXISTS monitor_checks (
    id TEXT PRIMARY KEY NOT NULL,
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    response_time_ms INTEGER,
    status_code INTEGER,
    error_message TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor_id ON monitor_checks(monitor_id);
CREATE INDEX IF NOT EXISTS idx_monitor_checks_checked_at ON monitor_checks(monitor_id, checked_at DESC);

-- Monitor incidents table (for tracking downtime periods)
CREATE TABLE IF NOT EXISTS monitor_incidents (
    id TEXT PRIMARY KEY NOT NULL,
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    resolved_at TEXT,
    cause TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitor_incidents_monitor_id ON monitor_incidents(monitor_id);
CREATE INDEX IF NOT EXISTS idx_monitor_incidents_started_at ON monitor_incidents(started_at DESC);
