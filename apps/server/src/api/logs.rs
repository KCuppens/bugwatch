use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use chrono::{DateTime, Utc};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::convert::Infallible;

use crate::{
    auth::middleware::AuthUser,
    billing::tiers::can_access_feature,
    db::repositories::{
        LogInsert, LogListParams, LogRepository, OrganizationRepository, ProjectRepository,
    },
    AppError, AppResult, AppState,
};

use super::events::extract_api_key;
use super::{PaginatedResponse, PaginationMeta};

// ============================================================================
// Ingest types
// ============================================================================

/// One log entry as supplied by an SDK in the batch ingest payload.
#[derive(Debug, Deserialize)]
pub struct IngestLogEntry {
    pub log_id: String,
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub logger_name: Option<String>,
    pub service_name: Option<String>,
    pub environment: Option<String>,
    pub release: Option<String>,
    pub tags: Option<serde_json::Value>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct IngestError {
    pub index: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct BatchIngestResponse {
    pub accepted: i64,
    pub duplicates: i64,
    pub errors: Vec<IngestError>,
}

// ============================================================================
// Query / response types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct LogListQuery {
    pub level: Option<String>,
    pub search: Option<String>,
    pub service_name: Option<String>,
    pub environment: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
    // Remaining keys (attribute.*) are extracted via Query<HashMap<String,String>>
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

fn default_page() -> u32 {
    1
}
fn default_per_page() -> u32 {
    20
}

#[derive(Debug, Deserialize)]
pub struct LogStatsQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub interval: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LogTailQuery {
    pub since: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LogFacetsQuery {
    pub key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LinkIssueBody {
    pub issue_id: String,
}

#[derive(Debug, Serialize)]
pub struct TimeBucket {
    pub timestamp: DateTime<Utc>,
    pub count: i64,
    pub error_count: i64,
    pub warn_count: i64,
}

#[derive(Debug, Serialize)]
pub struct LogStatsResponse {
    pub buckets: Vec<TimeBucket>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct FacetValue {
    pub value: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct FacetResponse {
    pub keys: Vec<String>,
    pub values: Vec<FacetValue>,
}

// ============================================================================
// Validation helper
// ============================================================================

/// Validate a single `IngestLogEntry`. Returns `Ok(())` or `Err(reason)`.
fn validate_entry(entry: &IngestLogEntry) -> Result<(), String> {
    if entry.log_id.is_empty() {
        return Err("log_id must not be empty".to_string());
    }
    if chrono::DateTime::parse_from_rfc3339(&entry.timestamp).is_err() {
        return Err("timestamp must be a valid RFC3339 timestamp".to_string());
    }
    const VALID_LEVELS: &[&str] = &["trace", "debug", "info", "warn", "error", "fatal"];
    if !VALID_LEVELS.contains(&entry.level.to_lowercase().as_str()) {
        return Err(format!("level must be one of: {}", VALID_LEVELS.join(", ")));
    }
    if entry.message.len() > 8192 {
        return Err("message must be ≤ 8192 bytes".to_string());
    }
    if entry.logger_name.as_deref().map(|s| s.len()).unwrap_or(0) > 64 {
        return Err("logger_name must be ≤ 64 chars".to_string());
    }
    if entry.service_name.as_deref().map(|s| s.len()).unwrap_or(0) > 64 {
        return Err("service_name must be ≤ 64 chars".to_string());
    }
    if entry.environment.as_deref().map(|s| s.len()).unwrap_or(0) > 64 {
        return Err("environment must be ≤ 64 chars".to_string());
    }
    if entry.release.as_deref().map(|s| s.len()).unwrap_or(0) > 200 {
        return Err("release must be ≤ 200 chars".to_string());
    }
    if let Some(ref tags) = entry.tags {
        if let Some(obj) = tags.as_object() {
            if obj.len() > 64 {
                return Err("tags must have ≤ 64 entries".to_string());
            }
            for (k, v) in obj {
                if k.len() > 256 {
                    return Err("tag key must be ≤ 256 chars".to_string());
                }
                if let Some(s) = v.as_str() {
                    if s.len() > 256 {
                        return Err("tag value must be ≤ 256 chars".to_string());
                    }
                }
            }
        }
        // If tags is not an object, we ignore it (non-object tags are allowed, just not validated as map)
    }
    if let Some(ref extra) = entry.extra {
        let size = serde_json::to_string(extra).map(|s| s.len()).unwrap_or(0);
        if size > 65_536 {
            return Err("extra must be ≤ 64 KB".to_string());
        }
    }
    Ok(())
}

/// Extract primitive-valued top-level keys from a JSON object as `attributes`.
fn extract_attributes(extra: &serde_json::Value) -> Option<serde_json::Value> {
    let obj = extra.as_object()?;
    let mut attrs = serde_json::Map::new();
    for (k, v) in obj {
        match v {
            serde_json::Value::String(_)
            | serde_json::Value::Number(_)
            | serde_json::Value::Bool(_) => {
                attrs.insert(k.clone(), v.clone());
            }
            // Skip nested objects and arrays
            _ => {}
        }
    }
    if attrs.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(attrs))
    }
}

// ============================================================================
// Tier-gate helper for dashboard (JWT) endpoints
// ============================================================================

async fn check_log_monitoring_access(
    state: &AppState,
    user: &AuthUser,
    project_id: &str,
) -> AppResult<()> {
    if state.config.deployment_mode.is_self_hosted() {
        return Ok(());
    }

    // If the user has no organization yet, treat them as free-tier (no access).
    let (tier, org_id) = match OrganizationRepository::find_by_user(&state.db, &user.id).await? {
        Some(org) => (org.tier.clone(), org.id.clone()),
        None => ("free".to_string(), String::new()),
    };

    if !can_access_feature(&tier, "log_monitoring") {
        return Err(crate::payments::x402_feature_response(
            state,
            "log_monitoring",
            &format!("/api/v1/projects/{}/logs", project_id),
            &org_id,
            None,
            "Log monitoring requires a Pro plan or higher.",
        )
        .await);
    }

    Ok(())
}

/// Verify the authenticated user has access to `project_id` (owner or org member).
async fn verify_project_access(
    state: &AppState,
    project_id: &str,
    user: &AuthUser,
) -> AppResult<()> {
    let project = ProjectRepository::find_by_id(&state.db, project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id == user.id {
        return Ok(());
    }

    if let Some(org_id) = &project.organization_id {
        let is_member = crate::db::repositories::OrganizationMemberRepository::is_member(
            &state.db, org_id, &user.id,
        )
        .await?;
        if is_member {
            return Ok(());
        }
    }

    Err(AppError::Forbidden("Access denied".to_string()))
}

// ============================================================================
// POST /api/v1/logs  — batch ingest (API key auth)
// ============================================================================

pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(entries): Json<Vec<IngestLogEntry>>,
) -> AppResult<(StatusCode, Json<BatchIngestResponse>)> {
    // 1. Extract & validate API key
    let api_key = extract_api_key(&headers)?;

    // 2. Resolve project
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    // 3. Rate limit
    let rl = state
        .rate_limiter
        .check_with_tier_lookup(
            &api_key,
            &state.db,
            state.config.deployment_mode,
            state.config.rate_limit_per_minute,
        )
        .await;
    if !rl.allowed {
        return Err(AppError::RateLimitExceeded {
            retry_after_secs: rl.retry_after_secs.unwrap_or(60),
            limit: rl.limit,
            remaining: rl.remaining,
        });
    }

    // 4. Tier check
    if !state.config.deployment_mode.is_self_hosted() {
        let tier_str = crate::db::repositories::OrganizationRepository::get_project_tier(
            &state.db,
            &project.id,
        )
        .await
        .unwrap_or_else(|_| "free".to_string());

        if !can_access_feature(&tier_str, "log_monitoring") {
            let org_id = project.organization_id.as_deref().unwrap_or("");
            return Err(crate::payments::x402_feature_response(
                &state,
                "log_monitoring",
                "/api/v1/logs",
                org_id,
                None,
                "Log monitoring requires a Pro plan or higher.",
            )
            .await);
        }
    }

    // 5. Validate each entry, collect per-index errors
    let mut ingest_errors: Vec<IngestError> = Vec::new();
    let mut valid_entries: Vec<(usize, &IngestLogEntry)> = Vec::new();

    for (idx, entry) in entries.iter().enumerate() {
        match validate_entry(entry) {
            Ok(()) => valid_entries.push((idx, entry)),
            Err(reason) => ingest_errors.push(IngestError { index: idx, reason }),
        }
    }

    // 6. Build inserts for valid entries and bulk-create them.
    let inserts: Vec<LogInsert> = valid_entries
        .iter()
        .map(|(_idx, entry)| {
            let timestamp = chrono::DateTime::parse_from_rfc3339(&entry.timestamp)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .expect("timestamp was validated above");
            let attributes = entry.extra.as_ref().and_then(extract_attributes);
            LogInsert {
                log_id: entry.log_id.clone(),
                timestamp,
                level: entry.level.clone(),
                message: entry.message.clone(),
                logger_name: entry.logger_name.clone(),
                service_name: entry.service_name.clone(),
                environment: entry.environment.clone(),
                release: entry.release.clone(),
                tags: entry.tags.clone(),
                extra: entry.extra.clone(),
                attributes,
            }
        })
        .collect();

    let (accepted, duplicates) =
        LogRepository::bulk_create(&state.db, &project.id, &inserts).await?;

    tracing::info!(
        project_id = %project.id,
        accepted = accepted,
        duplicates = duplicates,
        "Log batch ingested"
    );

    Ok((
        StatusCode::ACCEPTED,
        Json(BatchIngestResponse {
            accepted,
            duplicates,
            errors: ingest_errors,
        }),
    ))
}

// ============================================================================
// GET /api/v1/projects/:project_id/logs  — list (JWT auth, tier gated)
// ============================================================================

pub async fn list_logs(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Query(params): Query<LogListQuery>,
) -> AppResult<Json<PaginatedResponse<serde_json::Value>>> {
    check_log_monitoring_access(&state, &user, &project_id).await?;
    verify_project_access(&state, &project_id, &user).await?;

    let per_page = params.per_page.clamp(1, 100);
    let page = params.page.max(1);
    let offset = ((page - 1) * per_page) as i64;
    let limit = per_page as i64;

    let start = params
        .start
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));
    let end = params
        .end
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    // Extract attribute.* filters
    let attribute_filters: HashMap<String, String> = params
        .extra
        .iter()
        .filter(|(k, _)| k.starts_with("attribute."))
        .map(|(k, v)| (k.trim_start_matches("attribute.").to_string(), v.clone()))
        .collect();

    let list_params = LogListParams {
        level: params.level.clone(),
        search: params.search.clone(),
        service_name: params.service_name.clone(),
        environment: params.environment.clone(),
        start,
        end,
        issue_id: None,
        attribute_filters,
        limit,
        offset,
    };

    let entries_raw = LogRepository::list_filtered(&state.db, &project_id, &list_params).await?;
    let total_count = LogRepository::count_filtered(&state.db, &project_id, &list_params).await?;

    let entries: Vec<serde_json::Value> = entries_raw
        .into_iter()
        .map(|e| serde_json::to_value(e).unwrap_or(serde_json::Value::Null))
        .collect();
    let total: u32 = total_count.try_into().unwrap_or(u32::MAX);

    let total_pages = match total.checked_div(per_page) {
        None => 0,
        Some(q) => q + u32::from(!total.is_multiple_of(per_page)),
    };

    Ok(Json(PaginatedResponse {
        data: entries,
        pagination: PaginationMeta {
            page,
            per_page,
            total,
            total_pages,
        },
    }))
}

// ============================================================================
// GET /api/v1/projects/:project_id/logs/stats  — stats (JWT auth, tier gated)
// ============================================================================

pub async fn get_stats(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Query(params): Query<LogStatsQuery>,
) -> AppResult<Json<serde_json::Value>> {
    check_log_monitoring_access(&state, &user, &project_id).await?;
    verify_project_access(&state, &project_id, &user).await?;

    let end_dt = params
        .end
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(Utc::now);

    let start_dt = params
        .start
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| end_dt - chrono::Duration::hours(24));

    let bucket_size_secs: i64 = match params.interval.as_deref().unwrap_or("1h") {
        "5m" => 300,
        "15m" => 900,
        "1h" => 3600,
        "6h" => 21600,
        "1d" => 86400,
        _ => 3600,
    };

    let raw_buckets = LogRepository::count_by_time_buckets(
        &state.db,
        &project_id,
        start_dt,
        end_dt,
        bucket_size_secs,
    )
    .await?;

    let total: i64 = raw_buckets.iter().map(|(_, cnt)| cnt).sum();

    let buckets: Vec<TimeBucket> = raw_buckets
        .into_iter()
        .map(|(bucket_idx, count)| {
            let ts = start_dt + chrono::Duration::seconds(bucket_idx * bucket_size_secs);
            TimeBucket {
                timestamp: ts,
                count,
                error_count: 0,
                warn_count: 0,
            }
        })
        .collect();

    let response = LogStatsResponse { buckets, total };

    Ok(Json(serde_json::json!({ "data": response })))
}

// ============================================================================
// GET /api/v1/projects/:project_id/logs/tail  — SSE tail (JWT auth, tier gated)
// ============================================================================

pub async fn tail_logs(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Query(params): Query<LogTailQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    check_log_monitoring_access(&state, &user, &project_id).await?;
    verify_project_access(&state, &project_id, &user).await?;

    let since: DateTime<Utc> = params
        .since
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(Utc::now);

    let sse_stream = stream::unfold(
        (state, project_id, since),
        |(state, project_id, cursor)| async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            let entries = match LogRepository::list_since(&state.db, &project_id, cursor, 100).await
            {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::error!(project_id = %project_id, "SSE tail DB error: {}", e);
                    vec![]
                }
            };
            let new_cursor = entries.last().map(|e| e.created_at.0).unwrap_or(cursor);
            let events: Vec<Result<Event, Infallible>> = entries
                .into_iter()
                .map(|e| Ok(Event::default().json_data(e).unwrap()))
                .collect();
            Some((stream::iter(events), (state, project_id, new_cursor)))
        },
    )
    .flatten();

    Ok(Sse::new(sse_stream).keep_alive(KeepAlive::default()))
}

