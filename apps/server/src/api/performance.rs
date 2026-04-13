use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    billing::tiers::can_access_feature,
    db::models::Transaction,
    db::repositories::{
        OrganizationMemberRepository, OrganizationRepository, PerformanceRepository,
        ProjectRepository,
    },
    AppError, AppResult, AppState,
};

use super::events::extract_api_key;

// ============================================================================
// Ingestion Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct IngestTransactionPayload {
    pub transaction_name: String,
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub op: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub duration_ms: f64,
    pub started_at: String,
    pub finished_at: String,
    pub environment: Option<String>,
    pub release: Option<String>,
    pub tags: Option<serde_json::Value>,
    pub data: Option<serde_json::Value>,
    pub user_id: Option<String>,
    pub spans: Option<Vec<crate::db::repositories::performance::SpanInput>>,
}

#[derive(Debug, Serialize)]
pub struct IngestResponse {
    pub id: String,
    pub status: String,
}

// ============================================================================
// Query Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct TimeRangeQuery {
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TransactionListQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ChartQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub interval: Option<String>,
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /api/v1/transactions
///
/// Ingest performance transactions from SDKs.
/// Requires API key authentication via Bearer token or X-API-Key header.
pub async fn ingest_transaction(
    State(state): State<AppState>,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    headers: HeaderMap,
    Json(payload): Json<IngestTransactionPayload>,
) -> AppResult<(StatusCode, Json<IngestResponse>)> {
    tracing::info!("Transaction ingest request received");

    // 1. Extract API key
    let api_key = extract_api_key(&headers)?;

    // 2. Validate API key and get project
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    // 3. Check rate limit
    let rate_limit_result = state
        .rate_limiter
        .check_with_tier_lookup(
            &api_key,
            &state.db,
            state.config.deployment_mode,
            state.config.rate_limit_per_minute,
        )
        .await;

    if !rate_limit_result.allowed {
        return Err(AppError::RateLimitExceeded {
            retry_after_secs: rate_limit_result.retry_after_secs.unwrap_or(60),
            limit: rate_limit_result.limit,
            remaining: rate_limit_result.remaining,
        });
    }

    // 4. Check if project has performance monitoring access
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let tier_str = OrganizationRepository::get_project_tier(&state.db, &project.id)
            .await
            .unwrap_or_else(|_| "free".to_string());
        if !can_access_feature(&tier_str, "performance_monitoring") {
            let org_id = project.organization_id.as_deref().unwrap_or("");
            return Err(crate::payments::x402_feature_response(
                &state,
                "performance_monitoring",
                "/api/v1/transactions",
                org_id,
                None,
                "Performance monitoring requires a Pro plan or higher.",
            )
            .await);
        }
    }

    // 5. Parse timestamps
    let started_at = chrono::DateTime::parse_from_rfc3339(&payload.started_at)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| Utc::now());
    let finished_at = chrono::DateTime::parse_from_rfc3339(&payload.finished_at)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| Utc::now());

    // 5. Create transaction
    let txn_id = uuid::Uuid::new_v4().to_string();
    let transaction = Transaction {
        id: txn_id.clone(),
        project_id: project.id.clone(),
        transaction_name: payload.transaction_name,
        trace_id: payload.trace_id,
        span_id: payload.span_id,
        parent_span_id: payload.parent_span_id,
        op: payload.op,
        description: payload.description,
        status: payload.status.unwrap_or_else(|| "ok".to_string()),
        duration_ms: payload.duration_ms,
        started_at,
        finished_at,
        environment: payload.environment,
        release: payload.release,
        tags: payload.tags.map(|t| t.to_string()),
        data: payload.data.map(|d| d.to_string()),
        user_id: payload.user_id,
        created_at: Utc::now(),
    };

    PerformanceRepository::create_transaction(&state.db, &transaction).await?;

    // 6. Create spans if provided
    if let Some(spans) = payload.spans {
        if !spans.is_empty() {
            PerformanceRepository::create_spans(&state.db, &txn_id, &spans).await?;
        }
    }

    tracing::info!("Transaction {} ingested for project {}", txn_id, project.id);

    Ok((
        StatusCode::ACCEPTED,
        Json(IngestResponse {
            id: txn_id,
            status: "accepted".to_string(),
        }),
    ))
}

