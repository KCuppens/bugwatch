use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;

use super::{ApiResponse, PaginatedResponse, PaginationMeta, PaginationParams};
use crate::{
    api::auth::extract_client_ip,
    auth::{AuthIdentity, EitherAuth},
    billing::tiers::can_access_feature,
    db::{
        models::Project,
        repositories::{
            issues::{Facets, ProjectStats, SearchFilters},
            EventRepository, IssueRepository, OrganizationRepository, ProjectRepository,
        },
        DbPool,
    },
    AppError, AppResult, AppState,
};

#[derive(Debug, Serialize)]
pub struct IssueResponse {
    pub id: String,
    pub project_id: String,
    pub fingerprint: String,
    pub title: String,
    pub status: String,
    pub level: String,
    pub first_seen: String,
    pub last_seen: String,
    pub count: i64,
    pub user_count: i64,
    pub environment: String,
}

impl From<crate::db::models::Issue> for IssueResponse {
    fn from(i: crate::db::models::Issue) -> Self {
        Self {
            id: i.id,
            project_id: i.project_id,
            fingerprint: i.fingerprint,
            title: i.title,
            status: i.status,
            level: i.level,
            first_seen: i.first_seen.to_rfc3339(),
            last_seen: i.last_seen.to_rfc3339(),
            count: i.count,
            user_count: i.user_count,
            environment: i.environment,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct IssueFilters {
    pub status: Option<String>,
    pub level: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateIssueRequest {
    pub status: Option<String>,
}

/// Verify a project exists and the caller is authorised to access it.
/// Returns the project on success, 404 if missing, 403 if access denied.
async fn require_project_access(
    db: &DbPool,
    auth: &EitherAuth,
    project_id: &str,
) -> AppResult<Project> {
    let project = ProjectRepository::find_by_id(db, project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;
    if !auth.can_access_project(db, &project).await {
        tracing::warn!(project_id = %project_id, "Access denied to project");
        return Err(AppError::Forbidden("Access denied".to_string()));
    }
    Ok(project)
}

/// GET /api/v1/projects/:project_id/issues
pub async fn list(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Query(params): Query<PaginationParams>,
    Query(filters): Query<IssueFilters>,
) -> AppResult<Json<PaginatedResponse<IssueResponse>>> {
    require_project_access(&state.db, &auth, &project_id).await?;

    let page = params.page.max(1);
    let per_page = params.per_page.min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    // Run list + count in parallel — they share no dependency, so serializing
    // them just doubled the wall time for no reason.
    let (issues, total) = tokio::try_join!(
        IssueRepository::find_by_project(
            &state.db,
            &project_id,
            filters.status.as_deref(),
            filters.level.as_deref(),
            filters.environment.as_deref(),
            per_page as i64,
            offset,
        ),
        IssueRepository::count_by_project(&state.db, &project_id, filters.status.as_deref()),
    )?;
    let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;

    Ok(Json(PaginatedResponse {
        data: issues.into_iter().map(IssueResponse::from).collect(),
        pagination: PaginationMeta {
            page,
            per_page,
            total: total as u32,
            total_pages,
        },
    }))
}

/// POST /api/v1/projects/:project_id/issues/search
/// Advanced search with filters, sorting, and facets
pub async fn search(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Json(req): Json<SearchRequest>,
) -> AppResult<Json<SearchResponse>> {
    let start = std::time::Instant::now();

    // Rate limit: authenticated identities get 60/min; anonymous IPs get 20/min
    let (rl_key, rl_limit) = if let Some(id) = auth.user_id() {
        (format!("search:{}:{}", id, project_id), 60)
    } else if let Some(org_id) = auth.agent_org_id() {
        (format!("search:agent:{}:{}", org_id, project_id), 60)
    } else {
        let ip = extract_client_ip(&headers, state.config.trust_proxy, Some(peer_addr));
        (format!("search:anon_search:{}:{}", ip, project_id), 20)
    };
    let rl = state.rate_limiter.check(&rl_key, rl_limit);
    if !rl.allowed {
        return Err(AppError::BadRequest(
            "Too many requests. Please try again later.".to_string(),
        ));
    }

    require_project_access(&state.db, &auth, &project_id).await?;

    let page = req.page.unwrap_or(1).max(1);
    let per_page = req.per_page.unwrap_or(50).min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    // Validate text search length
    if let Some(ref filters) = req.filters {
        if let Some(ref text) = filters.text {
            if text.len() > 200 {
                return Err(AppError::BadRequest(
                    "Search text too long (max 200 characters)".to_string(),
                ));
            }
        }
        // Allowlist-check status/level and shape-check environment before we
        // forward the lists to the DB layer.
        validate_search_filters(filters)?;
    }

    // B2: cap numeric filter values to prevent absurdly large DB parameters
    const MAX_FILTER_VALUE: i64 = 1_000_000_000;
    if let Some(ref filters) = req.filters {
        if filters.count_gt.unwrap_or(0) > MAX_FILTER_VALUE {
            return Err(AppError::BadRequest("count_gt too large".to_string()));
        }
        if filters.count_lt.unwrap_or(0) > MAX_FILTER_VALUE {
            return Err(AppError::BadRequest("count_lt too large".to_string()));
        }
        if filters.users_gt.unwrap_or(0) > MAX_FILTER_VALUE {
            return Err(AppError::BadRequest("users_gt too large".to_string()));
        }
        if filters.users_lt.unwrap_or(0) > MAX_FILTER_VALUE {
            return Err(AppError::BadRequest("users_lt too large".to_string()));
        }
    }

    // Convert API filters to repository filters
    let filters = SearchFilters {
        status: req.filters.as_ref().and_then(|f| f.status.clone()),
        level: req.filters.as_ref().and_then(|f| f.level.clone()),
        environment: req.filters.as_ref().and_then(|f| f.environment.clone()),
        count_gt: req.filters.as_ref().and_then(|f| f.count_gt),
        count_lt: req.filters.as_ref().and_then(|f| f.count_lt),
        count_gte: req.filters.as_ref().and_then(|f| f.count_gte),
        count_lte: req.filters.as_ref().and_then(|f| f.count_lte),
        users_gt: req.filters.as_ref().and_then(|f| f.users_gt),
        users_lt: req.filters.as_ref().and_then(|f| f.users_lt),
        first_seen_after: req
            .filters
            .as_ref()
            .and_then(|f| f.first_seen_after.clone()),
        first_seen_before: req
            .filters
            .as_ref()
            .and_then(|f| f.first_seen_before.clone()),
        last_seen_after: req.filters.as_ref().and_then(|f| f.last_seen_after.clone()),
        last_seen_before: req
            .filters
            .as_ref()
            .and_then(|f| f.last_seen_before.clone()),
        text: req.filters.as_ref().and_then(|f| f.text.clone()),
    };

    let sort_field = req.sort.as_ref().map(|s| s.field.as_str());
    if let Some(field) = sort_field {
        const ALLOWED_SORT: &[&str] = &["count", "users", "first_seen", "last_seen"];
        if !ALLOWED_SORT.contains(&field) {
            return Err(AppError::BadRequest(format!(
                "Invalid sort field '{}'. Allowed: count, users, first_seen, last_seen",
                field
            )));
        }
    }
    let sort_direction = req
        .sort
        .as_ref()
        .and_then(|s| s.direction.map(|d| d.as_str()));

    // Run search, count, and facet queries in parallel
    let (issues, total, facets) = tokio::try_join!(
        IssueRepository::search(
            &state.db,
            &project_id,
            &filters,
            sort_field,
            sort_direction,
            per_page as i64,
            offset,
        ),
        IssueRepository::count_search(&state.db, &project_id, &filters),
        IssueRepository::get_facets(&state.db, &project_id),
    )?;

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;
    let query_time_ms = start.elapsed().as_millis() as u64;

    Ok(Json(SearchResponse {
        data: issues.into_iter().map(IssueResponse::from).collect(),
        pagination: PaginationMeta {
            page,
            per_page,
            total: total as u32,
            total_pages,
        },
        facets,
        query_time_ms,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub filters: Option<SearchFiltersRequest>,
    pub sort: Option<SortConfig>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SearchFiltersRequest {
    pub status: Option<Vec<String>>,
    pub level: Option<Vec<String>>,
    pub environment: Option<Vec<String>>,
    pub count_gt: Option<i64>,
    pub count_lt: Option<i64>,
    pub count_gte: Option<i64>,
    pub count_lte: Option<i64>,
    pub users_gt: Option<i64>,
    pub users_lt: Option<i64>,
    pub first_seen_after: Option<String>,
    pub first_seen_before: Option<String>,
    pub last_seen_after: Option<String>,
    pub last_seen_before: Option<String>,
    pub text: Option<String>,
}

/// Max entries allowed per list filter (status / level / environment).
/// Pathologically large filter lists can explode SQL IN-clauses and DB planner
/// work, so cap them to a reasonable number.
const MAX_FILTER_VEC_LEN: usize = 50;

/// Max byte length for a single environment name. Environments are user-defined,
/// so we can't use an allowlist — instead we validate shape (printable ASCII).
const MAX_ENVIRONMENT_LEN: usize = 64;

/// Allowed issue status values — must match the DB column's accepted set
/// (`'unresolved'` is the default; `update_status` in this file accepts
/// `unresolved | resolved | ignored`; `archived` / `new` are tolerated here
/// for forward-compat with the UI's saved-search presets).
const ALLOWED_STATUSES: &[&str] = &["unresolved", "resolved", "ignored", "archived", "new"];

/// Allowed event/issue level values — matches `EventLevel` in `api/events.rs`.
const ALLOWED_LEVELS: &[&str] = &["debug", "info", "warning", "error", "fatal"];

/// Validate the user-supplied filter vectors against allowlists / shape rules
/// before they are forwarded to the DB. Returns `AppError::Validation` with a
/// generic message on any mismatch (intentionally non-specific to avoid echoing
/// attacker input back in error responses).
fn validate_search_filters(f: &SearchFiltersRequest) -> AppResult<()> {
    fn check_allowlist(values: &Option<Vec<String>>, allowed: &[&str]) -> AppResult<()> {
        if let Some(vs) = values {
            if vs.len() > MAX_FILTER_VEC_LEN {
                return Err(AppError::Validation("invalid filter value".into()));
            }
            for v in vs {
                if !allowed.contains(&v.as_str()) {
                    return Err(AppError::Validation("invalid filter value".into()));
                }
            }
        }
        Ok(())
    }

    check_allowlist(&f.status, ALLOWED_STATUSES)?;
    check_allowlist(&f.level, ALLOWED_LEVELS)?;

    // Environment is user-defined — validate shape only: non-empty, <=64 chars,
    // printable ASCII (no control bytes, no newlines, no NUL). Cap the list too.
    if let Some(envs) = &f.environment {
        if envs.len() > MAX_FILTER_VEC_LEN {
            return Err(AppError::Validation("invalid filter value".into()));
        }
        for env in envs {
            if env.is_empty() || env.len() > MAX_ENVIRONMENT_LEN {
                return Err(AppError::Validation("invalid filter value".into()));
            }
            // Printable ASCII: 0x20..=0x7E, rejecting everything else (incl. UTF-8
            // multi-byte, control chars, tabs, newlines).
            if !env.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
                return Err(AppError::Validation("invalid filter value".into()));
            }
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl SortDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            SortDirection::Asc => "asc",
            SortDirection::Desc => "desc",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SortConfig {
    pub field: String,
    pub direction: Option<SortDirection>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub data: Vec<IssueResponse>,
    pub pagination: PaginationMeta,
    pub facets: Facets,
    pub query_time_ms: u64,
}

/// GET /api/v1/projects/:project_id/issues/facets
pub async fn get_facets(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
) -> AppResult<Json<Facets>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("issues_facets", &auth),
        60,
    )?;

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let facets = IssueRepository::get_facets(&state.db, &project_id).await?;
    Ok(Json(facets))
}

/// GET /api/v1/projects/:project_id/issues/:issue_id
pub async fn get(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<IssueDetail>>> {
    require_project_access(&state.db, &auth, &project_id).await?;

    // Get issue
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    // Verify issue belongs to project
    if issue.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Get recent events
    let events = EventRepository::find_by_issue(&state.db, &issue_id, 10, 0).await?;

    // Parse all context from the most recent event (parse once, reuse for every helper)
    let (exception, tags, breadcrumbs, request, user, extra) = if let Some(event) = events.first() {
        let json = parse_payload_value(&event.payload);
        (
            parse_exception_from_payload(&json),
            parse_tags_from_payload(&json),
            parse_breadcrumbs_from_payload(&json),
            parse_request_context_from_payload(&json),
            parse_user_context_from_payload(&json),
            parse_extra_from_payload(&json),
        )
    } else {
        (None, HashMap::new(), vec![], None, None, None)
    };

    let recent_events: Vec<EventSummary> = events
        .iter()
        .map(|e| {
            let payload = parse_payload_value(&e.payload);
            EventSummary {
                id: e.id.clone(),
                timestamp: e.timestamp.to_rfc3339(),
                user_id: payload
                    .get("user")
                    .and_then(|u| u.get("id"))
                    .and_then(|v| v.as_str())
                    .map(String::from),
                release: payload
                    .get("release")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }
        })
        .collect();

    Ok(Json(ApiResponse {
        data: IssueDetail {
            id: issue.id,
            project_id: issue.project_id,
            fingerprint: issue.fingerprint,
            title: issue.title,
            status: issue.status,
            level: issue.level,
            first_seen: issue.first_seen.to_rfc3339(),
            last_seen: issue.last_seen.to_rfc3339(),
            count: issue.count,
            user_count: issue.user_count,
            environment: issue.environment,
            exception,
            recent_events,
            tags,
            breadcrumbs,
            request,
            user,
            extra,
        },
    }))
}

/// PATCH /api/v1/projects/:project_id/issues/:issue_id
pub async fn update(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
    Json(req): Json<UpdateIssueRequest>,
) -> AppResult<Json<ApiResponse<IssueResponse>>> {
    require_project_access(&state.db, &auth, &project_id).await?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Get issue
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    // Verify issue belongs to project
    if issue.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Update status if provided; use RETURNING to avoid a second round-trip
    let updated = if let Some(status) = &req.status {
        let valid_statuses = ["unresolved", "resolved", "ignored"];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid status. Must be one of: {}",
                valid_statuses.join(", ")
            )));
        }
        IssueRepository::update_status_returning(&state.db, &issue_id, status)
            .await?
            .ok_or_else(|| AppError::Internal("Failed to fetch updated issue".to_string()))?
    } else {
        issue
    };

    Ok(Json(ApiResponse {
        data: IssueResponse::from(updated),
    }))
}

/// DELETE /api/v1/projects/:project_id/issues/:issue_id
pub async fn delete(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("issues_delete", &auth),
        10,
    )?;

    require_project_access(&state.db, &auth, &project_id).await?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Get issue
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    // Verify issue belongs to project
    if issue.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    IssueRepository::delete(&state.db, &issue_id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Issue deleted successfully" }),
    }))
}

/// GET /api/v1/projects/:project_id/issues/:issue_id/events/:event_id
pub async fn get_event(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id, event_id)): Path<(String, String, String)>,
) -> AppResult<Json<ApiResponse<EventDetail>>> {
    require_project_access(&state.db, &auth, &project_id).await?;

    // Get issue to verify it belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Get the event
    let event = EventRepository::find_by_id(&state.db, &event_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Event {} not found", event_id)))?;

    // Verify event belongs to issue
    if event.issue_id != issue_id {
        return Err(AppError::NotFound(format!(
            "Event {} not found in issue",
            event_id
        )));
    }

    // Parse all context from the event (one JSON parse, reused by every helper)
    let payload = parse_payload_value(&event.payload);
    let exception = parse_exception_from_payload(&payload);
    let tags = parse_tags_from_payload(&payload);
    let breadcrumbs = parse_breadcrumbs_from_payload(&payload);
    let request = parse_request_context_from_payload(&payload);
    let user = parse_user_context_from_payload(&payload);
    let extra = parse_extra_from_payload(&payload);
    let release = payload
        .get("release")
        .and_then(|v| v.as_str())
        .map(String::from);
    let environment = payload
        .get("environment")
        .and_then(|v| v.as_str())
        .map(String::from);
    let server_name = payload
        .get("server_name")
        .and_then(|v| v.as_str())
        .map(String::from);

    Ok(Json(ApiResponse {
        data: EventDetail {
            id: event.id,
            issue_id: event.issue_id,
            event_id: event.event_id,
            timestamp: event.timestamp.to_rfc3339(),
            exception,
            breadcrumbs,
            request,
            user,
            tags,
            extra,
            release,
            environment,
            server_name,
        },
    }))
}

/// GET /api/v1/projects/:project_id/issues/:issue_id/frequency
pub async fn get_frequency(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
    Query(params): Query<FrequencyParams>,
) -> AppResult<Json<ApiResponse<FrequencyData>>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("issues_frequency", &auth),
        60,
    )?;

