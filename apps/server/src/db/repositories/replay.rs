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
            "SELECT * FROM session_segments WHERE recording_id = $1 ORDER BY segment_index ASC",
        )
        .bind(recording_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Mark a recording as complete
    pub async fn finish_recording(pool: &DbPool, id: &str, duration_ms: Option<i32>) -> Result<()> {
        sqlx::query(
            "UPDATE session_recordings SET is_complete = true, duration_ms = $2 WHERE id = $1",
        )
        .bind(id)
        .bind(duration_ms)
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

        // Segments are cascade-deleted when recordings are deleted
        let result = sqlx::query("DELETE FROM session_recordings WHERE started_at < $1")
            .bind(cutoff)
            .execute(pool)
            .await?;

        Ok(result.rows_affected())
    }

    /// Update recording stats (segment count and total size)
    pub async fn update_recording_stats(
        pool: &DbPool,
        recording_id: &str,
        segment_count: i32,
        total_size_bytes: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE session_recordings SET segment_count = $2, total_size_bytes = $3 WHERE id = $1",
        )
        .bind(recording_id)
        .bind(segment_count)
        .bind(total_size_bytes)
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
