-- disable-transaction
-- pg_trgm accelerates LIKE '%pattern%' queries on issues.title and issues.fingerprint.
-- CONCURRENTLY avoids a table lock so the migration does not block concurrent reads/writes.
--
-- Deployment notes:
--   * Requires the pg_trgm extension (enabled on most hosted PostgreSQL providers).
--   * CONCURRENTLY builds the index without locking the table; expected duration
--     depends on table size (typically seconds to minutes). Monitor progress via:
--       SELECT phase, blocks_done, blocks_total FROM pg_stat_progress_create_index;
--   * CREATE EXTENSION and IF NOT EXISTS make this migration safe to re-run.
--   * Rollback: see 028_ROLLBACK_MANUAL.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_title_trgm
    ON issues USING gin (title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_fingerprint_trgm
    ON issues USING gin (fingerprint gin_trgm_ops);
