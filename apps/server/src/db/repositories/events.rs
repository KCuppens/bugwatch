use crate::db::{models::Event, DbPool};
use anyhow::Result;
use chrono::{DateTime, Utc};
use uuid::Uuid;

pub struct EventRepository;

impl EventRepository {
    /// Insert an event, returning None if a duplicate event_id already exists.
    pub async fn create(
        pool: &DbPool,
        issue_id: &str,
        event_id: &str,
        timestamp: DateTime<Utc>,
        payload: &str,
    ) -> Result<Option<Event>> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, Event>(
            r#"
            INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(issue_id)
        .bind(event_id)
        .bind(timestamp)
        .bind(payload)
        .bind(now)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Event>> {
        sqlx::query_as::<_, Event>("SELECT * FROM events WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn find_by_event_id(pool: &DbPool, event_id: &str) -> Result<Option<Event>> {
        sqlx::query_as::<_, Event>("SELECT * FROM events WHERE event_id = $1")
            .bind(event_id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn find_by_issue(
        pool: &DbPool,
        issue_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Event>> {
        sqlx::query_as::<_, Event>(
            "SELECT * FROM events WHERE issue_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3",
        )
        .bind(issue_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn count_by_issue(pool: &DbPool, issue_id: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE issue_id = $1")
            .bind(issue_id)
            .fetch_one(pool)
            .await?;
        Ok(count)
    }

    /// Check if a recent event with a matching Next.js digest exists for a project.
    /// Used to deduplicate client error boundary events when onRequestError
    /// already captured the same server error.
    pub async fn has_recent_event_with_digest(
        pool: &DbPool,
        project_id: &str,
        digest: &str,
    ) -> Result<bool> {
        let cutoff = Utc::now() - chrono::Duration::seconds(30);

        let (count,): (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM events e
            JOIN issues i ON e.issue_id = i.id
            WHERE i.project_id = $1
              AND e.timestamp > $2
              AND e.payload::jsonb -> 'tags' ->> 'next.digest' = $3
              AND e.payload::jsonb -> 'tags' ->> 'mechanism' = 'nextjs.onRequestError'
            "#,
        )
        .bind(project_id)
        .bind(cutoff)
        .bind(digest)
        .fetch_one(pool)
        .await?;

        Ok(count > 0)
    }

    /// Cleanup old events to prevent database bloat.
    /// Each organization's effective retention is `base_days + o.x402_extra_retention_days`,
    /// so orgs that paid for extended retention via x402 micropayments keep their events longer.
    pub async fn cleanup_old_events(pool: &DbPool, base_days: i32) -> Result<u64> {
        let result = sqlx::query(
            r#"
            DELETE FROM events
            WHERE id IN (
                SELECT e.id
                FROM events e
                JOIN issues i ON e.issue_id = i.id
                JOIN projects p ON i.project_id = p.id
                JOIN organizations o ON p.organization_id = o.id
                WHERE e.timestamp < NOW() - make_interval(days => $1 + o.x402_extra_retention_days)
            )
            "#,
        )
        .bind(base_days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }
}
