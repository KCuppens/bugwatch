-- Add api_key_hash column for constant-time API key lookups
ALTER TABLE projects ADD COLUMN IF NOT EXISTS api_key_hash TEXT;

-- Backfill existing keys with SHA-256 hashes
UPDATE projects SET api_key_hash = encode(sha256(api_key::bytea), 'hex') WHERE api_key_hash IS NULL;

-- Verify backfill completed (fail migration if any rows are missing hashes)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE api_key IS NOT NULL AND api_key_hash IS NULL) THEN
    RAISE EXCEPTION 'Backfill failed: some projects have api_key but no api_key_hash';
  END IF;
END $$;

-- Enforce NOT NULL now that all rows are backfilled
ALTER TABLE projects ALTER COLUMN api_key_hash SET NOT NULL;

-- Create unique index on hash column for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_api_key_hash ON projects(api_key_hash);
