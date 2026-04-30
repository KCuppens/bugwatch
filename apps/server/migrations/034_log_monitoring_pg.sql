-- Log monitoring tables: partitioned logs, saved searches, and alert rules.
-- Slice A — Pro-gated feature; ingestion via POST /api/v1/logs.

-- ============================================================
-- logs (monthly range-partitioned by created_at)
-- ============================================================
-- Partitioned tables in PostgreSQL require the partition key to
-- be part of every unique constraint / primary key.  We use
-- PRIMARY KEY (id, created_at) and a separate UNIQUE (log_id,
-- created_at) for the dedup key so ON CONFLICT still works.
CREATE TABLE IF NOT EXISTS logs (
    id             TEXT        NOT NULL,
    project_id     TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    log_id         TEXT        NOT NULL,   -- client-supplied dedup key
    timestamp      TIMESTAMPTZ NOT NULL,
    level          TEXT        NOT NULL,   -- 'trace'|'debug'|'info'|'warn'|'error'|'fatal'
    message        TEXT        NOT NULL,
    logger_name    TEXT,
    service_name   TEXT,
    environment    TEXT,
    release        TEXT,
    tags           JSONB,
    extra          JSONB,
    attributes     JSONB,                  -- extracted top-level primitives for facets
    issue_id       TEXT        REFERENCES issues(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Unique dedup constraint per partition (log_id + created_at month bucket)
-- We cannot use a global unique index on a partitioned table without the
-- partition key, so we include created_at in the unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_log_id_created
    ON logs (log_id, created_at);

-- ── Initial four monthly partitions ──────────────────────────────────────────
-- Previous month, current month, and two future months.
-- The DO $$ block makes the partition names dynamic so this migration is
-- idempotent regardless of when it is run.
DO $$
DECLARE
    base_month DATE;
    part_start DATE;
    part_end   DATE;
    tbl        TEXT;
    i          INT;
BEGIN
    -- Anchor to first day of (current month - 1)
    base_month := DATE_TRUNC('month', NOW())::DATE - INTERVAL '1 month';

    FOR i IN 0..3 LOOP
        part_start := base_month + (i || ' months')::INTERVAL;
        part_end   := part_start + INTERVAL '1 month';
        tbl        := 'logs_' || TO_CHAR(part_start, 'YYYY_MM');

        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = tbl AND n.nspname = 'public'
        ) THEN
            EXECUTE format(
                'CREATE TABLE %I PARTITION OF logs FOR VALUES FROM (%L) TO (%L)',
                tbl, part_start, part_end
            );

            -- Per-partition indexes
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (project_id, timestamp)', 'idx_' || tbl || '_proj_ts',     tbl);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (project_id, level)',     'idx_' || tbl || '_proj_level',   tbl);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (issue_id)',              'idx_' || tbl || '_issue_id',     tbl);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || tbl || '_attrs_gin',    tbl);
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- log_saved_searches
-- ============================================================
CREATE TABLE IF NOT EXISTS log_saved_searches (
    id          TEXT        PRIMARY KEY,
    project_id  TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    filters     JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_saved_searches_project
    ON log_saved_searches (project_id);

-- ============================================================
-- log_alert_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS log_alert_rules (
    id                  TEXT        PRIMARY KEY,
    project_id          TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                TEXT        NOT NULL,
    level_filter        TEXT,                          -- optional level predicate
    search_filter       TEXT,                          -- optional message substring
    threshold           INT         NOT NULL CHECK (threshold >= 1),
    window_seconds      INT         NOT NULL,
    notification_type   TEXT        NOT NULL,          -- 'email' | 'webhook'
    notification_target TEXT        NOT NULL,
    last_fired_at       TIMESTAMPTZ,
    is_active           BOOL        NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_alert_rules_project
    ON log_alert_rules (project_id);
CREATE INDEX IF NOT EXISTS idx_log_alert_rules_active
    ON log_alert_rules (is_active) WHERE is_active = TRUE;
