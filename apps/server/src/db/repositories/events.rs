use crate::db::{models::Event, DbPool};
use anyhow::Result;
use chrono::{DateTime, Utc};
use uuid::Uuid;

pub struct EventRepository;

impl EventRepository {
    pub async fn create(
        pool: &DbPool,
        issue_id: &str,
        event_id: &str,
        timestamp: DateTime<Utc>,
        payload: &str,
    ) -> Result<Event> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query_as::<_, Event>(
            r#"
            INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(issue_id)
        .bind(event_id)
        .bind(timestamp)
        .bind(payload)
        .bind(now)
        .fetch_one(pool)
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

    /// Cleanup old events to prevent database bloat
    pub async fn cleanup_old_events(pool: &DbPool, days: i32) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM events WHERE timestamp < NOW() - INTERVAL '1 day' * $1",
        )
        .bind(days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }
}