    require_project_access(&state.db, &auth, &project_id).await?;

    // Get issue to verify it belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let period = params.period.as_deref().unwrap_or("24h");
    if !matches!(period, "24h" | "7d" | "30d") {
        return Err(AppError::BadRequest(
            "Invalid period. Must be one of: 24h, 7d, 30d".to_string(),
        ));
    }
    let (hours, bucket_size_hours): (i64, i64) = match period {
        "7d" => (168, 24),
        "30d" => (720, 24),
        _ => (24, 1),
    };

    let now = chrono::Utc::now();
    let start_time = now - chrono::Duration::hours(hours);
    let bucket_size_secs = bucket_size_hours * 3600;
    let num_buckets = (hours / bucket_size_hours) as usize;

    // Aggregate counts in the DB — avoids loading up to 1000 events into memory
    let bucket_counts = EventRepository::count_by_time_buckets(
        &state.db,
        &issue_id,
        start_time,
        now,
        bucket_size_secs,
    )
    .await?;

    let mut buckets: Vec<FrequencyBucket> = (0..num_buckets)
        .map(|i| FrequencyBucket {
            timestamp: (start_time + chrono::Duration::hours(i as i64 * bucket_size_hours))
                .to_rfc3339(),
            count: 0,
        })
        .collect();

