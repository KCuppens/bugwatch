use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{
    api::{PaginatedResponse, PaginationMeta, PaginationParams},
    auth::{EitherAuth, AuthIdentity},
    billing::tiers::{get_tier_limits, Tier},
    db::{
        models::{Monitor, MonitorCheck, MonitorIncident},
        repositories::{MonitorCheckRepository, MonitorIncidentRepository, MonitorRepository, OrganizationRepository, ProjectRepository},
    },
    AppError, AppResult, AppState,
};

/// Validate that a monitor URL is safe (no SSRF to internal networks)
fn validate_monitor_url(url_str: &str) -> Result<(), crate::AppError> {
    let parsed = url::Url::parse(url_str)
        .map_err(|_| crate::AppError::BadRequest("Invalid URL format".to_string()))?;

    // Require http or https scheme
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(crate::AppError::BadRequest("URL must use http or https scheme".to_string())),
    }

    // Get the host
    let host = parsed.host_str()
        .ok_or_else(|| crate::AppError::BadRequest("URL must have a host".to_string()))?;

    // Block localhost and loopback
    let blocked_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"];
    if blocked_hosts.iter().any(|&h| host.eq_ignore_ascii_case(h)) {
        return Err(crate::AppError::BadRequest("URL cannot target localhost or loopback addresses".to_string()));
    }

    // Try to parse as IP and block private/reserved ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let is_blocked = match ip {
            std::net::IpAddr::V4(ipv4) => {
                ipv4.is_loopback()           // 127.0.0.0/8
                || ipv4.is_private()         // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || ipv4.is_link_local()      // 169.254.0.0/16
                || ipv4.is_unspecified()     // 0.0.0.0
                || ipv4.octets()[0] == 169 && ipv4.octets()[1] == 254  // link-local / cloud metadata
            }
            std::net::IpAddr::V6(ipv6) => {
                ipv6.is_loopback()
                || ipv6.is_unspecified()
            }
        };
        if is_blocked {
            return Err(crate::AppError::BadRequest("URL cannot target private, loopback, or link-local addresses".to_string()));
        }
    }

    // Block well-known cloud metadata endpoints
    if host == "169.254.169.254" || host == "metadata.google.internal" {
        return Err(crate::AppError::BadRequest("URL cannot target cloud metadata endpoints".to_string()));
    }

    Ok(())
}

/// Request to create a monitor
#[derive(Debug, Deserialize)]
pub struct CreateMonitorRequest {
    pub name: String,
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default = "default_interval")]
    pub interval_seconds: i32,
    #[serde(default = "default_timeout")]
    pub timeout_ms: i32,
    pub expected_status: Option<i32>,
    #[serde(default)]
    pub headers: serde_json::Value,
    pub body: Option<String>,
}

fn default_method() -> String {
    "GET".to_string()
}

fn default_interval() -> i32 {
    60
}

fn default_timeout() -> i32 {
    30000
}

/// Request to update a monitor
#[derive(Debug, Deserialize)]
pub struct UpdateMonitorRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub method: Option<String>,
    pub interval_seconds: Option<i32>,
    pub timeout_ms: Option<i32>,
    pub expected_status: Option<i32>,
    pub headers: Option<serde_json::Value>,
    pub body: Option<String>,
    pub is_active: Option<bool>,
}

/// Monitor response with stats
#[derive(Debug, Serialize)]
pub struct MonitorResponse {
    #[serde(flatten)]
    pub monitor: Monitor,
    pub uptime_24h: Option<f64>,
    pub avg_response_24h: Option<f64>,
    pub last_error: Option<String>,
}

/// Monitor detail response
#[derive(Debug, Serialize)]
pub struct MonitorDetailResponse {
    #[serde(flatten)]
    pub monitor: Monitor,
    pub uptime_24h: Option<f64>,
    pub avg_response_24h: Option<f64>,
    pub recent_checks: Vec<MonitorCheck>,
    pub recent_incidents: Vec<MonitorIncident>,
}

