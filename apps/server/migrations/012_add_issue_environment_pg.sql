-- Add environment column to issues table
ALTER TABLE issues ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';
CREATE INDEX IF NOT EXISTS idx_issues_environment ON issues(project_id, environment);

-- Backfill from most recent event per issue
UPDATE issues SET environment = COALESCE(
    (SELECT payload::json->>'environment'
     FROM events
     WHERE events.issue_id = issues.id
     ORDER BY events.timestamp DESC
     LIMIT 1),
    'production'
);