    let mut total_in_period: u32 = 0;
    for (idx, cnt) in bucket_counts {
        let i = idx as usize;
        if i >= buckets.len() {
            tracing::warn!(
                index = i,
                len = buckets.len(),
                "Bucket index out of range, skipping"
            );
            continue;
        }
        buckets[i].count = cnt as u32;
        total_in_period += cnt as u32;
    }

    Ok(Json(ApiResponse {
        data: FrequencyData {
            buckets,
            period: period.to_string(),
            total: total_in_period,
        },
    }))
}

#[derive(Debug, Deserialize)]
pub struct FrequencyParams {
    pub period: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FrequencyBucket {
    pub timestamp: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct FrequencyData {
    pub buckets: Vec<FrequencyBucket>,
    pub period: String,
    pub total: u32,
}

#[derive(Debug, Serialize)]
pub struct EventDetail {
    pub id: String,
    pub issue_id: String,
    pub event_id: String,
    pub timestamp: String,
    pub exception: Option<ExceptionDetail>,
    pub breadcrumbs: Vec<BreadcrumbDetail>,
    pub request: Option<RequestContextDetail>,
    pub user: Option<UserContextDetail>,
    pub tags: HashMap<String, String>,
    pub extra: Option<serde_json::Value>,
    pub release: Option<String>,
    pub environment: Option<String>,
    pub server_name: Option<String>,
}

/// Detailed issue response including stack trace and recent events
#[derive(Debug, Serialize)]
pub struct IssueDetail {
    pub id: String,
    pub project_id: String,
    pub fingerprint: String,
    pub title: String,
    pub status: String,
    pub level: String,
    pub first_seen: String,
    pub last_seen: String,
    pub count: i64,
    pub user_count: i64,
    pub environment: String,
    pub exception: Option<ExceptionDetail>,
    pub recent_events: Vec<EventSummary>,
    pub tags: HashMap<String, String>,
    pub breadcrumbs: Vec<BreadcrumbDetail>,
    pub request: Option<RequestContextDetail>,
    pub user: Option<UserContextDetail>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct ExceptionDetail {
    #[serde(rename = "type")]
    pub exception_type: String,
    pub value: String,
    pub stacktrace: Vec<StackFrameDetail>,
}

#[derive(Debug, Serialize)]
pub struct StackFrameDetail {
    pub filename: String,
    pub function: String,
    pub lineno: u32,
    pub colno: u32,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    pub in_app: bool,
    pub vars: Option<serde_json::Value>, // Local variables at this frame
}

#[derive(Debug, Serialize)]
pub struct EventSummary {
    pub id: String,
    pub timestamp: String,
    pub user_id: Option<String>,
    pub release: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BreadcrumbDetail {
    pub timestamp: String,
    #[serde(rename = "type")]
    pub breadcrumb_type: String,
    pub category: String,
    pub message: Option<String>,
    pub level: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RequestContextDetail {
    pub url: Option<String>,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub query_string: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UserContextDetail {
    pub id: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub ip_address: Option<String>,
    pub extra: Option<serde_json::Value>,
}

fn parse_payload_value(payload: &str) -> serde_json::Value {
    serde_json::from_str(payload).unwrap_or(serde_json::Value::Null)
}

fn parse_exception_from_payload(json: &serde_json::Value) -> Option<ExceptionDetail> {
    let exception_obj = json.get("exception")?;

    // Try Sentry format first: exception.values[0]
    // Then try Bugwatch Python SDK format: exception directly has type/value/stacktrace
    let (exception_type, value, frames) =
        if let Some(values) = exception_obj.get("values").and_then(|v| v.as_array()) {
            // Sentry format
            let exc = values.get(0)?;
            let exc_type = exc.get("type")?.as_str()?.to_string();
            let exc_value = exc
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let frames = exc.get("stacktrace")?.get("frames")?.as_array()?;
            (exc_type, exc_value, frames.clone())
        } else {
            // Bugwatch Python SDK format
            let exc_type = exception_obj.get("type")?.as_str()?.to_string();
            let exc_value = exception_obj
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let frames = exception_obj.get("stacktrace")?.as_array()?;
            (exc_type, exc_value, frames.clone())
        };

    let stacktrace = frames
        .iter()
        .filter_map(|frame| {
            Some(StackFrameDetail {
                filename: frame.get("filename")?.as_str()?.to_string(),
                function: frame
                    .get("function")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<anonymous>")
                    .to_string(),
                lineno: frame.get("lineno")?.as_u64()? as u32,
                colno: frame.get("colno").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                context_line: frame
                    .get("context_line")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                pre_context: frame
                    .get("pre_context")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    }),
                post_context: frame
                    .get("post_context")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    }),
                in_app: frame
                    .get("in_app")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
                vars: frame.get("vars").cloned(),
            })
        })
        .collect();

    Some(ExceptionDetail {
        exception_type,
        value,
        stacktrace,
    })
}

fn parse_tags_from_payload(json: &serde_json::Value) -> HashMap<String, String> {
    let mut tags = HashMap::new();

    {
        // Extract common tags
        if let Some(tags_obj) = json.get("tags").and_then(|v| v.as_object()) {
            for (key, value) in tags_obj {
                if let Some(v) = value.as_str() {
                    tags.insert(key.clone(), v.to_string());
                }
            }
        }

        // Extract context values as tags
        if let Some(contexts) = json.get("contexts").and_then(|v| v.as_object()) {
            // Browser
            if let Some(browser) = contexts.get("browser") {
                if let Some(name) = browser.get("name").and_then(|v| v.as_str()) {
                    let version = browser
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    tags.insert(
                        "browser".to_string(),
                        format!("{} {}", name, version).trim().to_string(),
                    );
                }
            }
            // OS
            if let Some(os) = contexts.get("os") {
                if let Some(name) = os.get("name").and_then(|v| v.as_str()) {
                    let version = os.get("version").and_then(|v| v.as_str()).unwrap_or("");
                    tags.insert(
                        "os".to_string(),
                        format!("{} {}", name, version).trim().to_string(),
                    );
                }
            }
            // Runtime
            if let Some(runtime) = contexts.get("runtime") {
                if let Some(name) = runtime.get("name").and_then(|v| v.as_str()) {
                    let version = runtime
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    tags.insert(
                        "runtime".to_string(),
                        format!("{} {}", name, version).trim().to_string(),
                    );
                }
            }
        }

        // Extract environment and release
        if let Some(env) = json.get("environment").and_then(|v| v.as_str()) {
            tags.insert("environment".to_string(), env.to_string());
        }
        if let Some(release) = json.get("release").and_then(|v| v.as_str()) {
            tags.insert("release".to_string(), release.to_string());
        }
    }

    tags
}

fn parse_breadcrumbs_from_payload(json: &serde_json::Value) -> Vec<BreadcrumbDetail> {
    let breadcrumbs = match json.get("breadcrumbs").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return vec![],
    };

    breadcrumbs
        .iter()
        .filter_map(|b| {
            Some(BreadcrumbDetail {
                timestamp: b
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                breadcrumb_type: b
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("default")
                    .to_string(),
                category: b
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                message: b.get("message").and_then(|v| v.as_str()).map(String::from),
                level: b
                    .get("level")
                    .and_then(|v| v.as_str())
                    .unwrap_or("info")
                    .to_string(),
                data: b.get("data").cloned(),
            })
        })
        .collect()
}

fn parse_request_context_from_payload(json: &serde_json::Value) -> Option<RequestContextDetail> {
    // Try top-level "request" first, then fall back to "extra.request" (Django SDK format)
    let request = json
        .get("request")
        .or_else(|| json.get("extra").and_then(|e| e.get("request")))?;

    // Sanitize headers - redact sensitive values
    let headers = request
        .get("headers")
        .and_then(|h| h.as_object())
        .map(|obj| {
            let mut sanitized: HashMap<String, String> = HashMap::new();
            let sensitive_headers = ["authorization", "cookie", "x-api-key", "x-auth-token"];

            for (key, value) in obj {
                let key_lower = key.to_lowercase();
                if sensitive_headers.iter().any(|s| key_lower.contains(s)) {
                    sanitized.insert(key.clone(), "[REDACTED]".to_string());
                } else if let Some(v) = value.as_str() {
                    sanitized.insert(key.clone(), v.to_string());
                }
            }
            sanitized
        });

    Some(RequestContextDetail {
        url: request
            .get("url")
            .and_then(|v| v.as_str())
            .map(String::from),
        method: request
            .get("method")
            .and_then(|v| v.as_str())
            .map(String::from),
        headers,
        query_string: request
            .get("query_string")
            .and_then(|v| v.as_str())
            .map(String::from),
        data: request.get("data").cloned(),
    })
}

fn parse_user_context_from_payload(json: &serde_json::Value) -> Option<UserContextDetail> {
    let user = json.get("user")?;

    Some(UserContextDetail {
        id: user.get("id").and_then(|v| v.as_str()).map(String::from),
        email: user.get("email").and_then(|v| v.as_str()).map(String::from),
        username: user
            .get("username")
            .and_then(|v| v.as_str())
            .map(String::from),
        ip_address: user
            .get("ip_address")
            .and_then(|v| v.as_str())
            .map(String::from),
        extra: user.get("extra").cloned(),
    })
}

fn parse_extra_from_payload(json: &serde_json::Value) -> Option<serde_json::Value> {
    json.get("extra").cloned()
}

/// GET /api/v1/projects/:project_id/issues/:issue_id/impact
pub async fn get_impact(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<ImpactData>>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("issues_impact", &auth),
        60,
    )?;

