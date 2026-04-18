-- x402 micropayment tracking
CREATE TABLE IF NOT EXISTS agent_payments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    nonce VARCHAR(64) NOT NULL UNIQUE,
    agent_key_id TEXT REFERENCES agent_keys(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    resource TEXT NOT NULL,
    payment_type VARCHAR(30) NOT NULL DEFAULT 'feature_access',
    feature TEXT,
    grant_type VARCHAR(30),
    grant_quantity BIGINT,
    amount_usdc BIGINT NOT NULL,
    tx_hash VARCHAR(66),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_payments_nonce ON agent_payments(nonce);
CREATE INDEX IF NOT EXISTS idx_agent_payments_org ON agent_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_payments_agent_key ON agent_payments(agent_key_id);

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS x402_extra_projects       INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS x402_extra_monitors       INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS x402_extra_storage_bytes  BIGINT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS x402_extra_retention_days INTEGER NOT NULL DEFAULT 0;