/// Monitor with project info for cross-project view
#[derive(Debug, Serialize)]
pub struct MonitorWithProjectInfo {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub name: String,
    pub url: String,
    pub current_status: String,
    pub uptime_24h: Option<f64>,
    pub avg_response_24h: Option<f64>,
    pub last_error: Option<String>,
    pub last_checked_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MonitorsSummary {
    pub total: u32,
    pub up: u32,
    pub down: u32,
}

#[derive(Debug, Serialize)]
pub struct MonitorsAcrossProjectsResponse {
    pub data: Vec<MonitorWithProjectInfo>,
    pub summary: MonitorsSummary,
}

/// GET /api/v1/monitors/across-projects
pub async fn list_across_projects(
    State(state): State<AppState>,
    auth: EitherAuth,
) -> AppResult<Json<MonitorsAcrossProjectsResponse>> {
    // Get all user's projects
    let projects = match &*auth {
        AuthIdentity::User(user) => ProjectRepository::find_by_owner(&state.db, &user.id, 100, 0).await?,
        AuthIdentity::Agent(agent) => ProjectRepository::find_by_organization(&state.db, &agent.organization_id, 100, 0).await?,
    };

    if projects.is_empty() {
        return Ok(Json(MonitorsAcrossProjectsResponse {
            data: vec![],
            summary: MonitorsSummary { total: 0, up: 0, down: 0 },
        }));
    }

    let project_ids: Vec<String> = projects.iter().map(|p| p.id.clone()).collect();
    let project_map: std::collections::HashMap<String, &crate::db::models::Project> =
        projects.iter().map(|p| (p.id.clone(), p)).collect();

    // Fetch active monitors across all projects
    let monitors = MonitorRepository::list_active_across_projects(&state.db, &project_ids)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list monitors: {}", e)))?;

    let mut up_count: u32 = 0;
    let mut down_count: u32 = 0;
    let mut monitor_responses = Vec::with_capacity(monitors.len());

    for monitor in monitors {
        // Count up/down
        if monitor.current_status == "down" {
            down_count += 1;
        } else {
            up_count += 1;
        }

        // Get uptime stats
        let stats = MonitorCheckRepository::get_uptime_stats(&state.db, &monitor.id, 24).await;
        let (uptime, avg_response) = match stats {
            Ok((total, up, avg)) if total > 0 => {
                let uptime = (up as f64 / total as f64) * 100.0;
                (Some(uptime), avg)
            }
            _ => (None, None),
        };

        // Get last error if monitor is down
        let last_error = if monitor.current_status == "down" {
            MonitorCheckRepository::get_last_error(&state.db, &monitor.id)
                .await
                .ok()
                .flatten()
        } else {
            None
        };

        let project_name = project_map
            .get(&monitor.project_id)
            .map(|p| p.name.clone())
            .unwrap_or_default();

        monitor_responses.push(MonitorWithProjectInfo {
            id: monitor.id,
            project_id: monitor.project_id,
            project_name,
            name: monitor.name,
            url: monitor.url,
            current_status: monitor.current_status,
            uptime_24h: uptime,
            avg_response_24h: avg_response,
            last_error,
            last_checked_at: monitor.last_checked_at.map(|t| t.to_rfc3339()),
        });
    }

    let total = up_count + down_count;

    Ok(Json(MonitorsAcrossProjectsResponse {
        data: monitor_responses,
        summary: MonitorsSummary { total, up: up_count, down: down_count },
    }))
}

/// POST /api/v1/projects/:project_id/monitors
pub async fn create(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Json(request): Json<CreateMonitorRequest>,
) -> AppResult<Json<MonitorResponse>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project exists and user has access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Enforce monitor limit based on tier (counted across all org projects)
    let tier_str = OrganizationRepository::get_project_tier(&state.db, &project_id).await
        .unwrap_or_else(|_| "free".to_string());
    let tier = Tier::from_str(&tier_str);
    let limits = get_tier_limits(tier);
    if limits.monitor_limit >= 0 {
        let owner_id = match &*auth {
            AuthIdentity::User(user) => user.id.clone(),
            AuthIdentity::Agent(_) => project.owner_id.clone(),
        };
        let current_count = MonitorRepository::count_by_owner(&state.db, &owner_id).await
            .map_err(|e| AppError::Internal(format!("Failed to count monitors: {}", e)))?;
        if current_count >= limits.monitor_limit as i64 {
            return Err(AppError::PaymentRequired(format!(
                "Monitor limit reached ({}/{}). Upgrade your plan to add more monitors.",
                current_count, limits.monitor_limit
            )));
        }
    }

