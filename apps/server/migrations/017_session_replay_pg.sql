-- Session Replay: recordings and segments

CREATE TABLE IF NOT EXISTS session_recordings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    user_id TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER,
    is_complete BOOLEAN DEFAULT false,
    segment_count INTEGER DEFAULT 0,
    total_size_bytes BIGINT DEFAULT 0,
    environment TEXT DEFAULT 'production',
    release TEXT,
    user_agent TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recordings_project ON session_recordings(project_id);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON session_recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_started ON session_recordings(started_at);

CREATE TABLE IF NOT EXISTS session_segments (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES session_recordings(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    data BYTEA NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(recording_id, segment_index)
);
CREATE INDEX IF NOT EXISTS idx_segments_recording ON session_segments(recording_id);

ALTER TABLE events ADD COLUMN IF NOT EXISTS session_recording_id TEXT REFERENCES session_recordings(id);
CREATE INDEX IF NOT EXISTS idx_events_session_recording ON events(session_recording_id) WHERE session_recording_id IS NOT NULL;
