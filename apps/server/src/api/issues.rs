use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::{ApiResponse, PaginatedResponse, PaginationMeta, PaginationParams};
use crate::{
    auth::AuthUser,
    db::repositories::{
        issues::{Facets, SearchFilters},
        EventRepository, IssueRepository, ProjectRepository,
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
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct IssueFilters {
    pub status: Option<String>,
    pub level: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateIssueRequest {
    pub status: Option<String>,
}

/// GET /api/v1/projects/:project_id/issues
pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Query(params): Query<PaginationParams>,
    Query(filters): Query<IssueFilters>,
) -> AppResult<Json<PaginatedResponse<IssueResponse>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    let page = params.page.max(1);
    let per_page = params.per_page.min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    let issues = IssueRepository::find_by_project(
        &state.db,
        &project_id,
        filters.status.as_deref(),
        filters.level.as_deref(),
        per_page as i64,
        offset,
    )
    .await?;

    let total = IssueRepository::count_by_project(&state.db, &project_id, filters.status.as_deref()).await?;
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
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(req): Json<SearchRequest>,
) -> AppResult<Json<SearchResponse>> {
    let start = std::time::Instant::now();

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    let page = req.page.unwrap_or(1).max(1);
    let per_page = req.per_page.unwrap_or(50).min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    // Convert API filters to repository filters
    let filters = SearchFilters {
        status: req.filters.as_ref().and_then(|f| f.status.clone()),
        level: req.filters.as_ref().and_then(|f| f.level.clone()),
        count_gt: req.filters.as_ref().and_then(|f| f.count_gt),
        count_lt: req.filters.as_ref().and_then(|f| f.count_lt),
        count_gte: req.filters.as_ref().and_then(|f| f.count_gte),
        count_lte: req.filters.as_ref().and_then(|f| f.count_lte),
        users_gt: req.filters.as_ref().and_then(|f| f.users_gt),
        users_lt: req.filters.as_ref().and_then(|f| f.users_lt),
        first_seen_after: req.filters.as_ref().and_then(|f| f.first_seen_after.clone()),
        first_seen_before: req.filters.as_ref().and_then(|f| f.first_seen_before.clone()),
        last_seen_after: req.filters.as_ref().and_then(|f| f.last_seen_after.clone()),
        last_seen_before: req.filters.as_ref().and_then(|f| f.last_seen_before.clone()),
        text: req.filters.as_ref().and_then(|f| f.text.clone()),
    };

    let sort_field = req.sort.as_ref().map(|s| s.field.as_str());
    let sort_direction = req.sort.as_ref().and_then(|s| s.direction.as_deref());

    // Run search and facet queries
    let issues = IssueRepository::search(
        &state.db,
        &project_id,
        &filters,
        sort_field,
        sort_direction,
        per_page as i64,
        offset,
    )
    .await?;

    let total = IssueRepository::count_search(&state.db, &project_id, &filters).await?;
    let facets = IssueRepository::get_facets(&state.db, &project_id).await?;

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

#[derive(Debug, Deserialize)]
pub struct SortConfig {
    pub field: String,
    pub direction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub data: Vec<IssueResponse>,
    pub pagination: PaginationMeta,
    pub facets: Facets,
    pub query_time_ms: u64,
}

/// GET /api/v1/projects/:project_id/issues/:issue_id
pub async fn get(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<IssueDetail>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get issue
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    // Verify issue belongs to project
    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    // Get recent events
    let events = EventRepository::find_by_issue(&state.db, &issue_id, 10, 0).await?;

    // Parse all context from the most recent event
    let (exception, tags, breadcrumbs, request, user, extra) = if let Some(event) = events.first() {
        (
            parse_exception_from_payload(&event.payload),
            parse_tags_from_payload(&event.payload),
            parse_breadcrumbs_from_payload(&event.payload),
            parse_request_context_from_payload(&event.payload),
            parse_user_context_from_payload(&event.payload),
            parse_extra_from_payload(&event.payload),
        )
    } else {
        (None, HashMap::new(), vec![], None, None, None)
    };

    let recent_events: Vec<EventSummary> = events
        .iter()
        .map(|e| {
            let payload: serde_json::Value = serde_json::from_str(&e.payload).unwrap_or_default();
            EventSummary {
                id: e.id.clone(),
                timestamp: e.timestamp.to_rfc3339(),
                user_id: payload.get("user").and_then(|u| u.get("id")).and_then(|v| v.as_str()).map(String::from),
                release: payload.get("release").and_then(|v| v.as_str()).map(String::from),
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
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
    Json(req): Json<UpdateIssueRequest>,
) -> AppResult<Json<ApiResponse<IssueResponse>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get issue
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    // Verify issue belongs to project
    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    // Update status if provided
    if let Some(status) = &req.status {
        let valid_statuses = ["unresolved", "resolved", "ignored"];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid status. Must be one of: {}",
                valid_statuses.join(", ")
            )));
        }
        IssueRepository::update_status(&state.db, &issue_id, status).await?;
    }

    // Fetch updated issue
    let updated = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to fetch updated issue".to_string()))?;

    Ok(Json(ApiResponse {
        data: IssueResponse::from(updated),
    }))
}

