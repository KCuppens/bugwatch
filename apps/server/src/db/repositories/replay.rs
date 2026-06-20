use anyhow::Result;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::db::{
    models::{SessionRecording, SessionSegment},
    DbPool,
};

pub struct ReplayRepository;

impl ReplayRepository {
    /// Create a new session recording
    pub async fn create_recording(
        pool: &DbPool,
        project_id: &str,
        session_id: &str,
        started_at: DateTime<Utc>,
        user_agent: Option<&str>,
        screen_width: Option<i32>,
        screen_height: Option<i32>,
    ) -> Result<SessionRecording> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        let recording = sqlx::query_as::<_, SessionRecording>(
            r#"
            INSERT INTO session_recordings (id, project_id, session_id, started_at, user_agent, screen_width, screen_height, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(session_id)
        .bind(started_at)
        .bind(user_agent)
        .bind(screen_width)
        .bind(screen_height)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(recording)
    }

    /// Find a recording by ID
    pub async fn find_recording(pool: &DbPool, id: &str) -> Result<Option<SessionRecording>> {
        sqlx::query_as::<_, SessionRecording>("SELECT * FROM session_recordings WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// Find a recording by session_id for a project
    pub async fn find_by_session_id(
        pool: &DbPool,
        project_id: &str,
        session_id: &str,
    ) -> Result<Option<SessionRecording>> {
        sqlx::query_as::<_, SessionRecording>(
            "SELECT * FROM session_recordings WHERE project_id = $1 AND session_id = $2",
        )
        .bind(project_id)
        .bind(session_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Create a segment for a recording
    pub async fn create_segment(
        pool: &DbPool,
        recording_id: &str,
        segment_index: i32,
        data: &[u8],
    ) -> Result<SessionSegment> {
        let id = Uuid::new_v4().to_string();
        let size_bytes = data.len() as i32;
        let now = Utc::now();

        let segment = sqlx::query_as::<_, SessionSegment>(
            r#"
            INSERT INTO session_segments (id, recording_id, segment_index, data, size_bytes, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (recording_id, segment_index) DO UPDATE SET
                data = EXCLUDED.data,
                size_bytes = EXCLUDED.size_bytes
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(recording_id)
        .bind(segment_index)
        .bind(data)
        .bind(size_bytes)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(segment)
    }

    /// List segments for a recording, ordered by index
    pub async fn list_segments(pool: &DbPool, recording_id: &str) -> Result<Vec<SessionSegment>> {
        sqlx::query_as::<_, SessionSegment>(
            "SELECT * FROM session_segments WHERE recording_id = $1 ORDER BY segment_index ASC LIMIT 10000",
        )
        .bind(recording_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Mark a recording as complete
    pub async fn finish_recording(pool: &DbPool, id: &str, duration_ms: Option<i32>) -> Result<()> {
        sqlx::query(
            "UPDATE session_recordings SET is_complete = true, duration_ms = $1 WHERE id = $2",
        )
        .bind(duration_ms)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// List recordings for a project
    pub async fn list_recordings(
        pool: &DbPool,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<SessionRecording>> {
        let limit = limit.clamp(1, 1000);
        let offset = offset.clamp(0, 100_000);
        sqlx::query_as::<_, SessionRecording>(
            "SELECT * FROM session_recordings WHERE project_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(project_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Find a recording linked to an issue (via events table)
    pub async fn find_by_event_issue(
        pool: &DbPool,
        issue_id: &str,
    ) -> Result<Option<SessionRecording>> {
        sqlx::query_as::<_, SessionRecording>(
            r#"
            SELECT sr.* FROM session_recordings sr
            INNER JOIN events e ON e.session_recording_id = sr.id
            WHERE e.issue_id = $1
            ORDER BY e.timestamp DESC
            LIMIT 1
            "#,
        )
        .bind(issue_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Clean up old recordings and their segments
    pub async fn cleanup_old_recordings(pool: &DbPool, days: i32) -> Result<u64> {
        let cutoff = Utc::now() - chrono::Duration::days(days as i64);

        // Segments are cascade-deleted when recordings are deleted.
        // Batched to avoid long-running table locks.
        let mut total_deleted: u64 = 0;
        loop {
            let result = sqlx::query(
                "DELETE FROM session_recordings WHERE id IN (
                    SELECT id FROM session_recordings
                    WHERE started_at < $1
                    ORDER BY started_at LIMIT 1000
                )",
            )
            .bind(cutoff)
            .execute(pool)
            .await?;
            let deleted = result.rows_affected();
            total_deleted += deleted;
            if deleted == 0 {
                break;
            }
        }

        Ok(total_deleted)
    }

    #[allow(dead_code)]
    pub async fn update_recording_stats(
        pool: &DbPool,
        recording_id: &str,
        segment_count: i32,
        total_size_bytes: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE session_recordings SET segment_count = $1, total_size_bytes = $2 WHERE id = $3",
        )
        .bind(segment_count)
        .bind(total_size_bytes)
        .bind(recording_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Count recordings for a project
    pub async fn count_recordings(pool: &DbPool, project_id: &str) -> Result<i64> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM session_recordings WHERE project_id = $1")
                .bind(project_id)
                .fetch_one(pool)
                .await?;

        Ok(row.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    async fn make_recording(pool: &DbPool, project_id: &str, session_id: &str) {
        let started_at = Utc::now();
        ReplayRepository::create_recording(
            pool, project_id, session_id, started_at, None, None, None,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn create_and_find_recording() {
        let pool = test_any_pool().await;
        let started_at = Utc::now();
        let rec = ReplayRepository::create_recording(
            &pool,
            "proj-1",
            "sess-1",
            started_at,
            Some("Mozilla/5.0"),
            Some(1920),
            Some(1080),
        )
        .await
        .unwrap();
        assert_eq!(rec.project_id, "proj-1");
        assert_eq!(rec.session_id, "sess-1");
        assert!(!*rec.is_complete);
        let found = ReplayRepository::find_recording(&pool, &rec.id)
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, rec.id);
    }

    #[tokio::test]
    async fn find_recording_missing_returns_none() {
        let pool = test_any_pool().await;
        let found = ReplayRepository::find_recording(&pool, "nope")
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn find_by_session_id() {
        let pool = test_any_pool().await;
        make_recording(&pool, "proj-2", "sess-fbs").await;
        let found = ReplayRepository::find_by_session_id(&pool, "proj-2", "sess-fbs")
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().session_id, "sess-fbs");
    }

    #[tokio::test]
    async fn create_segment_and_list_in_order() {
        let pool = test_any_pool().await;
        make_recording(&pool, "proj-3", "sess-seg").await;
        let rec = ReplayRepository::find_by_session_id(&pool, "proj-3", "sess-seg")
            .await
            .unwrap()
            .unwrap();
        ReplayRepository::create_segment(&pool, &rec.id, 0, b"chunk-0")
            .await
            .unwrap();
        ReplayRepository::create_segment(&pool, &rec.id, 1, b"chunk-1")
            .await
            .unwrap();
        let segments = ReplayRepository::list_segments(&pool, &rec.id)
            .await
            .unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].segment_index, 0);
        assert_eq!(segments[1].segment_index, 1);
    }

    #[tokio::test]
    async fn segment_upsert_replaces_on_conflict() {
        let pool = test_any_pool().await;
        make_recording(&pool, "proj-4", "sess-upsert").await;
        let rec = ReplayRepository::find_by_session_id(&pool, "proj-4", "sess-upsert")
            .await
            .unwrap()
            .unwrap();
        ReplayRepository::create_segment(&pool, &rec.id, 0, b"original")
            .await
            .unwrap();
        ReplayRepository::create_segment(&pool, &rec.id, 0, b"updated-data")
            .await
            .unwrap();
        let segments = ReplayRepository::list_segments(&pool, &rec.id)
            .await
            .unwrap();
        assert_eq!(segments.len(), 1);
        // size_bytes updated to length of "updated-data"
        assert_eq!(segments[0].size_bytes, b"updated-data".len() as i32);
    }

    #[tokio::test]
    async fn finish_recording_marks_complete() {
        let pool = test_any_pool().await;
        make_recording(&pool, "proj-5", "sess-finish").await;
        let rec = ReplayRepository::find_by_session_id(&pool, "proj-5", "sess-finish")
            .await
            .unwrap()
            .unwrap();
        assert!(!*rec.is_complete);
        ReplayRepository::finish_recording(&pool, &rec.id, Some(5000))
            .await
            .unwrap();
        let updated = ReplayRepository::find_recording(&pool, &rec.id)
            .await
            .unwrap()
            .unwrap();
        assert!(*updated.is_complete);
        assert_eq!(updated.duration_ms, Some(5000));
    }

    #[tokio::test]
    async fn list_recordings_and_count() {
        let pool = test_any_pool().await;
        make_recording(&pool, "proj-6", "sess-6a").await;
        make_recording(&pool, "proj-6", "sess-6b").await;
        make_recording(&pool, "proj-other", "sess-other").await;
        let recs = ReplayRepository::list_recordings(&pool, "proj-6", 10, 0)
            .await
            .unwrap();
        assert_eq!(recs.len(), 2);
        let count = ReplayRepository::count_recordings(&pool, "proj-6")
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn update_recording_stats() {
        let pool = test_any_pool().await;
        make_recording(&pool, "proj-7", "sess-stats").await;
        let rec = ReplayRepository::find_by_session_id(&pool, "proj-7", "sess-stats")
            .await
            .unwrap()
            .unwrap();
        ReplayRepository::update_recording_stats(&pool, &rec.id, 5, 10240)
            .await
            .unwrap();
        let updated = ReplayRepository::find_recording(&pool, &rec.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.segment_count, 5);
        assert_eq!(updated.total_size_bytes, 10240);
    }
}
