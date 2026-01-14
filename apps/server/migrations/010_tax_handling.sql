-- Tax/VAT handling for billing compliance

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_exempt INTEGER DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_country TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_address TEXT;
