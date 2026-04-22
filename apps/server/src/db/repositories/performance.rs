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
                percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) as p50,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY duration_ms) as p75,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status != 'ok') as error_count
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
                percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) as p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
                COUNT(*) FILTER (WHERE status != 'ok') as error_count,
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
        let interval_pg = match interval {
            "5m" => "5 minutes",
            "15m" => "15 minutes",
            "1h" => "1 hour",
            "6h" => "6 hours",
            "1d" => "1 day",
            _ => return Err(anyhow::anyhow!("Unknown interval: {}", interval)),
        };

        let rows = sqlx::query_as::<
            _,
            (
                DateTime<Utc>,
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
                date_bin($4::interval, started_at, $2) as bucket,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY duration_ms) as p75,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99,
                COUNT(*)::float8 as throughput,
                COUNT(*) FILTER (WHERE status != 'ok')::bigint as error_count
            FROM transactions
            WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3
            GROUP BY bucket
            ORDER BY bucket
            "#,
        )
        .bind(project_id)
        .bind(start)
        .bind(end)
        .bind(interval_pg)
        .fetch_all(pool)
        .await?;

        let points = rows
            .into_iter()
            .map(|r| TimeSeriesPoint {
                timestamp: r.0,
                p50: r.1.unwrap_or(0.0),
                p75: r.2.unwrap_or(0.0),
                p95: r.3.unwrap_or(0.0),
                p99: r.4.unwrap_or(0.0),
                throughput: r.5.unwrap_or(0.0),
                error_count: r.6.unwrap_or(0),
            })
            .collect();

        Ok(points)
    }

    pub async fn cleanup_old_transactions(pool: &DbPool, days: i32) -> Result<u64> {
        // Spans are cascade-deleted via FK
        let mut total_deleted: u64 = 0;
        loop {
            let result = sqlx::query(
                "DELETE FROM transactions WHERE id IN (
                    SELECT id FROM transactions
                    WHERE started_at < NOW() - INTERVAL '1 day' * $1
                    LIMIT 5000
                )",
            )
            .bind(days)
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