    require_project_access(&state.db, &auth, &project_id).await?;

    // Get issue to verify it belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let now = chrono::Utc::now();
    let one_hour_ago = now - chrono::Duration::hours(1);
    let two_hours_ago = now - chrono::Duration::hours(2);

    // Run all aggregation queries in parallel — avoids loading events into memory
    let (unique_users, last_hour_count, prev_hour_count, browser_rows, os_rows, total_events) = tokio::try_join!(
        EventRepository::count_unique_users(&state.db, &issue_id),
        EventRepository::count_in_range(&state.db, &issue_id, one_hour_ago, now),
        EventRepository::count_in_range(&state.db, &issue_id, two_hours_ago, one_hour_ago),
        EventRepository::top_tag_values(&state.db, &issue_id, "browser", 5),
        EventRepository::top_tag_values(&state.db, &issue_id, "os.name", 5),
        EventRepository::count_by_issue(&state.db, &issue_id, &project_id),
    )?;

    let trend_percent = if prev_hour_count > 0 {
        ((last_hour_count as f64 - prev_hour_count as f64) / prev_hour_count as f64 * 100.0).round()
            as i32
    } else if last_hour_count > 0 {
        100
    } else {
        0
    };

    let is_trending = trend_percent > 50 && last_hour_count > 5;

