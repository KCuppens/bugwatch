-- Down migration for 025: Remove the unique-per-user constraint on password_reset_tokens.
-- After running this, multiple unexpired tokens per user are again possible.
ALTER TABLE password_reset_tokens
    DROP CONSTRAINT IF EXISTS unique_user_pending_reset;
