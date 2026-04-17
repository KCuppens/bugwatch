-- Migration 025: Enforce one-pending-token-per-user for password resets.
--
-- ROLLBACK (run manually — sqlx flat-file migrations have no auto-revert):
--   ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS unique_user_pending_reset;
--
--
-- The previous INSERT used ON CONFLICT (token_hash) which never conflicts
-- (each request generates a fresh token), allowing multiple unexpired tokens
-- to accumulate for the same user. This constraint enforces the intended
-- invariant: at most one pending reset token per user at any time.
-- The application-layer upsert now uses ON CONFLICT (user_id) DO UPDATE to
-- atomically replace the old token when a new reset is requested.

-- Deduplicate: keep the newest token per user; remove extras.
-- Safe to re-run: once at most one row per user_id exists the DELETE is a no-op.
-- Runs outside the DO $$ block because it is a DML statement, not DDL — PostgreSQL
-- allows mixing DML and DDL in the same migration file without an explicit transaction.
DELETE FROM password_reset_tokens
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id
                   ORDER BY expires_at DESC, id DESC
               ) AS rn
        FROM password_reset_tokens
    ) ranked
    WHERE rn > 1
);

-- ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL; guard with a pg_constraint check
-- so re-running the migration (e.g. after a partial failure) is idempotent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_pending_reset'
    ) THEN
        ALTER TABLE password_reset_tokens
            ADD CONSTRAINT unique_user_pending_reset UNIQUE (user_id);
    END IF;
END $$;