/// DELETE /api/v1/projects/:project_id/issues/:issue_id
pub async fn delete(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get issue
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    // Verify issue belongs to project
    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    IssueRepository::delete(&state.db, &issue_id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Issue deleted successfully" }),
    }))
}

/// GET /api/v1/projects/:project_id/issues/:issue_id/events/:event_id
pub async fn get_event(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, issue_id, event_id)): Path<(String, String, String)>,
) -> AppResult<Json<ApiResponse<EventDetail>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get issue to verify it belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    // Get the event
    let event = EventRepository::find_by_id(&state.db, &event_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Event {} not found", event_id)))?;

    // Verify event belongs to issue
    if event.issue_id != issue_id {
        return Err(AppError::NotFound(format!("Event {} not found in issue", event_id)));
    }

    // Parse all context from the event
    let exception = parse_exception_from_payload(&event.payload);
    let tags = parse_tags_from_payload(&event.payload);
    let breadcrumbs = parse_breadcrumbs_from_payload(&event.payload);
    let request = parse_request_context_from_payload(&event.payload);
    let user = parse_user_context_from_payload(&event.payload);
    let extra = parse_extra_from_payload(&event.payload);

    // Parse additional metadata
    let payload: serde_json::Value = serde_json::from_str(&event.payload).unwrap_or_default();
    let release = payload.get("release").and_then(|v| v.as_str()).map(String::from);
    let environment = payload.get("environment").and_then(|v| v.as_str()).map(String::from);
    let server_name = payload.get("server_name").and_then(|v| v.as_str()).map(String::from);

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
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
    Query(params): Query<FrequencyParams>,
) -> AppResult<Json<ApiResponse<FrequencyData>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get issue to verify it belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    // Get events for the issue within the time range
    let period = params.period.as_deref().unwrap_or("24h");
    let (hours, bucket_size_hours): (i64, i64) = match period {
        "7d" => (168, 24),   // 7 days, daily buckets
        "30d" => (720, 24),  // 30 days, daily buckets
        _ => (24, 1),        // 24 hours, hourly buckets
    };

    let events = EventRepository::find_by_issue(&state.db, &issue_id, 1000, 0).await?;

    // Group events into time buckets
    let now = chrono::Utc::now();
    let start_time = now - chrono::Duration::hours(hours);
    let num_buckets = (hours / bucket_size_hours) as usize;

    let mut buckets: Vec<FrequencyBucket> = (0..num_buckets)
        .map(|i| {
            let bucket_start = start_time + chrono::Duration::hours(i as i64 * bucket_size_hours);
            FrequencyBucket {
                timestamp: bucket_start.to_rfc3339(),
                count: 0,
            }
        })
        .collect();

    // Count events in each bucket
    let mut total_in_period: u32 = 0;

    for event in &events {
        let event_time = event.timestamp;
        if event_time >= start_time && event_time <= now {
            let hours_since_start = (event_time - start_time).num_hours();
            // Clamp bucket_index to valid range (0 to num_buckets-1)
            let bucket_index = std::cmp::min(
                (hours_since_start / bucket_size_hours) as usize,
                buckets.len().saturating_sub(1)
            );
            buckets[bucket_index].count += 1;
            total_in_period += 1;
        }
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
    pub vars: Option<serde_json::Value>,  // Local variables at this frame
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

fn parse_exception_from_payload(payload: &str) -> Option<ExceptionDetail> {
    let json: serde_json::Value = serde_json::from_str(payload).ok()?;
    let exception_obj = json.get("exception")?;

    // Try Sentry format first: exception.values[0]
    // Then try Bugwatch Python SDK format: exception directly has type/value/stacktrace
    let (exception_type, value, frames) = if let Some(values) = exception_obj.get("values").and_then(|v| v.as_array()) {
        // Sentry format
        let exc = values.get(0)?;
        let exc_type = exc.get("type")?.as_str()?.to_string();
        let exc_value = exc.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let frames = exc.get("stacktrace")?.get("frames")?.as_array()?;
        (exc_type, exc_value, frames.clone())
    } else {
        // Bugwatch Python SDK format
        let exc_type = exception_obj.get("type")?.as_str()?.to_string();
        let exc_value = exception_obj.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let frames = exception_obj.get("stacktrace")?.as_array()?;
        (exc_type, exc_value, frames.clone())
    };

    let stacktrace = frames
        .iter()
        .filter_map(|frame| {
            Some(StackFrameDetail {
                filename: frame.get("filename")?.as_str()?.to_string(),
                function: frame.get("function").and_then(|v| v.as_str()).unwrap_or("<anonymous>").to_string(),
                lineno: frame.get("lineno")?.as_u64()? as u32,
                colno: frame.get("colno").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                context_line: frame.get("context_line").and_then(|v| v.as_str()).map(String::from),
                pre_context: frame
                    .get("pre_context")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
                post_context: frame
                    .get("post_context")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
                in_app: frame.get("in_app").and_then(|v| v.as_bool()).unwrap_or(true),
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

fn parse_tags_from_payload(payload: &str) -> HashMap<String, String> {
    let mut tags = HashMap::new();

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) {
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
                    let version = browser.get("version").and_then(|v| v.as_str()).unwrap_or("");
                    tags.insert("browser".to_string(), format!("{} {}", name, version).trim().to_string());
                }
            }
            // OS
            if let Some(os) = contexts.get("os") {
                if let Some(name) = os.get("name").and_then(|v| v.as_str()) {
                    let version = os.get("version").and_then(|v| v.as_str()).unwrap_or("");
                    tags.insert("os".to_string(), format!("{} {}", name, version).trim().to_string());
                }
            }
            // Runtime
            if let Some(runtime) = contexts.get("runtime") {
                if let Some(name) = runtime.get("name").and_then(|v| v.as_str()) {
                    let version = runtime.get("version").and_then(|v| v.as_str()).unwrap_or("");
                    tags.insert("runtime".to_string(), format!("{} {}", name, version).trim().to_string());
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

fn parse_breadcrumbs_from_payload(payload: &str) -> Vec<BreadcrumbDetail> {
    let json: serde_json::Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let breadcrumbs = match json.get("breadcrumbs").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return vec![],
    };

    breadcrumbs
        .iter()
        .filter_map(|b| {
            Some(BreadcrumbDetail {
                timestamp: b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                breadcrumb_type: b.get("type").and_then(|v| v.as_str()).unwrap_or("default").to_string(),
                category: b.get("category").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                message: b.get("message").and_then(|v| v.as_str()).map(String::from),
                level: b.get("level").and_then(|v| v.as_str()).unwrap_or("info").to_string(),
                data: b.get("data").cloned(),
            })
        })
        .collect()
}

fn parse_request_context_from_payload(payload: &str) -> Option<RequestContextDetail> {
    let json: serde_json::Value = serde_json::from_str(payload).ok()?;

    // Try top-level "request" first, then fall back to "extra.request" (Django SDK format)
    let request = json.get("request")
        .or_else(|| json.get("extra").and_then(|e| e.get("request")))?;

    // Sanitize headers - redact sensitive values
    let headers = request.get("headers").and_then(|h| h.as_object()).map(|obj| {
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
        url: request.get("url").and_then(|v| v.as_str()).map(String::from),
        method: request.get("method").and_then(|v| v.as_str()).map(String::from),
        headers,
        query_string: request.get("query_string").and_then(|v| v.as_str()).map(String::from),
        data: request.get("data").cloned(),
    })
}

fn parse_user_context_from_payload(payload: &str) -> Option<UserContextDetail> {
    let json: serde_json::Value = serde_json::from_str(payload).ok()?;
    let user = json.get("user")?;

    Some(UserContextDetail {
        id: user.get("id").and_then(|v| v.as_str()).map(String::from),
        email: user.get("email").and_then(|v| v.as_str()).map(String::from),
        username: user.get("username").and_then(|v| v.as_str()).map(String::from),
        ip_address: user.get("ip_address").and_then(|v| v.as_str()).map(String::from),
        extra: user.get("extra").cloned(),
    })
}

fn parse_extra_from_payload(payload: &str) -> Option<serde_json::Value> {
    let json: serde_json::Value = serde_json::from_str(payload).ok()?;
    json.get("extra").cloned()
}

/// GET /api/v1/projects/:project_id/issues/:issue_id/impact
pub async fn get_impact(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<ImpactData>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get issue to verify it belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    // Get all events for this issue
    let events = EventRepository::find_by_issue(&state.db, &issue_id, 1000, 0).await?;

    let now = chrono::Utc::now();
    let one_hour_ago = now - chrono::Duration::hours(1);
    let two_hours_ago = now - chrono::Duration::hours(2);

    // Track unique values
    let mut unique_users: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut unique_sessions: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut browser_counts: HashMap<String, u32> = HashMap::new();
    let mut os_counts: HashMap<String, u32> = HashMap::new();

    let mut last_hour_count = 0u32;
    let mut prev_hour_count = 0u32;

    for event in &events {
        // Parse event payload
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&event.payload) {
            // Count unique users
            if let Some(user_id) = payload.get("user").and_then(|u| u.get("id")).and_then(|v| v.as_str()) {
                unique_users.insert(user_id.to_string());
            }

            // Count unique sessions (use IP as proxy if no session ID)
            if let Some(session_id) = payload.get("session_id").and_then(|v| v.as_str()) {
                unique_sessions.insert(session_id.to_string());
            } else if let Some(ip) = payload.get("user").and_then(|u| u.get("ip_address")).and_then(|v| v.as_str()) {
                unique_sessions.insert(ip.to_string());
            }

            // Browser distribution
            if let Some(browser) = payload.get("tags").and_then(|t| t.get("browser")).and_then(|v| v.as_str()) {
                *browser_counts.entry(browser.to_string()).or_insert(0) += 1;
            } else if let Some(runtime) = payload.get("tags").and_then(|t| t.get("runtime")).and_then(|v| v.as_str()) {
                *browser_counts.entry(runtime.to_string()).or_insert(0) += 1;
            }

            // OS distribution
            if let Some(os) = payload.get("tags").and_then(|t| t.get("os.name")).and_then(|v| v.as_str()) {
                *os_counts.entry(os.to_string()).or_insert(0) += 1;
            }
        }

        // Calculate trend
        let event_time = event.timestamp;
        if event_time >= one_hour_ago {
            last_hour_count += 1;
        } else if event_time >= two_hours_ago {
            prev_hour_count += 1;
        }
    }

    // Calculate trend percentage
    let trend_percent = if prev_hour_count > 0 {
        ((last_hour_count as f64 - prev_hour_count as f64) / prev_hour_count as f64 * 100.0).round() as i32
    } else if last_hour_count > 0 {
        100 // New issue, 100% increase
    } else {
        0
    };

    // Calculate if trending
    let is_trending = trend_percent > 50 && last_hour_count > 5;

    // Convert browser/OS counts to sorted lists (top 5)
    let mut browsers: Vec<_> = browser_counts.into_iter().collect();
    browsers.sort_by(|a, b| b.1.cmp(&a.1));
    let browsers: Vec<DistributionItem> = browsers.into_iter().take(5).map(|(name, count)| {
        let percentage = if events.len() > 0 { (count as f64 / events.len() as f64 * 100.0).round() as u32 } else { 0 };
        DistributionItem { name, count, percentage }
    }).collect();

    let mut oses: Vec<_> = os_counts.into_iter().collect();
    oses.sort_by(|a, b| b.1.cmp(&a.1));
    let oses: Vec<DistributionItem> = oses.into_iter().take(5).map(|(name, count)| {
        let percentage = if events.len() > 0 { (count as f64 / events.len() as f64 * 100.0).round() as u32 } else { 0 };
        DistributionItem { name, count, percentage }
    }).collect();

    Ok(Json(ApiResponse {
        data: ImpactData {
            unique_users: unique_users.len() as u32,
            unique_sessions: unique_sessions.len() as u32,
            total_events: events.len() as u32,
            first_seen: issue.first_seen.to_rfc3339(),
            last_seen: issue.last_seen.to_rfc3339(),
            last_hour_count,
            trend_percent,
            is_trending,
            browsers,
            operating_systems: oses,
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

/// Parse timestamp with multiple format support for flexibility
fn parse_flexible_timestamp(timestamp: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    // Try RFC3339 first (most common) - handles 2024-01-15T14:22:00+00:00
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(timestamp) {
        return Some(dt.with_timezone(&chrono::Utc));
    }

    // Try ISO 8601 formats with timezone
    let tz_formats = [
        "%Y-%m-%dT%H:%M:%S%.f%:z",  // 2024-01-15T14:22:00.123456+00:00
        "%Y-%m-%dT%H:%M:%S%:z",     // 2024-01-15T14:22:00+00:00
        "%Y-%m-%dT%H:%M:%S%.f%z",   // 2024-01-15T14:22:00.123456+0000
        "%Y-%m-%dT%H:%M:%S%z",      // 2024-01-15T14:22:00+0000
    ];

    for fmt in &tz_formats {
        if let Ok(dt) = chrono::DateTime::parse_from_str(timestamp, fmt) {
            return Some(dt.with_timezone(&chrono::Utc));
        }
    }

    // Try without timezone (assume UTC)
    let naive_formats = [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
    ];

    for fmt in &naive_formats {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(timestamp, fmt) {
            return Some(dt.and_utc());
        }
    }

    // Handle 'Z' suffix (UTC) - some systems use this
    if timestamp.ends_with('Z') {
        let ts_without_z = &timestamp[..timestamp.len() - 1];
        for fmt in &["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S"] {
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(ts_without_z, fmt) {
                return Some(dt.and_utc());
            }
        }
    }

    None
}
