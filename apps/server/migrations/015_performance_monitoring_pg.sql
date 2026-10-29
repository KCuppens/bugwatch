CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    transaction_name TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    op TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    duration_ms DOUBLE PRECISION NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    environment TEXT DEFAULT 'production',
    release TEXT,
    tags TEXT,
    data TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_transactions_name ON transactions(transaction_name);
CREATE INDEX IF NOT EXISTS idx_transactions_started ON transactions(started_at);
CREATE INDEX IF NOT EXISTS idx_transactions_trace ON transactions(trace_id);
CREATE INDEX IF NOT EXISTS idx_transactions_duration ON transactions(duration_ms);

CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    op TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ok',
    duration_ms DOUBLE PRECISION NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    data TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spans_transaction ON spans(transaction_id);
CREATE INDEX IF NOT EXISTS idx_spans_op ON spans(op);
