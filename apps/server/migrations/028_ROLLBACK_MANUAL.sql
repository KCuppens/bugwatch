-- Manual rollback for migration 028_issues_trgm_index_pg.sql
-- Run outside a transaction (CONCURRENTLY requires autocommit).
DROP INDEX CONCURRENTLY IF EXISTS idx_issues_title_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_issues_fingerprint_trgm;
-- Note: intentionally leaves pg_trgm extension installed (shared with other consumers).
