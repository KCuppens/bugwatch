-- Add SDK/framework fields to projects table for onboarding

-- Platform: javascript, python, rust
ALTER TABLE projects ADD COLUMN IF NOT EXISTS platform TEXT;

-- Framework: nextjs, react, node, core (JS), django, flask, fastapi, celery (Python), blocking, async (Rust)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS framework TEXT;

-- Track when onboarding was completed
ALTER TABLE projects ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_projects_platform ON projects(platform);
CREATE INDEX IF NOT EXISTS idx_projects_framework ON projects(framework);
