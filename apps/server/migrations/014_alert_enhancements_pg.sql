-- Alert enhancements: mute/snooze support
ALTER TABLE alert_rules ADD COLUMN muted_until TIMESTAMPTZ;
ALTER TABLE alert_rules ADD COLUMN snooze_duration_minutes INTEGER;
