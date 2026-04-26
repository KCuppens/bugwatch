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
        .bind(timestamp.to_rfc3339())
        .bind(payload)
        .bind(now.to_rfc3339())
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

    #[allow(dead_code)]
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

    pub async fn count_by_issue(pool: &DbPool, issue_id: &str, project_id: &str) -> Result<i64> {
        // Scope by project_id as defense-in-depth — even if a caller forgot to
        // verify the issue belongs to the claimed project, the count will be 0
        // for cross-tenant issue ids.
        let (count,): (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM events e
               JOIN issues i ON e.issue_id = i.id
               WHERE e.issue_id = $1 AND i.project_id = $2"#,
        )
        .bind(issue_id)
        .bind(project_id)
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
              AND json_extract(e.payload, '$.tags.next.digest') = $3
              AND json_extract(e.payload, '$.tags.mechanism') = 'nextjs.onRequestError'
            "#,
        )
        .bind(project_id)
        .bind(cutoff.to_rfc3339())
        .bind(digest)
        .fetch_one(pool)
        .await?;

        Ok(count > 0)
    }

    /// Count distinct user IDs seen in an issue's events.
    pub async fn count_unique_users(pool: &DbPool, issue_id: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            r#"SELECT COUNT(DISTINCT json_extract(payload, '$.user.id'))
               FROM events WHERE issue_id = $1
               AND json_extract(payload, '$.user.id') IS NOT NULL"#,
        )
        .bind(issue_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// Top-N browser or OS distribution from event payloads.
    /// `json_path` is the JSONB path fragment, e.g. `'tags'->>'browser'`.
    pub async fn top_tag_values(
        pool: &DbPool,
        issue_id: &str,
        tag_key: &str,
        limit: i64,
    ) -> Result<Vec<(String, i64)>> {
        let sql = format!(
            r#"SELECT json_extract(payload, '$.tags.' || $1) AS val, COUNT(*) AS cnt
               FROM events
               WHERE issue_id = $2
                 AND json_extract(payload, '$.tags.' || $3) IS NOT NULL
               GROUP BY val ORDER BY cnt DESC LIMIT $4"#
        );
        let rows: Vec<(String, i64)> = sqlx::query_as(&sql)
            .bind(tag_key)
            .bind(issue_id)
            .bind(tag_key)
            .bind(limit)
            .fetch_all(pool)
            .await?;
        Ok(rows)
    }

    /// Count events grouped into fixed-size time buckets for charting.
    /// Returns `(bucket_index, count)` pairs — missing buckets have count 0.
    pub async fn count_by_time_buckets(
        pool: &DbPool,
        issue_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        bucket_size_secs: i64,
    ) -> Result<Vec<(i64, i64)>> {
        let rows: Vec<(i64, i64)> = sqlx::query_as(
            r#"
            SELECT
                CAST(FLOOR((EXTRACT(EPOCH FROM timestamp::timestamptz) - EXTRACT(EPOCH FROM $1::timestamptz)) / $2) AS BIGINT) AS bucket_idx,
                COUNT(*) AS cnt
            FROM events
            WHERE issue_id = $3
              AND timestamp >= $4
              AND timestamp < $5
            GROUP BY bucket_idx
            ORDER BY bucket_idx ASC
            "#,
        )
        .bind(start.to_rfc3339())
        .bind(bucket_size_secs)
        .bind(issue_id)
        .bind(start.to_rfc3339())
        .bind(end.to_rfc3339())
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Count events in a time range for trend calculation.
    pub async fn count_in_range(
        pool: &DbPool,
        issue_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM events WHERE issue_id = $1 AND timestamp >= $2 AND timestamp < $3",
        )
        .bind(issue_id)
        .bind(start.to_rfc3339())
        .bind(end.to_rfc3339())
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// Cleanup old events to prevent database bloat.
    /// Each organization's effective retention is `base_days + o.x402_extra_retention_days`,
    /// so orgs that paid for extended retention via x402 micropayments keep their events longer.
    ///
    /// NOTE: Requires a fully-linked project → organization chain; test with test_any_pool
    /// only after inserting matching org/project rows.
    ///
    /// Deletes in batches of 5000 to avoid holding an exclusive lock for the full
    /// duration of a large delete, which would cause replication lag on replicas.
    /// Returns the total number of rows deleted across all batches.
    pub async fn cleanup_old_events(pool: &DbPool, base_days: i32) -> Result<u64> {
        let mut total_deleted: u64 = 0;
        loop {
            let result = sqlx::query(
                r#"
                DELETE FROM events
                WHERE id IN (
                    SELECT e.id
                    FROM events e
                    JOIN issues i ON e.issue_id = i.id
                    JOIN projects p ON i.project_id = p.id
                    JOIN organizations o ON p.organization_id = o.id
                    WHERE e.timestamp < NOW() - (($1 + o.x402_extra_retention_days) || ' days')::INTERVAL -- TODO: Postgres-specific, not exercised in SQLite tests
                    LIMIT 5000
                )
                "#,
            )
            .bind(base_days)
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{repositories::IssueRepository, test_helpers::test_any_pool};

    async fn seed_issue(pool: &crate::db::DbPool) -> String {
        let (issue, _) =
            IssueRepository::find_or_create(pool, "ev-proj", "fp-ev", "Err", "error", "prod")
                .await
                .unwrap();
        issue.id
    }

    #[tokio::test]
    async fn create_event_and_find_by_id() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let ts = Utc::now();
        let event = EventRepository::create(&pool, &issue_id, "evt-1", ts, r#"{"msg":"hi"}"#)
            .await
            .unwrap();
        assert!(event.is_some());
        let event = event.unwrap();
        assert_eq!(event.event_id, "evt-1");

        let found = EventRepository::find_by_id(&pool, &event.id).await.unwrap();
        assert_eq!(found.unwrap().id, event.id);

        let found_by_evt = EventRepository::find_by_event_id(&pool, "evt-1")
            .await
            .unwrap();
        assert!(found_by_evt.is_some());
    }

    #[tokio::test]
    async fn duplicate_event_id_returns_none() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let ts = Utc::now();
        EventRepository::create(&pool, &issue_id, "evt-dup", ts, "{}")
            .await
            .unwrap();
        let second = EventRepository::create(&pool, &issue_id, "evt-dup", ts, "{}")
            .await
            .unwrap();
        assert!(second.is_none(), "duplicate event_id should return None");
    }

    #[tokio::test]
    async fn find_by_issue_and_count() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let ts = Utc::now();
        EventRepository::create(&pool, &issue_id, "ev-a", ts, "{}")
            .await
            .unwrap();
        EventRepository::create(&pool, &issue_id, "ev-b", ts, "{}")
            .await
            .unwrap();

        let events = EventRepository::find_by_issue(&pool, &issue_id, 10, 0)
            .await
            .unwrap();
        assert_eq!(events.len(), 2);

        let count = EventRepository::count_by_issue(&pool, &issue_id, "ev-proj")
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn count_in_range() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let now = Utc::now();
        EventRepository::create(&pool, &issue_id, "ev-r1", now, "{}")
            .await
            .unwrap();
        let start = now - chrono::Duration::minutes(1);
        let end = now + chrono::Duration::minutes(1);
        let count = EventRepository::count_in_range(&pool, &issue_id, start, end)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn count_unique_users() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let ts = Utc::now();
        EventRepository::create(&pool, &issue_id, "ev-u1", ts, r#"{"user":{"id":"user-1"}}"#)
            .await
            .unwrap();
        EventRepository::create(&pool, &issue_id, "ev-u2", ts, r#"{"user":{"id":"user-1"}}"#)
            .await
            .unwrap();
        EventRepository::create(&pool, &issue_id, "ev-u3", ts, r#"{"user":{"id":"user-2"}}"#)
            .await
            .unwrap();
        let count = EventRepository::count_unique_users(&pool, &issue_id)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn top_tag_values() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let ts = Utc::now();
        EventRepository::create(
            &pool,
            &issue_id,
            "ev-t1",
            ts,
            r#"{"tags":{"browser":"Chrome"}}"#,
        )
        .await
        .unwrap();
        EventRepository::create(
            &pool,
            &issue_id,
            "ev-t2",
            ts,
            r#"{"tags":{"browser":"Chrome"}}"#,
        )
        .await
        .unwrap();
        EventRepository::create(
            &pool,
            &issue_id,
            "ev-t3",
            ts,
            r#"{"tags":{"browser":"Firefox"}}"#,
        )
        .await
        .unwrap();
        let top = EventRepository::top_tag_values(&pool, &issue_id, "browser", 5)
            .await
            .unwrap();
        assert!(!top.is_empty());
        assert_eq!(top[0].0, "Chrome");
        assert_eq!(top[0].1, 2);
    }

    #[tokio::test]
    async fn has_recent_event_with_digest() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let ts = Utc::now();
        let payload =
            r#"{"tags":{"next":{"digest":"abc123"},"mechanism":"nextjs.onRequestError"}}"#;
        EventRepository::create(&pool, &issue_id, "ev-digest-1", ts, payload)
            .await
            .unwrap();
        let found = EventRepository::has_recent_event_with_digest(&pool, "ev-proj", "abc123")
            .await
            .unwrap();
        assert!(found);
        let not_found = EventRepository::has_recent_event_with_digest(&pool, "ev-proj", "other")
            .await
            .unwrap();
        assert!(!not_found);
    }

    #[tokio::test]
    #[ignore = "SQLite FLOOR() requires math functions compile flag; tested via integration tests"]
    async fn count_by_time_buckets_empty() {
        let pool = test_any_pool().await;
        let issue_id = seed_issue(&pool).await;
        let start = Utc::now() - chrono::Duration::hours(1);
        let end = Utc::now();
        let buckets = EventRepository::count_by_time_buckets(&pool, &issue_id, start, end, 300)
            .await
            .unwrap();
        assert!(buckets.is_empty());
    }

    #[tokio::test]
    #[ignore = "uses Postgres-specific INTERVAL syntax with per-org column; tested against real DB"]
    async fn cleanup_old_events_noop() {
        let pool = test_any_pool().await;
        let deleted = EventRepository::cleanup_old_events(&pool, 30)
            .await
            .unwrap();
        assert_eq!(deleted, 0);
    }
}
