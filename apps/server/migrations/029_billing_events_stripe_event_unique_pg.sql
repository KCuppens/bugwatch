-- Make stripe_event_id unique in billing_events so that ON CONFLICT DO NOTHING
-- can be used for idempotent inserts (H4: webhook TOCTOU fix).
-- The existing non-unique index is dropped first (CREATE UNIQUE INDEX replaces it).
DROP INDEX IF EXISTS idx_billing_events_stripe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_stripe_unique
    ON billing_events (stripe_event_id)
    WHERE stripe_event_id IS NOT NULL;