    let to_distribution = |rows: Vec<(String, i64)>, total: i64| -> Vec<DistributionItem> {
        rows.into_iter()
            .map(|(name, count)| DistributionItem {
                percentage: if total > 0 {
                    (count as f64 / total as f64 * 100.0).round() as u32
                } else {
                    0
                },
                count: count as u32,
                name,
            })
            .collect()
    };

    Ok(Json(ApiResponse {
        data: ImpactData {
            unique_users: unique_users as u32,
            unique_sessions: 0, // session_id is not a standardised tag; omit rather than guess
            total_events: total_events as u32,
            first_seen: issue.first_seen.to_rfc3339(),
            last_seen: issue.last_seen.to_rfc3339(),
            last_hour_count: last_hour_count as u32,
            trend_percent,
            is_trending,
            browsers: to_distribution(browser_rows, total_events),
            operating_systems: to_distribution(os_rows, total_events),
        },
    }))
}

#[derive(Debug, Serialize)]
pub struct ImpactData {
    pub unique_users: u32,
    pub unique_sessions: u32,
    pub total_events: u32,
    pub first_seen: String,
    pub last_seen: String,
    pub last_hour_count: u32,
    pub trend_percent: i32,
    pub is_trending: bool,
    pub browsers: Vec<DistributionItem>,
    pub operating_systems: Vec<DistributionItem>,
}

#[derive(Debug, Serialize)]
pub struct DistributionItem {
    pub name: String,
    pub count: u32,
    pub percentage: u32,
}

