-- Server monitoring: servers and server_metrics tables

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    os TEXT,
    kernel TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(project_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_servers_project_id ON servers(project_id);
CREATE INDEX IF NOT EXISTS idx_servers_last_seen ON servers(last_seen);

CREATE TABLE IF NOT EXISTS server_metrics (
    id TEXT PRIMARY KEY,
    server_db_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    cpu_usage_percent DOUBLE PRECISION,
    load_avg_1 DOUBLE PRECISION,
    load_avg_5 DOUBLE PRECISION,
    load_avg_15 DOUBLE PRECISION,
    mem_total_bytes BIGINT,
    mem_used_bytes BIGINT,
    mem_available_bytes BIGINT,
    mem_usage_percent DOUBLE PRECISION,
    swap_total_bytes BIGINT,
    swap_used_bytes BIGINT,
    net_rx_bytes_per_sec BIGINT,
    net_tx_bytes_per_sec BIGINT,
    uptime_seconds BIGINT,
    disks_json TEXT,
    processes_json TEXT,
    docker_json TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_metrics_server_time ON server_metrics(server_db_id, recorded_at DESC);
