-- no-transaction
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- The "no-transaction" pragma tells sqlx-migrate to run this file outside BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_payload_gin ON events USING GIN ((payload::jsonb));