    // Input length validation
    if request.name.len() > 200 {
        return Err(AppError::BadRequest("Monitor name too long (max 200 characters)".to_string()));
    }
    if request.url.len() > 2048 {
        return Err(AppError::BadRequest("Monitor URL too long (max 2048 characters)".to_string()));
    }

    // Validate URL (scheme + SSRF protection)
    validate_monitor_url(&request.url)?;

    // Validate interval (minimum 30 seconds)
    if request.interval_seconds < 30 {
        return Err(AppError::BadRequest("Interval must be at least 30 seconds".to_string()));
    }

    let headers_str = serde_json::to_string(&request.headers)
        .map_err(|_| AppError::BadRequest("Invalid headers format".to_string()))?;

    let monitor = MonitorRepository::create(
        &state.db,
        &project_id,
        &request.name,
        &request.url,
        &request.method,
        request.interval_seconds,
        request.timeout_ms,
        request.expected_status,
        &headers_str,
        request.body.as_deref(),
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create monitor: {}", e)))?;

    Ok(Json(MonitorResponse {
        monitor,
        uptime_24h: None,
        avg_response_24h: None,
        last_error: None,
    }))
}

/// GET /api/v1/projects/:project_id/monitors
pub async fn list(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Query(params): Query<PaginationParams>,
) -> AppResult<Json<PaginatedResponse<MonitorResponse>>> {
    // Verify project exists and user has access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let (monitors, total) = MonitorRepository::list_by_project(&state.db, &project_id, params.page, params.per_page)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list monitors: {}", e)))?;

    // Fetch stats for each monitor
    let mut monitor_responses = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let stats = MonitorCheckRepository::get_uptime_stats(&state.db, &monitor.id, 24).await;
        let (uptime, avg_response) = match stats {
            Ok((total, up, avg)) if total > 0 => {
                let uptime = (up as f64 / total as f64) * 100.0;
                (Some(uptime), avg)
            }
            Ok((total, _, _)) => {
                // No checks in time window
                if total == 0 {
                    warn!("No monitor checks found for {} in last 24h", monitor.id);
                }
                (None, None)
            }
            Err(e) => {
                warn!("Failed to get uptime stats for monitor {}: {}", monitor.id, e);
                (None, None)
            }
        };

        // Get last error if monitor is down
        let last_error = if monitor.current_status == "down" {
            MonitorCheckRepository::get_last_error(&state.db, &monitor.id)
                .await
                .ok()
                .flatten()
        } else {
            None
        };

        monitor_responses.push(MonitorResponse {
            monitor,
            uptime_24h: uptime,
            avg_response_24h: avg_response,
            last_error,
        });
    }

    let total_pages = ((total as f64) / (params.per_page as f64)).ceil() as u32;

    Ok(Json(PaginatedResponse {
        data: monitor_responses,
        pagination: PaginationMeta {
            page: params.page,
            per_page: params.per_page,
            total: total as u32,
            total_pages,
        },
    }))
}

/// GET /api/v1/projects/:project_id/monitors/:monitor_id
pub async fn get(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, monitor_id)): Path<(String, String)>,
) -> AppResult<Json<MonitorDetailResponse>> {
    // Verify project exists and user has access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let monitor = MonitorRepository::find_by_id(&state.db, &monitor_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Monitor not found".to_string()))?;

    if monitor.project_id != project_id {
        return Err(AppError::NotFound("Monitor not found".to_string()));
    }

    // Get stats
    let stats = MonitorCheckRepository::get_uptime_stats(&state.db, &monitor_id, 24).await;
    let (uptime, avg_response) = match stats {
        Ok((total, up, avg)) if total > 0 => {
            let uptime = (up as f64 / total as f64) * 100.0;
            (Some(uptime), avg)
        }
        _ => (None, None),
    };

    // Get recent checks
    let recent_checks = MonitorCheckRepository::list_by_monitor(&state.db, &monitor_id, 50)
        .await
        .unwrap_or_default();

    // Get recent incidents
    let recent_incidents = MonitorIncidentRepository::list_by_monitor(&state.db, &monitor_id, 10)
        .await
        .unwrap_or_default();

    Ok(Json(MonitorDetailResponse {
        monitor,
        uptime_24h: uptime,
        avg_response_24h: avg_response,
        recent_checks,
        recent_incidents,
    }))
}

