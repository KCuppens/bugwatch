-- Improves query performance for server_metrics range queries.
-- Supports filtering by server_db_id and recorded_at range in a single index scan.
CREATE INDEX IF NOT EXISTS idx_server_metrics_server_recorded
    ON server_metrics(server_db_id, recorded_at);
