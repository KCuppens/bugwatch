-- Composite index for server metrics chart queries.
-- The get_range() query filters on (server_db_id, recorded_at BETWEEN $2 AND $3)
-- and selects only the numeric metric columns — the existing
-- idx_server_metrics_server_time covers the WHERE clause, but Postgres still
-- must heap-fetch every matching row to read the metric columns.
-- A BRIN index on recorded_at alone is cheaper for append-only time-series
-- than a full B-tree and satisfies the cleanup + range-scan path in tandem
-- with the existing compound index.
CREATE INDEX IF NOT EXISTS idx_server_metrics_recorded_at_brin
    ON server_metrics USING BRIN (recorded_at)
    WITH (pages_per_range = 128);

-- Servers: project + is_active + last_seen used by the offline-detection task
-- (mark_inactive) and by list_by_project when filtering active servers.
CREATE INDEX IF NOT EXISTS idx_servers_project_active_lastseen
    ON servers (project_id, is_active, last_seen DESC);
