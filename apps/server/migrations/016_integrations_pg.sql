-- Integrations: GitHub, Jira, Linear OAuth connections
CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    external_user_id TEXT,
    external_username TEXT,
    config TEXT DEFAULT '{}',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, provider)
);

-- Issue links: track external issues linked to Bugwatch issues
CREATE TABLE IF NOT EXISTS issue_links (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_issue_id TEXT NOT NULL,
    external_issue_key TEXT NOT NULL,
    external_issue_url TEXT NOT NULL,
    external_status TEXT,
    sync_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(issue_id, provider, external_issue_id)
);
