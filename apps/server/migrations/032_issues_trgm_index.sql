CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_issues_title_trgm ON issues USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_issues_fingerprint_trgm ON issues USING GIN (fingerprint gin_trgm_ops);
