-- Alert enhancements: mute/snooze support
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS snooze_duration_minutes INTEGER;
