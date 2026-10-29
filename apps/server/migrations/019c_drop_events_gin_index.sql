-- no-transaction
-- Drop the GIN index on events.payload (TEXT column).
-- The index was silently skipped by the query planner on any query that did not
-- cast the column to JSONB (i.e. "WHERE payload::jsonb @> ..."), so it provided
-- no benefit for the TEXT-typed queries actually used in production while adding
-- write-amplification overhead on every INSERT/UPDATE to the events table.
-- If full JSONB search is required in the future, migrate the column to native
-- JSONB type first, then add the GIN index on the typed column.
DROP INDEX CONCURRENTLY IF EXISTS idx_events_payload_gin;
