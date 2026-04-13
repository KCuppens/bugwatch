-- Performance indexes for hot query paths identified by the perf audit.
-- Each index below has a named counterpart in a specific repository query.

-- issues: find_by_project / count_by_project filter by project_id + status
-- and order by last_seen DESC. Without this compound index, Postgres either
-- scans project_id then sorts, or uses a non-covering (project, last_seen)
-- index and still filters rows.
CREATE INDEX IF NOT EXISTS idx_issues_project_status_lastseen
    ON issues (project_id, status, last_seen DESC);

-- issues: search() additionally filters by level + environment. Keep it as
-- a separate multi-column index rather than piling onto the above, so the
-- simpler list path still gets a narrow index.
CREATE INDEX IF NOT EXISTS idx_issues_project_full_filter
    ON issues (project_id, level, environment, status, last_seen DESC);

-- notification_channels: batch fetch + is_active filter in alerting.rs
CREATE INDEX IF NOT EXISTS idx_notification_channels_project_active
    ON notification_channels (project_id, is_active);

-- alert_logs: recent-sent lookup for cooldown window checks. Partial index
-- keeps it cheap since most rows are status='sent'.
CREATE INDEX IF NOT EXISTS idx_alert_logs_sent_recent
    ON alert_logs (alert_rule_id, created_at DESC)
    WHERE status = 'sent';

-- server_metrics: cleanup_old_metrics() deletes purely by recorded_at.
-- Existing compound (server_db_id, recorded_at) can't be used without a
-- server_db_id predicate.
CREATE INDEX IF NOT EXISTS idx_server_metrics_recorded_at
    ON server_metrics (recorded_at);

-- session_recordings: list_recordings() orders by started_at DESC per project.
CREATE INDEX IF NOT EXISTS idx_session_recordings_project_started
    ON session_recordings (project_id, started_at DESC);

-- events: Next.js error-boundary dedupe (has_recent_event_with_digest) reads
-- payload::jsonb->'tags'->>'next.digest'. Partial expression index so the
-- lookup is a narrow index scan instead of a full GIN probe.
CREATE INDEX IF NOT EXISTS idx_events_next_digest
    ON events (((payload::jsonb -> 'tags' ->> 'next.digest')), timestamp DESC)
    WHERE (payload::jsonb -> 'tags' ->> 'mechanism') = 'nextjs.onRequestError';
