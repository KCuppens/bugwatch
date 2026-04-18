-- disable-transaction
-- pg_trgm accelerates LIKE '%pattern%' queries on issues.title and issues.fingerprint.
-- CONCURRENTLY avoids a table lock so the migration does not block concurrent reads/writes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_title_trgm
    ON issues USING gin (title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_fingerprint_trgm
    ON issues USING gin (fingerprint gin_trgm_ops);
