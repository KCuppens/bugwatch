-- pg_trgm accelerates LIKE '%pattern%' queries on issues.title and issues.fingerprint.
-- Requires the pg_trgm extension (enabled on most hosted PostgreSQL providers).
-- CREATE EXTENSION and IF NOT EXISTS make this migration safe to re-run.
-- Rollback: see 028_ROLLBACK_MANUAL.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_issues_title_trgm
    ON issues USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_issues_fingerprint_trgm
    ON issues USING gin (fingerprint gin_trgm_ops);
