-- Agent API Keys table
CREATE TABLE IF NOT EXISTS agent_keys (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '["read"]',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_keys_org_id ON agent_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_keys_key_hash ON agent_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_keys_created_by ON agent_keys(created_by);

-- Agent Audit Log table
CREATE TABLE IF NOT EXISTS agent_audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    agent_key_id TEXT NOT NULL REFERENCES agent_keys(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_log_key_id ON agent_audit_log(agent_key_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_created_at ON agent_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_action ON agent_audit_log(action);