// ============================================================================
// GET /api/v1/projects/:project_id/logs/facets  — facets (JWT auth, tier gated)
// ============================================================================

pub async fn get_facets(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Query(params): Query<LogFacetsQuery>,
) -> AppResult<Json<serde_json::Value>> {
    check_log_monitoring_access(&state, &user, &project_id).await?;
    verify_project_access(&state, &project_id, &user).await?;

    let response = if let Some(ref key) = params.key {
        let raw_values = LogRepository::get_facet_values(&state.db, &project_id, key, 20).await?;
        let values = raw_values
            .into_iter()
            .map(|(value, count)| FacetValue { value, count })
            .collect();
        FacetResponse {
            keys: vec![],
            values,
        }
    } else {
        let keys = LogRepository::get_facet_keys(&state.db, &project_id).await?;
        FacetResponse {
            keys,
            values: vec![],
        }
    };

    Ok(Json(serde_json::json!({ "data": response })))
}

// ============================================================================
// POST /api/v1/projects/:project_id/logs/:log_entry_id/issue  — link
// ============================================================================

pub async fn link_issue(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, log_entry_id)): Path<(String, String)>,
    Json(body): Json<LinkIssueBody>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    verify_project_access(&state, &project_id, &user).await?;

    LogRepository::set_issue_link(&state.db, &project_id, &log_entry_id, Some(&body.issue_id))
        .await?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "data": { "status": "linked" } })),
    ))
}

