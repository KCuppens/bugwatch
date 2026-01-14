-- Payment failure tracking for grace period management

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS grace_period_ends TIMESTAMPTZ;
