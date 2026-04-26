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
    tracing::debug!("Transaction ingest request received");

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

    // 5. Validate field lengths
    if payload.transaction_name.len() > 200 {
        return Err(AppError::Validation(
            "transaction_name too long (max 200 bytes)".into(),
        ));
    }
    if payload.trace_id.len() > 64 {
        return Err(AppError::Validation(
            "trace_id too long (max 64 bytes)".into(),
        ));
    }
    if payload.span_id.len() > 64 {
        return Err(AppError::Validation(
            "span_id too long (max 64 bytes)".into(),
        ));
    }
    if payload.op.len() > 128 {
        return Err(AppError::Validation("op too long (max 128 bytes)".into()));
    }
    if payload.environment.as_deref().map(|s| s.len()).unwrap_or(0) > 64 {
        return Err(AppError::Validation(
            "environment too long (max 64 bytes)".into(),
        ));
    }
    if payload.release.as_deref().map(|s| s.len()).unwrap_or(0) > 200 {
        return Err(AppError::Validation(
            "release too long (max 200 bytes)".into(),
        ));
    }

    // 6. Parse timestamps
    let started_at = chrono::DateTime::parse_from_rfc3339(&payload.started_at)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|e| {
            tracing::warn!(timestamp = %payload.started_at, error = %e, "Invalid started_at RFC3339 timestamp");
            AppError::Validation("started_at must be a valid RFC3339 timestamp".into())
        })?;
    let finished_at = chrono::DateTime::parse_from_rfc3339(&payload.finished_at)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|e| {
            tracing::warn!(timestamp = %payload.finished_at, error = %e, "Invalid finished_at RFC3339 timestamp");
            AppError::Validation("finished_at must be a valid RFC3339 timestamp".into())
        })?;

    // Validate tags/data size to prevent unbounded payload storage
    const MAX_FIELD_SIZE: usize = 65_536; // 64 KB
    if let Some(ref t) = payload.tags {
        if serde_json::to_vec(t).map(|v| v.len()).unwrap_or(0) > MAX_FIELD_SIZE {
            return Err(AppError::Validation("tags exceeds 64 KB limit".into()));
        }
    }
    if let Some(ref d) = payload.data {
        if serde_json::to_vec(d).map(|v| v.len()).unwrap_or(0) > MAX_FIELD_SIZE {
            return Err(AppError::Validation("data exceeds 64 KB limit".into()));
        }
    }

    // 7. Create transaction
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
        started_at: crate::db::types::Timestamp(started_at),
        finished_at: crate::db::types::Timestamp(finished_at),
        environment: payload.environment,
        release: payload.release,
        tags: payload.tags.map(|t| t.to_string()),
        data: payload.data.map(|d| d.to_string()),
        user_id: payload.user_id,
        created_at: crate::db::types::Timestamp(Utc::now()),
    };

    PerformanceRepository::create_transaction(&state.db, &transaction).await?;

    // 8. Create spans if provided (cap at 100 to prevent unbounded DB inserts)
    if let Some(spans) = payload.spans {
        if spans.len() > 100 {
            return Err(AppError::Validation(
                "Too many spans per transaction (max 100)".into(),
            ));
        }
        if !spans.is_empty() {
            PerformanceRepository::create_spans(&state.db, &txn_id, &spans).await?;
        }
    }

    tracing::debug!("Transaction {} ingested for project {}", txn_id, project.id);

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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use tower::ServiceExt;

    async fn make_app() -> axum::Router {
        let state = crate::db::test_helpers::test_app_state().await;
        axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state)
    }

    fn peer() -> std::net::SocketAddr {
        "127.0.0.1:1234".parse().unwrap()
    }

    async fn signup_and_get_token(app: &axum::Router, email: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(format!(
                r#"{{"email":"{}","password":"StrongPass1!"}}"#,
                email
            )))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        for v in resp.headers().get_all("set-cookie") {
            let s = v.to_str().unwrap_or("");
            if let Some(rest) = s.strip_prefix("access_token=") {
                return rest.split(';').next().unwrap_or("").to_string();
            }
        }
        panic!("no access_token in signup response");
    }

    async fn create_project_with_key(app: &axum::Router, token: &str) -> (String, String) {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Perf Test Project"}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let id = json["data"]["id"].as_str().unwrap().to_string();
        let key = json["data"]["api_key"].as_str().unwrap().to_string();
        (id, key)
    }

    fn valid_payload() -> &'static str {
        r#"{
            "transaction_name": "GET /api/users",
            "trace_id": "abc123",
            "span_id": "span001",
            "op": "http.server",
            "duration_ms": 42.0,
            "started_at": "2024-01-01T00:00:00Z",
            "finished_at": "2024-01-01T00:00:00.042Z"
        }"#
    }

    // ── parse_time_range ──────────────────────────────────────────────────────

    #[test]
    fn parse_time_range_no_args_defaults_24h() {
        let before = Utc::now() - Duration::hours(25);
        let (start, end) = parse_time_range(None, None, 24);
        assert!(end > before, "end should be close to now");
        let diff_hours = (end - start).num_hours();
        assert_eq!(diff_hours, 24);
    }

    #[test]
    fn parse_time_range_valid_rfc3339_parsed() {
        let (start, end) = parse_time_range(
            Some("2024-01-01T00:00:00Z"),
            Some("2024-01-02T00:00:00Z"),
            24,
        );
        assert_eq!(end - start, Duration::hours(24));
    }

    #[test]
    fn parse_time_range_invalid_end_falls_back_to_now() {
        let before = Utc::now() - Duration::minutes(1);
        let (_, end) = parse_time_range(None, Some("not-a-date"), 24);
        assert!(end >= before, "invalid end should default to now");
    }

    #[test]
    fn parse_time_range_invalid_start_falls_back_to_default() {
        let (start, end) = parse_time_range(Some("bad"), Some("2024-06-01T12:00:00Z"), 6);
        let diff_hours = (end - start).num_hours();
        assert_eq!(
            diff_hours, 6,
            "invalid start should default to end minus default_hours"
        );
    }

    #[test]
    fn parse_time_range_custom_default_hours() {
        let (start, end) = parse_time_range(None, None, 1);
        let diff_mins = (end - start).num_minutes();
        assert_eq!(diff_mins, 60);
    }

    // ── ingest_transaction auth/validation ────────────────────────────────────

    #[tokio::test]
    async fn ingest_transaction_without_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .body(Body::from(valid_payload()))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_transaction_invalid_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", "invalid-key")
            .body(Body::from(valid_payload()))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_transaction_name_too_long_returns_400() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_long_name@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long_name = "x".repeat(201);
        let body = format!(
            r#"{{"transaction_name":"{}","trace_id":"t","span_id":"s","op":"http","duration_ms":1.0,"started_at":"2024-01-01T00:00:00Z","finished_at":"2024-01-01T00:00:01Z"}}"#,
            long_name
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_transaction_invalid_timestamp_returns_400() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_bad_ts@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let body = r#"{"transaction_name":"GET /","trace_id":"t","span_id":"s","op":"http","duration_ms":1.0,"started_at":"not-a-date","finished_at":"2024-01-01T00:00:01Z"}"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_transaction_succeeds_with_valid_payload() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_valid@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(valid_payload()))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }

    // ── auth guards for dashboard endpoints ──────────────────────────────────

    #[tokio::test]
    async fn get_summary_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/performance/summary")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn list_transactions_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/performance/transactions")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn get_charts_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/performance/charts")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── dashboard happy paths ─────────────────────────────────────────────────

    #[tokio::test]
    async fn get_summary_returns_200() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "perf_summary@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/v1/projects/{}/performance/summary",
                project_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn list_transactions_returns_200() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "perf_txlist@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/v1/projects/{}/performance/transactions",
                project_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    // get_charts_returns_200 is omitted: get_time_series uses EXTRACT(EPOCH FROM
    // ...::timestamptz) which is Postgres-only and always 500s on the SQLite test backend.

    #[tokio::test]
    async fn get_summary_project_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "perf_404@example.com").await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/nonexistent/performance/summary")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    // ── ingest additional field validation ────────────────────────────────────

    #[tokio::test]
    async fn ingest_transaction_trace_id_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_trace@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long = "x".repeat(65);
        let body = format!(
            r#"{{"transaction_name":"GET /","trace_id":"{}","span_id":"s","op":"http","duration_ms":1.0,"started_at":"2024-01-01T00:00:00Z","finished_at":"2024-01-01T00:00:01Z"}}"#,
            long
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_transaction_span_id_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_spanid@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long = "x".repeat(65);
        let body = format!(
            r#"{{"transaction_name":"GET /","trace_id":"t","span_id":"{}","op":"http","duration_ms":1.0,"started_at":"2024-01-01T00:00:00Z","finished_at":"2024-01-01T00:00:01Z"}}"#,
            long
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_transaction_op_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_oplong@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long = "x".repeat(129);
        let body = format!(
            r#"{{"transaction_name":"GET /","trace_id":"t","span_id":"s","op":"{}","duration_ms":1.0,"started_at":"2024-01-01T00:00:00Z","finished_at":"2024-01-01T00:00:01Z"}}"#,
            long
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_transaction_invalid_finished_at_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_finbad@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let body = r#"{"transaction_name":"GET /","trace_id":"t","span_id":"s","op":"http","duration_ms":1.0,"started_at":"2024-01-01T00:00:00Z","finished_at":"not-a-date"}"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_transaction_with_spans_succeeds() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_spans@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let body = r#"{
            "transaction_name": "GET /api/users",
            "trace_id": "trace1",
            "span_id": "root1",
            "op": "http.server",
            "duration_ms": 42.0,
            "started_at": "2024-01-01T00:00:00Z",
            "finished_at": "2024-01-01T00:00:00.042Z",
            "spans": [
                {
                    "span_id": "child1",
                    "parent_span_id": "root1",
                    "op": "db.query",
                    "description": "SELECT 1",
                    "duration_ms": 10.0,
                    "started_at": "2024-01-01T00:00:00Z",
                    "finished_at": "2024-01-01T00:00:00.010Z",
                    "status": "ok"
                }
            ]
        }"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }

    #[tokio::test]
    async fn ingest_transaction_too_many_spans_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "txn_manyspan@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let spans: Vec<serde_json::Value> = (0..101)
            .map(|i| {
                serde_json::json!({
                    "span_id": format!("span{}", i),
                    "parent_span_id": "root1",
                    "op": "db.query",
                    "duration_ms": 1.0,
                    "started_at": "2024-01-01T00:00:00Z",
                    "finished_at": "2024-01-01T00:00:00.001Z"
                })
            })
            .collect();
        let body = serde_json::json!({
            "transaction_name": "GET /",
            "trace_id": "t",
            "span_id": "root1",
            "op": "http",
            "duration_ms": 1.0,
            "started_at": "2024-01-01T00:00:00Z",
            "finished_at": "2024-01-01T00:00:01Z",
            "spans": spans
        })
        .to_string();
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/transactions")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
