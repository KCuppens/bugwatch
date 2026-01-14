use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    api::{PaginatedResponse, PaginationMeta, PaginationParams},
    auth::AuthUser,
    db::{
        models::{Monitor, MonitorCheck, MonitorIncident},
        repositories::{MonitorCheckRepository, MonitorIncidentRepository, MonitorRepository, ProjectRepository},
    },
    AppError, AppResult, AppState,
};

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

/// POST /api/v1/projects/:project_id/monitors
pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(request): Json<CreateMonitorRequest>,
) -> AppResult<Json<MonitorResponse>> {
    // Verify project exists and user owns it
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Validate URL
    if !request.url.starts_with("http://") && !request.url.starts_with("https://") {
        return Err(AppError::BadRequest("URL must start with http:// or https://".to_string()));
    }

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
    }))
}

/// GET /api/v1/projects/:project_id/monitors
pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Query(params): Query<PaginationParams>,
) -> AppResult<Json<PaginatedResponse<MonitorResponse>>> {
    // Verify project exists and user owns it
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
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
            _ => (None, None),
        };

        monitor_responses.push(MonitorResponse {
            monitor,
            uptime_24h: uptime,
            avg_response_24h: avg_response,
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
    auth_user: AuthUser,
    Path((project_id, monitor_id)): Path<(String, String)>,
) -> AppResult<Json<MonitorDetailResponse>> {
    // Verify project exists and user owns it
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
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
    auth_user: AuthUser,
    Path((project_id, monitor_id)): Path<(String, String)>,
    Json(request): Json<UpdateMonitorRequest>,
) -> AppResult<Json<MonitorResponse>> {
    // Verify project exists and user owns it
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let monitor = MonitorRepository::find_by_id(&state.db, &monitor_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Monitor not found".to_string()))?;

    if monitor.project_id != project_id {
        return Err(AppError::NotFound("Monitor not found".to_string()));
    }

    // Validate URL if provided
    if let Some(ref url) = request.url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(AppError::BadRequest("URL must start with http:// or https://".to_string()));
        }
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

    Ok(Json(MonitorResponse {
        monitor: updated,
        uptime_24h: None,
        avg_response_24h: None,
    }))
}

/// DELETE /api/v1/projects/:project_id/monitors/:monitor_id
pub async fn delete(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, monitor_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify project exists and user owns it
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
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
    auth_user: AuthUser,
    Path((project_id, monitor_id)): Path<(String, String)>,
    Query(params): Query<ChecksParams>,
) -> AppResult<Json<Vec<MonitorCheck>>> {
    // Verify project exists and user owns it
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
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