/// GET /api/v1/projects/:project_id/performance/summary
pub async fn get_summary(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Query(query): Query<TimeRangeQuery>,
) -> AppResult<Json<serde_json::Value>> {
    // Feature gate
    check_performance_access(&state, &user, &project_id, x402_verified.as_ref()).await?;

    // Verify project access
    verify_project_access(&state, &project_id, &user).await?;

    let (start, end) = parse_time_range(query.start.as_deref(), query.end.as_deref(), 24);

    let summary = PerformanceRepository::get_summary(&state.db, &project_id, start, end).await?;

    Ok(Json(serde_json::json!({ "data": summary })))
}

/// GET /api/v1/projects/:project_id/performance/transactions
pub async fn list_transactions(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Query(query): Query<TransactionListQuery>,
) -> AppResult<Json<serde_json::Value>> {
    check_performance_access(&state, &user, &project_id, x402_verified.as_ref()).await?;
    verify_project_access(&state, &project_id, &user).await?;

    let (start, end) = parse_time_range(query.start.as_deref(), query.end.as_deref(), 24);
    let limit = query.limit.unwrap_or(20).min(100);

    let transactions =
        PerformanceRepository::list_transaction_names(&state.db, &project_id, start, end, limit)
            .await?;

    Ok(Json(serde_json::json!({ "data": transactions })))
}

/// GET /api/v1/projects/:project_id/performance/charts
pub async fn get_charts(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Query(query): Query<ChartQuery>,
) -> AppResult<Json<serde_json::Value>> {
    check_performance_access(&state, &user, &project_id, x402_verified.as_ref()).await?;
    verify_project_access(&state, &project_id, &user).await?;

    let (start, end) = parse_time_range(query.start.as_deref(), query.end.as_deref(), 24);
    let interval = query.interval.as_deref().unwrap_or("1h");

    let points =
        PerformanceRepository::get_time_series(&state.db, &project_id, start, end, interval)
            .await?;

    Ok(Json(serde_json::json!({ "data": points })))
}

// ============================================================================
// Helpers
// ============================================================================

async fn check_performance_access(
    state: &AppState,
    user: &AuthUser,
    project_id: &str,
    x402_verified: Option<&axum::Extension<crate::payments::X402PaymentVerified>>,
) -> AppResult<()> {
    if state.config.deployment_mode.is_self_hosted() {
        return Ok(());
    }

    if state.config.x402_enabled && x402_verified.is_some() {
        return Ok(());
    }

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await?
        .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;

    if !can_access_feature(&org.tier, "performance_monitoring") {
        return Err(crate::payments::x402_feature_response(
            state,
            "performance_monitoring",
            &format!("/api/v1/projects/{}/performance", project_id),
            &org.id,
            None,
            "Performance monitoring requires Pro tier or higher. Please upgrade to access this feature.",
        ).await);
    }

    Ok(())
}

async fn verify_project_access(
    state: &AppState,
    project_id: &str,
    user: &AuthUser,
) -> AppResult<()> {
    let project = ProjectRepository::find_by_id(&state.db, project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != user.id {
        // Check organization membership
        if let Some(org_id) = &project.organization_id {
            let is_member =
                OrganizationMemberRepository::is_member(&state.db, org_id, &user.id).await?;
            if !is_member {
                return Err(AppError::Forbidden("Access denied".to_string()));
            }
        } else {
            return Err(AppError::Forbidden("Access denied".to_string()));
        }
    }

    Ok(())
}

fn parse_time_range(
    start: Option<&str>,
    end: Option<&str>,
    default_hours: i64,
) -> (chrono::DateTime<Utc>, chrono::DateTime<Utc>) {
    let end_dt = end
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let start_dt = start
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|| end_dt - Duration::hours(default_hours));

    (start_dt, end_dt)
}
