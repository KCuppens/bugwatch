-- no-transaction
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- The "no-transaction" pragma tells sqlx-migrate to run this file outside BEGIN/COMMIT.
--
-- NOTE: payload is stored as TEXT. This index is only used by queries that also cast:
--   WHERE (payload::jsonb) @> '{"key": "value"}'
-- If queries use the column without the cast, this index is silently skipped by the planner.
-- Consider migrating the column to native JSONB to make index usage unconditional.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_payload_gin ON events USING GIN ((payload::jsonb));