// ============================================================================
// Cross-Project Endpoints
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AcrossProjectsParams {
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_status() -> String {
    "unresolved".to_string()
}

fn default_page() -> u32 {
    1
}

fn default_limit() -> u32 {
    50
}

#[derive(Debug, Serialize)]
pub struct AcrossProjectsResponse {
    pub data: Vec<IssueWithProject>,
    pub pagination: PaginationMeta,
}

#[derive(Debug, Serialize)]
pub struct IssueWithProject {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_slug: String,
    pub project_platform: Option<String>,
    pub fingerprint: String,
    pub title: String,
    pub status: String,
    pub level: String,
    pub first_seen: String,
    pub last_seen: String,
    pub count: i64,
    pub user_count: i64,
    pub environment: String,
}

/// GET /api/v1/issues/across-projects
/// Fetch issues across all user's projects
pub async fn list_across_projects(
    State(state): State<AppState>,
    auth: EitherAuth,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Query(params): Query<AcrossProjectsParams>,
) -> AppResult<Json<AcrossProjectsResponse>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("issues_across", &auth),
        30,
    )?;

    // Gate: Pro+ tier required for cross-project issue aggregation
    // x402_verified is set by the payment middleware when a valid feature_access payment was
    // verified; bypass the tier check only when x402 is enabled AND payment was verified.
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let (org_id, tier_str) = match &*auth {
            AuthIdentity::User(user) => {
                let org = OrganizationRepository::find_by_user(&state.db, &user.id)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;
                (org.id, org.tier)
            }
            AuthIdentity::Agent(agent) => {
                let org = OrganizationRepository::find_by_id(&state.db, &agent.organization_id)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("Organization not found".to_string()))?;
                (org.id, org.tier)
            }
        };
        if !can_access_feature(&tier_str, "cross_project_issues") {
            return Err(crate::payments::x402_feature_response(
                &state,
                "cross_project_issues",
                "/api/v1/issues/across-projects",
                &org_id,
                None,
                "Cross-project issue aggregation requires a Pro plan or higher.",
            )
            .await);
        }
    }

    // Get all projects based on auth type.
    // Cap at 1000 to prevent unbounded fan-out while still covering every
    // realistic tenant. If a caller is actually at the cap, log a warning so
    // ops can spot silent truncation.
    const CROSS_PROJECT_CAP: i64 = 1000;
    let projects = match &*auth {
        AuthIdentity::User(user) => {
            ProjectRepository::find_by_owner(&state.db, &user.id, CROSS_PROJECT_CAP, 0).await?
        }
        AuthIdentity::Agent(agent) => {
            ProjectRepository::find_by_organization(
                &state.db,
                &agent.organization_id,
                CROSS_PROJECT_CAP,
                0,
            )
            .await?
        }
    };
    if projects.len() as i64 == CROSS_PROJECT_CAP {
        match &*auth {
            AuthIdentity::User(user) => {
                tracing::warn!(
                    user_id = %user.id,
                    cap = CROSS_PROJECT_CAP,
                    "project list at cap — may be truncated"
                );
            }
            AuthIdentity::Agent(agent) => {
                tracing::warn!(
                    organization_id = %agent.organization_id,
                    cap = CROSS_PROJECT_CAP,
                    "project list at cap — may be truncated"
                );
            }
        }
    }

    if projects.is_empty() {
        return Ok(Json(AcrossProjectsResponse {
            data: vec![],
            pagination: PaginationMeta {
                page: params.page,
                per_page: params.limit,
                total: 0,
                total_pages: 0,
            },
        }));
    }

    let project_ids: Vec<String> = projects.iter().map(|p| p.id.clone()).collect();
    let project_map: HashMap<String, &crate::db::models::Project> =
        projects.iter().map(|p| (p.id.clone(), p)).collect();

    let page = params.page.max(1);
    let limit = params.limit.min(100).max(1);
    let offset = ((page - 1) * limit) as i64;

    // B5: status allowlist
    const ALLOWED_STATUSES: &[&str] = &["unresolved", "resolved", "ignored", "all"];
    if !ALLOWED_STATUSES.contains(&params.status.as_str()) {
        return Err(AppError::BadRequest("Invalid status filter".to_string()));
    }

    let status_filter = if params.status == "all" {
        None
    } else {
        Some(params.status.as_str())
    };

    // Run list and count in parallel — no ordering dependency between them
    let (issues, total) = tokio::try_join!(
        IssueRepository::find_across_projects(
            &state.db,
            &project_ids,
            status_filter,
            limit as i64,
            offset,
        ),
        IssueRepository::count_across_projects(&state.db, &project_ids, status_filter),
    )?;
    let total_pages = ((total as f64) / (limit as f64)).ceil() as u32;

    // Enrich issues with project info.
    // Hard-cap the final aggregated vector at 500 entries as a defensive ceiling
    // (per_page is already clamped to 100, but this protects against any future
    // loosening of that clamp or bugs in upstream pagination math).
    let data: Vec<IssueWithProject> = issues
        .into_iter()
        .filter_map(|issue| {
            let project = project_map.get(&issue.project_id)?;
            Some(IssueWithProject {
                id: issue.id,
                project_id: issue.project_id,
                project_name: project.name.clone(),
                project_slug: project.slug.clone(),
                project_platform: project.platform.clone(),
                fingerprint: issue.fingerprint,
                title: issue.title,
                status: issue.status,
                level: issue.level,
                first_seen: issue.first_seen.to_rfc3339(),
                last_seen: issue.last_seen.to_rfc3339(),
                count: issue.count,
                user_count: issue.user_count,
                environment: issue.environment,
            })
        })
        .take(500)
        .collect();

    Ok(Json(AcrossProjectsResponse {
        data,
        pagination: PaginationMeta {
            page,
            per_page: limit,
            total: total as u32,
            total_pages,
        },
    }))
}

#[derive(Debug, Serialize)]
pub struct ProjectStatsResponse {
    pub data: Vec<ProjectStatsWithInfo>,
    pub totals: AggregateTotals,
}

#[derive(Debug, Serialize)]
pub struct ProjectStatsWithInfo {
    pub project_id: String,
    pub project_name: String,
    pub project_slug: String,
    pub project_platform: Option<String>,
    pub unresolved_count: i64,
    pub total_events: i64,
    pub total_users: i64,
    pub critical_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AggregateTotals {
    pub unresolved: i64,
    pub events: i64,
    pub users: i64,
    pub critical: i64,
}

/// GET /api/v1/issues/stats/by-project
/// Get aggregated statistics grouped by project
pub async fn get_stats_by_project(
    State(state): State<AppState>,
    auth: EitherAuth,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
) -> AppResult<Json<ProjectStatsResponse>> {
    // Per-identity rate limit: this endpoint fans out across every project the
    // caller owns (one stats aggregation + one project list), so cap at 30/min
    // to match the cross-project list endpoint's load profile.
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("issues_stats_by_project", &auth),
        30,
    )?;

