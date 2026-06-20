use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::models::Transaction;
use crate::db::DbPool;

#[derive(Debug, Serialize)]
pub struct PerformanceSummary {
    pub p50: f64,
    pub p75: f64,
    pub p95: f64,
    pub p99: f64,
    pub throughput: f64,
    pub error_rate: f64,
    pub total_transactions: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionAggregate {
    pub transaction_name: String,
    pub count: i64,
    pub p50: f64,
    pub p95: f64,
    pub error_rate: f64,
    pub avg_duration_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeSeriesPoint {
    pub timestamp: DateTime<Utc>,
    pub p50: f64,
    pub p75: f64,
    pub p95: f64,
    pub p99: f64,
    pub throughput: f64,
    pub error_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct SpanInput {
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub op: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub duration_ms: f64,
    pub started_at: String,
    pub finished_at: String,
    pub data: Option<serde_json::Value>,
}

pub struct PerformanceRepository;

impl PerformanceRepository {
    pub async fn create_transaction(
        pool: &DbPool,
        transaction: &Transaction,
    ) -> Result<Transaction> {
        let row = sqlx::query_as::<_, Transaction>(
            r#"
            INSERT INTO transactions (id, project_id, transaction_name, trace_id, span_id, parent_span_id, op, description, status, duration_ms, started_at, finished_at, environment, release, tags, data, user_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
            "#,
        )
        .bind(&transaction.id)
        .bind(&transaction.project_id)
        .bind(&transaction.transaction_name)
        .bind(&transaction.trace_id)
        .bind(&transaction.span_id)
        .bind(&transaction.parent_span_id)
        .bind(&transaction.op)
        .bind(&transaction.description)
        .bind(&transaction.status)
        .bind(transaction.duration_ms)
        .bind(transaction.started_at)
        .bind(transaction.finished_at)
        .bind(&transaction.environment)
        .bind(&transaction.release)
        .bind(&transaction.tags)
        .bind(&transaction.data)
        .bind(&transaction.user_id)
        .bind(transaction.created_at)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    pub async fn create_spans(
        pool: &DbPool,
        transaction_id: &str,
        spans: &[SpanInput],
    ) -> Result<()> {
        if spans.is_empty() {
            return Ok(());
        }

        struct SpanRow {
            id: String,
            transaction_id: String,
            span_id: String,
            parent_span_id: Option<String>,
            op: String,
            description: Option<String>,
            status: Option<String>,
            duration_ms: f64,
            started_at: DateTime<Utc>,
            finished_at: DateTime<Utc>,
            data_str: Option<String>,
            created_at: DateTime<Utc>,
        }

        let now = Utc::now();
        let rows: Vec<SpanRow> = spans
            .iter()
            .map(|span| SpanRow {
                id: uuid::Uuid::new_v4().to_string(),
                transaction_id: transaction_id.to_owned(),
                span_id: span.span_id.clone(),
                parent_span_id: span.parent_span_id.clone(),
                op: span.op.clone(),
                description: span.description.clone(),
                status: span.status.clone(),
                duration_ms: span.duration_ms,
                started_at: chrono::DateTime::parse_from_rfc3339(&span.started_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or(now),
                finished_at: chrono::DateTime::parse_from_rfc3339(&span.finished_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or(now),
                data_str: span.data.as_ref().map(|d| d.to_string()),
                created_at: now,
            })
            .collect();

        let mut qb: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
            "INSERT INTO spans (id, transaction_id, span_id, parent_span_id, op, description, status, duration_ms, started_at, finished_at, data, created_at) ",
        );

        qb.push_values(rows, |mut b, row| {
            b.push_bind(row.id)
                .push_bind(row.transaction_id)
                .push_bind(row.span_id)
                .push_bind(row.parent_span_id)
                .push_bind(row.op)
                .push_bind(row.description)
                .push_bind(row.status)
                .push_bind(row.duration_ms)
                .push_bind(row.started_at)
                .push_bind(row.finished_at)
                .push_bind(row.data_str)
                .push_bind(row.created_at);
        });

        qb.build().execute(pool).await?;

        Ok(())
    }

    pub async fn get_summary(
        pool: &DbPool,
        project_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<PerformanceSummary> {
        let row = sqlx::query_as::<
            _,
            (
                Option<f64>,
                Option<f64>,
                Option<f64>,
                Option<f64>,
                Option<i64>,
                Option<i64>,
            ),
        >(
            r#"
            SELECT
                AVG(duration_ms) as p50,
                AVG(duration_ms) as p75,
                MAX(duration_ms) as p95,
                MAX(duration_ms) as p99,
                COUNT(*) as total,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as error_count
            FROM transactions
            WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3
            "#,
        )
        .bind(project_id)
        .bind(start)
        .bind(end)
        .fetch_one(pool)
        .await?;

        let total = row.4.unwrap_or(0);
        let error_count = row.5.unwrap_or(0);
        let duration_minutes = (end - start).num_minutes().max(1) as f64;

        Ok(PerformanceSummary {
            p50: row.0.unwrap_or(0.0),
            p75: row.1.unwrap_or(0.0),
            p95: row.2.unwrap_or(0.0),
            p99: row.3.unwrap_or(0.0),
            throughput: total as f64 / duration_minutes,
            error_rate: if total > 0 {
                (error_count as f64 / total as f64) * 100.0
            } else {
                0.0
            },
            total_transactions: total,
        })
    }

    pub async fn list_transaction_names(
        pool: &DbPool,
        project_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<TransactionAggregate>> {
        let limit = limit.max(1).min(10_000);
        let rows = sqlx::query_as::<
            _,
            (
                String,
                i64,
                Option<f64>,
                Option<f64>,
                Option<i64>,
                Option<f64>,
            ),
        >(
            r#"
            SELECT
                transaction_name,
                COUNT(*) as count,
                AVG(duration_ms) as p50,
                MAX(duration_ms) as p95,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as error_count,
                AVG(duration_ms) as avg_duration_ms
            FROM transactions
            WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3
            GROUP BY transaction_name
            ORDER BY count DESC
            LIMIT $4
            "#,
        )
        .bind(project_id)
        .bind(start)
        .bind(end)
        .bind(limit)
        .fetch_all(pool)
        .await?;

        let aggregates = rows
            .into_iter()
            .map(|r| {
                let count = r.1;
                let error_count = r.4.unwrap_or(0);
                TransactionAggregate {
                    transaction_name: r.0,
                    count,
                    p50: r.2.unwrap_or(0.0),
                    p95: r.3.unwrap_or(0.0),
                    error_rate: if count > 0 {
                        (error_count as f64 / count as f64) * 100.0
                    } else {
                        0.0
                    },
                    avg_duration_ms: r.5.unwrap_or(0.0),
                }
            })
            .collect();

        Ok(aggregates)
    }

    pub async fn get_time_series(
        pool: &DbPool,
        project_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        interval: &str,
    ) -> Result<Vec<TimeSeriesPoint>> {
        let interval_secs: i64 = match interval {
            "5m" => 300,
            "15m" => 900,
            "1h" => 3600,
            "6h" => 21600,
            "1d" => 86400,
            _ => return Err(anyhow::anyhow!("Unknown interval: {}", interval)),
        };

        // Use epoch-based bucketing for PostgreSQL via Any driver.
        // bucket_epoch is the start of each interval bucket as a Unix timestamp.
        let rows = sqlx::query_as::<
            _,
            (
                i64,
                Option<f64>,
                Option<f64>,
                Option<f64>,
                Option<f64>,
                Option<f64>,
                Option<i64>,
            ),
        >(
            r#"
            SELECT
                (CAST(FLOOR(EXTRACT(EPOCH FROM started_at::timestamptz) / $1) AS BIGINT)) * $2 as bucket_epoch,
                AVG(duration_ms) as p50,
                AVG(duration_ms) as p75,
                MAX(duration_ms) as p95,
                MAX(duration_ms) as p99,
                CAST(COUNT(*) AS FLOAT8) as throughput,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as error_count
            FROM transactions
            WHERE project_id = $3 AND started_at >= $4 AND started_at <= $5
            GROUP BY bucket_epoch
            ORDER BY bucket_epoch
            "#,
        )
        .bind(interval_secs)
        .bind(interval_secs)
        .bind(project_id)
        .bind(start)
        .bind(end)
        .fetch_all(pool)
        .await?;

        let points = rows
            .into_iter()
            .map(|r| {
                let ts = chrono::DateTime::from_timestamp(r.0, 0)
                    .unwrap_or_else(|| chrono::DateTime::UNIX_EPOCH);
                TimeSeriesPoint {
                    timestamp: ts,
                    p50: r.1.unwrap_or(0.0),
                    p75: r.2.unwrap_or(0.0),
                    p95: r.3.unwrap_or(0.0),
                    p99: r.4.unwrap_or(0.0),
                    throughput: r.5.unwrap_or(0.0),
                    error_count: r.6.unwrap_or(0),
                }
            })
            .collect();

        Ok(points)
    }

    pub async fn cleanup_old_transactions(pool: &DbPool, days: i32) -> Result<u64> {
        // Spans are cascade-deleted via FK
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        let mut total_deleted: u64 = 0;
        loop {
            let result = sqlx::query(
                "DELETE FROM transactions WHERE id IN (
                    SELECT id FROM transactions
                    WHERE started_at < $1
                    LIMIT 5000
                )",
            )
            .bind(&cutoff)
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
    use crate::db::{models::Transaction, test_helpers::test_any_pool, types::Timestamp};
    use uuid::Uuid;

    fn make_transaction(project_id: &str) -> Transaction {
        let now = Timestamp::now();
        Transaction {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            transaction_name: "GET /api/test".to_string(),
            trace_id: "trace-1".to_string(),
            span_id: "span-1".to_string(),
            parent_span_id: None,
            op: "http.server".to_string(),
            description: None,
            status: "ok".to_string(),
            duration_ms: 120.5,
            started_at: now,
            finished_at: now,
            environment: Some("production".to_string()),
            release: None,
            tags: None,
            data: None,
            user_id: None,
            created_at: now,
        }
    }

    #[tokio::test]
    async fn create_and_retrieve_transaction() {
        let pool = test_any_pool().await;
        let tx = make_transaction("proj-1");
        let created = PerformanceRepository::create_transaction(&pool, &tx)
            .await
            .unwrap();
        assert_eq!(created.id, tx.id);
        assert_eq!(created.transaction_name, "GET /api/test");
        assert_eq!(created.status, "ok");
    }

    #[tokio::test]
    async fn create_spans_empty_is_noop() {
        let pool = test_any_pool().await;
        let tx = make_transaction("proj-spans-empty");
        PerformanceRepository::create_transaction(&pool, &tx)
            .await
            .unwrap();
        PerformanceRepository::create_spans(&pool, &tx.id, &[])
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn create_spans_inserts_rows() {
        let pool = test_any_pool().await;
        let tx = make_transaction("proj-spans2");
        PerformanceRepository::create_transaction(&pool, &tx)
            .await
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let spans = vec![
            SpanInput {
                span_id: "s1".to_string(),
                parent_span_id: None,
                op: "db.query".to_string(),
                description: Some("SELECT * FROM users".to_string()),
                status: Some("ok".to_string()),
                duration_ms: 10.0,
                started_at: now.clone(),
                finished_at: now.clone(),
                data: None,
            },
            SpanInput {
                span_id: "s2".to_string(),
                parent_span_id: Some("s1".to_string()),
                op: "cache".to_string(),
                description: None,
                status: None,
                duration_ms: 1.0,
                started_at: now.clone(),
                finished_at: now.clone(),
                data: None,
            },
        ];
        PerformanceRepository::create_spans(&pool, &tx.id, &spans)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn get_summary_empty_project() {
        let pool = test_any_pool().await;
        let start = chrono::Utc::now() - chrono::Duration::hours(1);
        let end = chrono::Utc::now();
        let summary = PerformanceRepository::get_summary(&pool, "empty-proj", start, end)
            .await
            .unwrap();
        assert_eq!(summary.total_transactions, 0);
        assert_eq!(summary.error_rate, 0.0);
    }

    #[tokio::test]
    async fn get_summary_counts_transactions() {
        let pool = test_any_pool().await;
        let tx = make_transaction("proj-sum");
        PerformanceRepository::create_transaction(&pool, &tx)
            .await
            .unwrap();
        let start = chrono::Utc::now() - chrono::Duration::hours(1);
        let end = chrono::Utc::now() + chrono::Duration::hours(1);
        let summary = PerformanceRepository::get_summary(&pool, "proj-sum", start, end)
            .await
            .unwrap();
        assert_eq!(summary.total_transactions, 1);
        assert!(summary.p50 > 0.0);
    }

    #[tokio::test]
    async fn list_transaction_names_aggregates() {
        let pool = test_any_pool().await;
        let tx = make_transaction("proj-agg");
        PerformanceRepository::create_transaction(&pool, &tx)
            .await
            .unwrap();
        let start = chrono::Utc::now() - chrono::Duration::hours(1);
        let end = chrono::Utc::now() + chrono::Duration::hours(1);
        let names =
            PerformanceRepository::list_transaction_names(&pool, "proj-agg", start, end, 10)
                .await
                .unwrap();
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].transaction_name, "GET /api/test");
        assert_eq!(names[0].count, 1);
    }

    #[tokio::test]
    #[ignore = "uses EXTRACT(EPOCH FROM ...) which is Postgres-specific; not supported by SQLite Any driver"]
    async fn get_time_series_empty_project() {
        let pool = test_any_pool().await;
        let start = chrono::Utc::now() - chrono::Duration::hours(1);
        let end = chrono::Utc::now();
        let points = PerformanceRepository::get_time_series(&pool, "ts-empty", start, end, "5m")
            .await
            .unwrap();
        assert!(points.is_empty());
    }

    #[tokio::test]
    async fn get_time_series_invalid_interval_errors() {
        let pool = test_any_pool().await;
        let start = chrono::Utc::now() - chrono::Duration::hours(1);
        let end = chrono::Utc::now();
        let result =
            PerformanceRepository::get_time_series(&pool, "ts-proj", start, end, "bad").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn cleanup_old_transactions_noop_when_none_old() {
        let pool = test_any_pool().await;
        let deleted = PerformanceRepository::cleanup_old_transactions(&pool, 30)
            .await
            .unwrap();
        assert_eq!(deleted, 0);
    }
}
