-- Add credits column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 10;

-- Index for efficient credit queries
CREATE INDEX IF NOT EXISTS idx_users_credits ON users(credits);