/// PATCH /api/v1/projects/:project_id/monitors/:monitor_id
pub async fn update(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, monitor_id)): Path<(String, String)>,
    Json(request): Json<UpdateMonitorRequest>,
) -> AppResult<Json<MonitorResponse>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project exists and user has access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let monitor = MonitorRepository::find_by_id(&state.db, &monitor_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Monitor not found".to_string()))?;

    if monitor.project_id != project_id {
        return Err(AppError::NotFound("Monitor not found".to_string()));
    }

    // Input length validation
    if let Some(ref name) = request.name {
        if name.len() > 200 {
            return Err(AppError::BadRequest("Monitor name too long (max 200 characters)".to_string()));
        }
    }
    if let Some(ref url) = request.url {
        if url.len() > 2048 {
            return Err(AppError::BadRequest("Monitor URL too long (max 2048 characters)".to_string()));
        }
    }

    // Validate URL if provided (scheme + SSRF protection)
    if let Some(ref url) = request.url {
        validate_monitor_url(url)?;
    }

    // Validate interval if provided
    if let Some(interval) = request.interval_seconds {
        if interval < 30 {
            return Err(AppError::BadRequest("Interval must be at least 30 seconds".to_string()));
        }
    }

    let headers_str = request
        .headers
        .as_ref()
        .map(|h| serde_json::to_string(h))
        .transpose()
        .map_err(|_| AppError::BadRequest("Invalid headers format".to_string()))?;

    let updated = MonitorRepository::update(
        &state.db,
        &monitor_id,
        request.name.as_deref(),
        request.url.as_deref(),
        request.method.as_deref(),
        request.interval_seconds,
        request.timeout_ms,
        request.expected_status,
        headers_str.as_deref(),
        request.body.as_deref(),
        request.is_active,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to update monitor: {}", e)))?;

    // Fetch stats so the response includes uptime data
    let stats = MonitorCheckRepository::get_uptime_stats(&state.db, &monitor_id, 24).await;
    let (uptime, avg_response) = match stats {
        Ok((total, up, avg)) if total > 0 => {
            let uptime = (up as f64 / total as f64) * 100.0;
            (Some(uptime), avg)
        }
        _ => (None, None),
    };

    let last_error = if updated.current_status == "down" {
        MonitorCheckRepository::get_last_error(&state.db, &updated.id)
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    Ok(Json(MonitorResponse {
        monitor: updated,
        uptime_24h: uptime,
        avg_response_24h: avg_response,
        last_error,
    }))
}

/// DELETE /api/v1/projects/:project_id/monitors/:monitor_id
pub async fn delete(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, monitor_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project exists and user has access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let monitor = MonitorRepository::find_by_id(&state.db, &monitor_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Monitor not found".to_string()))?;

    if monitor.project_id != project_id {
        return Err(AppError::NotFound("Monitor not found".to_string()));
    }

    MonitorRepository::delete(&state.db, &monitor_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete monitor: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Monitor deleted successfully" })))
}

/// GET /api/v1/projects/:project_id/monitors/:monitor_id/checks
pub async fn list_checks(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, monitor_id)): Path<(String, String)>,
    Query(params): Query<ChecksParams>,
) -> AppResult<Json<Vec<MonitorCheck>>> {
    // Verify project exists and user has access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let monitor = MonitorRepository::find_by_id(&state.db, &monitor_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Monitor not found".to_string()))?;

    if monitor.project_id != project_id {
        return Err(AppError::NotFound("Monitor not found".to_string()));
    }

    let limit = params.limit.unwrap_or(100).min(500);
    let checks = MonitorCheckRepository::list_by_monitor(&state.db, &monitor_id, limit)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list checks: {}", e)))?;

    Ok(Json(checks))
}

#[derive(Debug, Deserialize)]
pub struct ChecksParams {
    pub limit: Option<u32>,
}
