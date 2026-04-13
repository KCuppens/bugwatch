-- Alert rules: queries filter by project + is_active
CREATE INDEX IF NOT EXISTS idx_alert_rules_project_active ON alert_rules(project_id, is_active);

-- Transactions: time-series queries need project + started_at
CREATE INDEX IF NOT EXISTS idx_transactions_project_started ON transactions(project_id, started_at DESC);

-- Issue links: webhook sync queries by provider + external ID
CREATE INDEX IF NOT EXISTS idx_issue_links_provider_external ON issue_links(provider, external_issue_id);

-- Events: JSONB GIN index for deduplication queries
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON events USING GIN ((payload::jsonb));