// ============================================================================
// DELETE /api/v1/projects/:project_id/logs/:log_entry_id/issue  — unlink
// ============================================================================

pub async fn unlink_issue(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, log_entry_id)): Path<(String, String)>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    verify_project_access(&state, &project_id, &user).await?;

    LogRepository::set_issue_link(&state.db, &project_id, &log_entry_id, None).await?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "data": { "status": "unlinked" } })),
    ))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
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
            .body(Body::from(r#"{"name":"Logs Test Project"}"#))
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

    fn three_valid_entries() -> &'static str {
        r#"[
            {"log_id":"log-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"App started"},
            {"log_id":"log-002","timestamp":"2024-01-01T00:01:00Z","level":"warn","message":"High memory usage"},
            {"log_id":"log-003","timestamp":"2024-01-01T00:02:00Z","level":"error","message":"Unexpected failure"}
        ]"#
    }

    // ── POST /api/v1/logs ────────────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_valid_batch_returns_202_accepted_3() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_valid@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(three_valid_entries()))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["accepted"].as_i64(), Some(3));
        assert_eq!(json["errors"].as_array().map(|a| a.len()), Some(0));
    }

    #[tokio::test]
    async fn ingest_invalid_api_key_returns_401() {
        let app = make_app().await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", "not-a-valid-key")
            .body(Body::from(r#"[{"log_id":"x","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"hi"}]"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_missing_api_key_returns_401() {
        let app = make_app().await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .body(Body::from(r#"[{"log_id":"x","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"hi"}]"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_message_too_long_returns_202_with_per_entry_error() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_msglen@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long_msg = "x".repeat(8193);
        let payload = format!(
            r#"[
                {{"log_id":"ok-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"ok"}},
                {{"log_id":"bad-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"{}"}}
            ]"#,
            long_msg
        );

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["accepted"].as_i64(), Some(1));
        let errors = json["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["index"].as_i64(), Some(1));
        assert!(errors[0]["reason"].as_str().unwrap().contains("8192"));
    }

    #[tokio::test]
    async fn ingest_too_many_tags_returns_202_with_per_entry_error() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_tags@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let tags: String = (0..65)
            .map(|i| format!(r#""k{}":"v{}""#, i, i))
            .collect::<Vec<_>>()
            .join(",");
        let payload = format!(
            r#"[{{"log_id":"bad-tags-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"hi","tags":{{{}}}}},
               {{"log_id":"good-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"ok"}}]"#,
            tags
        );

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["accepted"].as_i64(), Some(1));
        let errors = json["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["index"].as_i64(), Some(0));
    }

    #[tokio::test]
    async fn ingest_invalid_timestamp_returns_202_with_per_entry_error() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_ts@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload =
            r#"[{"log_id":"bad-ts","timestamp":"not-a-ts","level":"info","message":"hi"}]"#;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["accepted"].as_i64(), Some(0));
        let errors = json["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["index"].as_i64(), Some(0));
    }

    #[tokio::test]
    async fn ingest_invalid_level_returns_202_with_per_entry_error() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_level@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload = r#"[{"log_id":"bad-level","timestamp":"2024-01-01T00:00:00Z","level":"LOUD","message":"hi"}]"#;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["accepted"].as_i64(), Some(0));
        assert_eq!(
            json["errors"].as_array().unwrap()[0]["index"].as_i64(),
            Some(0)
        );
    }

    #[tokio::test]
    async fn ingest_empty_log_id_returns_202_with_per_entry_error() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_emptyid@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload =
            r#"[{"log_id":"","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"hi"}]"#;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["accepted"].as_i64(), Some(0));
        assert_eq!(json["errors"].as_array().unwrap().len(), 1);
    }

    // ── GET /api/v1/projects/:project_id/logs ───────────────────────────────

    #[tokio::test]
    async fn list_logs_without_auth_returns_401() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_list_noauth@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/logs", project_id))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn list_logs_as_owner_returns_200_paginated() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_list_ok@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/logs", project_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(json["data"].is_array());
        assert!(json["pagination"].is_object());
        assert_eq!(json["pagination"]["page"].as_i64(), Some(1));
    }

    #[tokio::test]
    async fn list_logs_for_other_users_project_returns_403() {
        let app = make_app().await;
        let token1 = signup_and_get_token(&app, "log_list_user1@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token1).await;
        let token2 = signup_and_get_token(&app, "log_list_user2@example.com").await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/logs", project_id))
            .header("authorization", format!("Bearer {}", token2))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    // ── GET /api/v1/projects/:project_id/logs/stats ──────────────────────────

    #[tokio::test]
    async fn get_stats_returns_200() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_stats@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/logs/stats", project_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // ── GET /api/v1/projects/:project_id/logs/facets ─────────────────────────

    #[tokio::test]
    async fn get_facets_returns_200() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_facets@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/logs/facets", project_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // ── POST + DELETE /api/v1/projects/:project_id/logs/:id/issue ────────────

    #[tokio::test]
    async fn link_issue_returns_200() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_link@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/logs/log-entry-abc/issue",
                project_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"issue_id":"issue-uuid-001"}"#))
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn unlink_issue_returns_200() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "log_unlink@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("DELETE")
            .uri(format!(
                "/api/v1/projects/{}/logs/log-entry-abc/issue",
                project_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    // ── Tier gating (SaaS mode) ──────────────────────────────────────────────

    /// Builds an app in SaaS (non-self-hosted) mode for tier-gate testing.
    async fn make_saas_app() -> axum::Router {
        use crate::config::{Config, DeploymentMode};
        use std::sync::Arc;

        let pool = crate::db::test_helpers::test_any_pool().await;

        let config = Config {
            server_addr: "127.0.0.1:0".to_string(),
            database_url: "sqlite::memory:".to_string(),
            jwt_secret: "test-jwt-secret-exactly-32-chars!!".to_string(),
            jwt_access_expiration: 900,
            jwt_refresh_expiration: 604800,
            deployment_mode: DeploymentMode::Saas,
            environment: "test".to_string(),
            app_url: "http://localhost:3001".to_string(),
            allowed_origins: vec![],
            retention_days: 90,
            rate_limit_per_minute: 10000,
            smtp_host: None,
            smtp_port: None,
            smtp_user: None,
            smtp_password: None,
            smtp_from: None,
            stripe_secret_key: None,
            stripe_webhook_secret: None,
            stripe_price_id_pro_monthly: None,
            stripe_price_id_pro_annual: None,
            stripe_price_id_team_monthly: None,
            stripe_price_id_team_annual: None,
            bugwatch_api_key: None,
            bugwatch_endpoint: None,
            bugwatch_enabled: false,
            github_client_id: None,
            github_client_secret: None,
            jira_client_id: None,
            jira_client_secret: None,
            linear_client_id: None,
            linear_client_secret: None,
            trust_proxy: false,
            cookie_secure: false,
            encryption_key: None,
            password_reset_secret: "test-pw-reset-secret-exactly-32ch".to_string(),
            oauth_state_secret: "test-oauth-state-secret-exactly32!".to_string(),
            github_webhook_secret: None,
            jira_webhook_secret: None,
            linear_webhook_secret: None,
            database_max_connections: 1,
            shutdown_grace_secs: 5,
            x402_enabled: false,
            x402_wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
            x402_rpc_url: "https://mainnet.base.org".to_string(),
            x402_usdc_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".to_string(),
        };

        let alerting_service =
            Arc::new(crate::AlertingService::new(pool.clone(), config.app_url.clone()).await);
        let notification_service = Arc::new(crate::NotificationService::new().await);

        let state = crate::AppState {
            db: pool.clone(),
            config: Arc::new(config),
            rate_limiter: crate::RateLimiter::new(),
            #[cfg(feature = "saas")]
            stripe: None,
            alerting_service,
            notification_service,
            bugwatch: None,
            alert_semaphore: Arc::new(tokio::sync::Semaphore::new(100)),
            payment_store: Arc::new(crate::payments::store::PaymentStore::new(pool)),
            onchain_verifier: Arc::new(
                crate::payments::verify::OnChainVerifier::new(
                    "https://mainnet.base.org".to_string(),
                )
                .expect("reqwest client init cannot fail in tests"),
            ),
        };

        axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state)
    }

    #[tokio::test]
    async fn ingest_as_free_tier_returns_402() {
        let app = make_saas_app().await;
        let token = signup_and_get_token(&app, "log_free_ingest@example.com").await;
        // Project created under a free-tier org (default)
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/logs")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(
                r#"[{"log_id":"free-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"hi"}]"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::PAYMENT_REQUIRED
        );
    }

    #[tokio::test]
    async fn list_logs_as_free_tier_returns_402() {
        let app = make_saas_app().await;
        let token = signup_and_get_token(&app, "log_free_list@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/logs", project_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::PAYMENT_REQUIRED
        );
    }

    // ── Unit tests for validation helpers ───────────────────────────────────

    #[test]
    fn validate_entry_accepts_all_valid_levels() {
        for level in &["trace", "debug", "info", "warn", "error", "fatal"] {
            let entry = IngestLogEntry {
                log_id: "id".to_string(),
                timestamp: "2024-01-01T00:00:00Z".to_string(),
                level: level.to_string(),
                message: "msg".to_string(),
                logger_name: None,
                service_name: None,
                environment: None,
                release: None,
                tags: None,
                extra: None,
            };
            assert!(
                validate_entry(&entry).is_ok(),
                "level {} should be valid",
                level
            );
        }
    }

    #[test]
    fn validate_entry_rejects_empty_log_id() {
        let entry = IngestLogEntry {
            log_id: "".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "info".to_string(),
            message: "msg".to_string(),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: None,
            extra: None,
        };
        assert!(validate_entry(&entry).is_err());
    }

    #[test]
    fn validate_entry_rejects_invalid_timestamp() {
        let entry = IngestLogEntry {
            log_id: "id".to_string(),
            timestamp: "not-a-date".to_string(),
            level: "info".to_string(),
            message: "msg".to_string(),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: None,
            extra: None,
        };
        assert!(validate_entry(&entry).is_err());
    }

    #[test]
    fn validate_entry_rejects_bad_level() {
        let entry = IngestLogEntry {
            log_id: "id".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "CRITICAL".to_string(),
            message: "msg".to_string(),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: None,
            extra: None,
        };
        assert!(validate_entry(&entry).is_err());
    }

    #[test]
    fn validate_entry_rejects_message_too_long() {
        let entry = IngestLogEntry {
            log_id: "id".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "info".to_string(),
            message: "x".repeat(8193),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: None,
            extra: None,
        };
        assert!(validate_entry(&entry).is_err());
    }

    #[test]
    fn validate_entry_accepts_message_at_exact_limit() {
        let entry = IngestLogEntry {
            log_id: "id".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "info".to_string(),
            message: "x".repeat(8192),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: None,
            extra: None,
        };
        assert!(validate_entry(&entry).is_ok());
    }

    #[test]
    fn validate_entry_rejects_too_many_tags() {
        let mut map = serde_json::Map::new();
        for i in 0..65 {
            map.insert(
                format!("k{}", i),
                serde_json::Value::String("v".to_string()),
            );
        }
        let entry = IngestLogEntry {
            log_id: "id".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "info".to_string(),
            message: "msg".to_string(),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: Some(serde_json::Value::Object(map)),
            extra: None,
        };
        assert!(validate_entry(&entry).is_err());
    }

    #[test]
    fn validate_entry_rejects_extra_too_large() {
        let large = "x".repeat(70_000);
        let entry = IngestLogEntry {
            log_id: "id".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "info".to_string(),
            message: "msg".to_string(),
            logger_name: None,
            service_name: None,
            environment: None,
            release: None,
            tags: None,
            extra: Some(serde_json::json!({"big": large})),
        };
        assert!(validate_entry(&entry).is_err());
    }

    #[test]
    fn extract_attributes_returns_only_primitives() {
        let extra = serde_json::json!({
            "str_val": "hello",
            "num_val": 42,
            "bool_val": true,
            "nested": {"key": "skipped"},
            "array": [1, 2, 3]
        });
        let attrs = extract_attributes(&extra).unwrap();
        let obj = attrs.as_object().unwrap();
        assert!(obj.contains_key("str_val"));
        assert!(obj.contains_key("num_val"));
        assert!(obj.contains_key("bool_val"));
        assert!(!obj.contains_key("nested"));
        assert!(!obj.contains_key("array"));
        assert_eq!(obj.len(), 3);
    }

    #[test]
    fn extract_attributes_returns_none_for_empty_object() {
        let extra = serde_json::json!({});
        assert!(extract_attributes(&extra).is_none());
    }

    #[test]
    fn extract_attributes_returns_none_for_non_object() {
        let extra = serde_json::json!([1, 2, 3]);
        assert!(extract_attributes(&extra).is_none());
    }
}
