-- Payment failure tracking for grace period management

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_failed_at TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS grace_period_ends TEXT;
