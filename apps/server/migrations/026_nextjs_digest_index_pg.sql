-- Index on the Next.js digest tag used for event deduplication on ingest.
-- CONCURRENTLY avoids a full table lock on the hot events table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_nextjs_digest
    ON events ((payload::jsonb -> 'tags' ->> 'next.digest'))
    WHERE payload::jsonb -> 'tags' ->> 'next.digest' IS NOT NULL;