    // Gate: Pro+ tier required for cross-project statistics
    // x402_verified is set by the payment middleware when a valid feature_access payment was
    // verified; bypass the tier check only when x402 is enabled AND payment was verified.
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let (org_id, tier_str) = match &*auth {
            AuthIdentity::User(user) => {
                let org = OrganizationRepository::find_by_user(&state.db, &user.id)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;
                (org.id, org.tier)
            }
            AuthIdentity::Agent(agent) => {
                let org = OrganizationRepository::find_by_id(&state.db, &agent.organization_id)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("Organization not found".to_string()))?;
                (org.id, org.tier)
            }
        };
        if !can_access_feature(&tier_str, "cross_project_issues") {
            return Err(crate::payments::x402_feature_response(
                &state,
                "cross_project_issues",
                "/api/v1/issues/stats/by-project",
                &org_id,
                None,
                "Cross-project issue aggregation requires a Pro plan or higher.",
            )
            .await);
        }
    }

    // Get all projects based on auth type.
    // Cap at 1000 to prevent unbounded fan-out; log when we hit the cap so
    // ops can spot silent truncation for tenants with more projects.
    const STATS_PROJECT_CAP: i64 = 1000;
    let projects = match &*auth {
        AuthIdentity::User(user) => {
            ProjectRepository::find_by_owner(&state.db, &user.id, STATS_PROJECT_CAP, 0).await?
        }
        AuthIdentity::Agent(agent) => {
            ProjectRepository::find_by_organization(
                &state.db,
                &agent.organization_id,
                STATS_PROJECT_CAP,
                0,
            )
            .await?
        }
    };
    if projects.len() as i64 == STATS_PROJECT_CAP {
        match &*auth {
            AuthIdentity::User(user) => {
                tracing::warn!(
                    user_id = %user.id,
                    cap = STATS_PROJECT_CAP,
                    "project list at cap — may be truncated"
                );
            }
            AuthIdentity::Agent(agent) => {
                tracing::warn!(
                    organization_id = %agent.organization_id,
                    cap = STATS_PROJECT_CAP,
                    "project list at cap — may be truncated"
                );
            }
        }
    }

    if projects.is_empty() {
        return Ok(Json(ProjectStatsResponse {
            data: vec![],
            totals: AggregateTotals {
                unresolved: 0,
                events: 0,
                users: 0,
                critical: 0,
            },
        }));
    }

    let project_ids: Vec<String> = projects.iter().map(|p| p.id.clone()).collect();

    // Get stats for all projects
    let stats = IssueRepository::get_stats_by_project(&state.db, &project_ids).await?;
    let stats_map: HashMap<String, &ProjectStats> =
        stats.iter().map(|s| (s.project_id.clone(), s)).collect();

    // Calculate totals
    let mut totals = AggregateTotals {
        unresolved: 0,
        events: 0,
        users: 0,
        critical: 0,
    };

    // Build response with project info (include projects without issues)
    let data: Vec<ProjectStatsWithInfo> = projects
        .iter()
        .map(|project| {
            let stats = stats_map.get(&project.id);
            let unresolved_count = stats.map(|s| s.unresolved_count).unwrap_or(0);
            let total_events = stats.map(|s| s.total_events).unwrap_or(0);
            let total_users = stats.map(|s| s.total_users).unwrap_or(0);
            let critical_count = stats.map(|s| s.critical_count).unwrap_or(0);

            totals.unresolved += unresolved_count;
            totals.events += total_events;
            totals.users += total_users;
            totals.critical += critical_count;

            ProjectStatsWithInfo {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                project_slug: project.slug.clone(),
                project_platform: project.platform.clone(),
                unresolved_count,
                total_events,
                total_users,
                critical_count,
            }
        })
        .collect();

    Ok(Json(ProjectStatsResponse { data, totals }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- parse_payload_value ----

    #[test]
    fn parse_payload_value_valid_json() {
        let v = parse_payload_value(r#"{"key":"val"}"#);
        assert_eq!(v["key"], "val");
    }

    #[test]
    fn parse_payload_value_invalid_json_returns_null() {
        let v = parse_payload_value("not json");
        assert_eq!(v, serde_json::Value::Null);
    }

    #[test]
    fn parse_payload_value_empty_string_returns_null() {
        let v = parse_payload_value("");
        assert_eq!(v, serde_json::Value::Null);
    }

    // ---- parse_exception_from_payload ----

    #[test]
    fn parse_exception_sentry_format() {
        let payload = json!({
            "exception": {
                "values": [{
                    "type": "ValueError",
                    "value": "bad input",
                    "stacktrace": {
                        "frames": [{
                            "filename": "main.py",
                            "lineno": 42,
                            "colno": 0
                        }]
                    }
                }]
            }
        });
        let exc = parse_exception_from_payload(&payload).unwrap();
        assert_eq!(exc.exception_type, "ValueError");
        assert_eq!(exc.value, "bad input");
        assert_eq!(exc.stacktrace[0].filename, "main.py");
        assert_eq!(exc.stacktrace[0].lineno, 42);
    }

    #[test]
    fn parse_exception_bugwatch_format() {
        let payload = json!({
            "exception": {
                "type": "RuntimeError",
                "value": "oops",
                "stacktrace": [{
                    "filename": "app.rs",
                    "lineno": 10,
                    "colno": 0
                }]
            }
        });
        let exc = parse_exception_from_payload(&payload).unwrap();
        assert_eq!(exc.exception_type, "RuntimeError");
        assert_eq!(exc.value, "oops");
        assert_eq!(exc.stacktrace[0].filename, "app.rs");
    }

    #[test]
    fn parse_exception_missing_returns_none() {
        let payload = json!({"message": "no exception here"});
        assert!(parse_exception_from_payload(&payload).is_none());
    }

    // ---- parse_tags_from_payload ----

    #[test]
    fn parse_tags_extracts_object_tags() {
        let payload = json!({
            "tags": {"env": "prod", "version": "1.0"}
        });
        let tags = parse_tags_from_payload(&payload);
        assert_eq!(tags.get("env").map(|s| s.as_str()), Some("prod"));
        assert_eq!(tags.get("version").map(|s| s.as_str()), Some("1.0"));
    }

    #[test]
    fn parse_tags_extracts_environment_and_release() {
        let payload = json!({
            "environment": "staging",
            "release": "v2.3.4"
        });
        let tags = parse_tags_from_payload(&payload);
        assert_eq!(tags.get("environment").map(|s| s.as_str()), Some("staging"));
        assert_eq!(tags.get("release").map(|s| s.as_str()), Some("v2.3.4"));
    }

    #[test]
    fn parse_tags_extracts_browser_context() {
        let payload = json!({
            "contexts": {
                "browser": {"name": "Chrome", "version": "120"}
            }
        });
        let tags = parse_tags_from_payload(&payload);
        assert!(tags
            .get("browser")
            .map(|s| s.as_str())
            .unwrap_or("")
            .contains("Chrome"));
    }

    #[test]
    fn parse_tags_empty_payload_returns_empty_map() {
        let tags = parse_tags_from_payload(&json!({}));
        assert!(tags.is_empty());
    }

    // ---- parse_breadcrumbs_from_payload ----

    #[test]
    fn parse_breadcrumbs_extracts_fields() {
        let payload = json!({
            "breadcrumbs": [{
                "timestamp": "2024-01-01T00:00:00Z",
                "type": "http",
                "category": "fetch",
                "message": "GET /api",
                "level": "info"
            }]
        });
        let crumbs = parse_breadcrumbs_from_payload(&payload);
        assert_eq!(crumbs.len(), 1);
        assert_eq!(crumbs[0].category, "fetch");
        assert_eq!(crumbs[0].message.as_deref(), Some("GET /api"));
    }

    #[test]
    fn parse_breadcrumbs_missing_returns_empty() {
        let crumbs = parse_breadcrumbs_from_payload(&json!({}));
        assert!(crumbs.is_empty());
    }

    #[test]
    fn parse_breadcrumbs_default_level_is_info() {
        let payload = json!({
            "breadcrumbs": [{"timestamp": "t", "category": "ui"}]
        });
        let crumbs = parse_breadcrumbs_from_payload(&payload);
        assert_eq!(crumbs[0].level, "info");
    }

    // ---- parse_request_context_from_payload ----

    #[test]
    fn parse_request_context_extracts_url_and_method() {
        let payload = json!({
            "request": {"url": "https://example.com/api", "method": "POST"}
        });
        let ctx = parse_request_context_from_payload(&payload).unwrap();
        assert_eq!(ctx.url.as_deref(), Some("https://example.com/api"));
        assert_eq!(ctx.method.as_deref(), Some("POST"));
    }

    #[test]
    fn parse_request_context_redacts_auth_header() {
        let payload = json!({
            "request": {
                "url": "https://example.com",
                "headers": {
                    "Authorization": "Bearer secret",
                    "Content-Type": "application/json"
                }
            }
        });
        let ctx = parse_request_context_from_payload(&payload).unwrap();
        let headers = ctx.headers.unwrap();
        assert_eq!(
            headers.get("Authorization").map(|s| s.as_str()),
            Some("[REDACTED]")
        );
        assert_eq!(
            headers.get("Content-Type").map(|s| s.as_str()),
            Some("application/json")
        );
    }

    #[test]
    fn parse_request_context_falls_back_to_extra_request() {
        let payload = json!({
            "extra": {
                "request": {"url": "https://fallback.com", "method": "GET"}
            }
        });
        let ctx = parse_request_context_from_payload(&payload).unwrap();
        assert_eq!(ctx.url.as_deref(), Some("https://fallback.com"));
    }

    #[test]
    fn parse_request_context_missing_returns_none() {
        assert!(parse_request_context_from_payload(&json!({})).is_none());
    }

    // ---- parse_user_context_from_payload ----

    #[test]
    fn parse_user_context_extracts_fields() {
        let payload = json!({
            "user": {"id": "u1", "email": "a@b.com", "username": "alice"}
        });
        let user = parse_user_context_from_payload(&payload).unwrap();
        assert_eq!(user.id.as_deref(), Some("u1"));
        assert_eq!(user.email.as_deref(), Some("a@b.com"));
        assert_eq!(user.username.as_deref(), Some("alice"));
    }

    #[test]
    fn parse_user_context_missing_returns_none() {
        assert!(parse_user_context_from_payload(&json!({})).is_none());
    }

    // ---- parse_extra_from_payload ----

    #[test]
    fn parse_extra_returns_value_when_present() {
        let payload = json!({"extra": {"foo": "bar"}});
        let extra = parse_extra_from_payload(&payload).unwrap();
        assert_eq!(extra["foo"], "bar");
    }

    #[test]
    fn parse_extra_returns_none_when_absent() {
        assert!(parse_extra_from_payload(&json!({})).is_none());
    }

    // ---- validate_search_filters ----

    fn base_filters() -> SearchFiltersRequest {
        SearchFiltersRequest {
            status: None,
            level: None,
            environment: None,
            count_gt: None,
            count_lt: None,
            count_gte: None,
            count_lte: None,
            users_gt: None,
            users_lt: None,
            first_seen_after: None,
            first_seen_before: None,
            last_seen_after: None,
            last_seen_before: None,
            text: None,
        }
    }

    #[test]
    fn validate_search_filters_valid_status() {
        let f = SearchFiltersRequest {
            status: Some(vec!["unresolved".to_string()]),
            ..base_filters()
        };
        assert!(validate_search_filters(&f).is_ok());
    }

    #[test]
    fn validate_search_filters_invalid_status_rejected() {
        let f = SearchFiltersRequest {
            status: Some(vec!["hacked".to_string()]),
            ..base_filters()
        };
        assert!(validate_search_filters(&f).is_err());
    }

    #[test]
    fn validate_search_filters_invalid_level_rejected() {
        let f = SearchFiltersRequest {
            level: Some(vec!["error".to_string(), "hacked".to_string()]),
            ..base_filters()
        };
        assert!(validate_search_filters(&f).is_err());
    }

    #[test]
    fn validate_search_filters_environment_non_ascii_rejected() {
        let f = SearchFiltersRequest {
            environment: Some(vec!["prod\nnewline".to_string()]),
            ..base_filters()
        };
        assert!(validate_search_filters(&f).is_err());
    }

    #[test]
    fn validate_search_filters_environment_too_long_rejected() {
        let f = SearchFiltersRequest {
            environment: Some(vec!["a".repeat(65)]),
            ..base_filters()
        };
        assert!(validate_search_filters(&f).is_err());
    }

    #[test]
    fn validate_search_filters_valid_environment_accepted() {
        let f = SearchFiltersRequest {
            environment: Some(vec!["production".to_string(), "staging".to_string()]),
            ..base_filters()
        };
        assert!(validate_search_filters(&f).is_ok());
    }
}
