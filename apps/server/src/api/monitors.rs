use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{
    api::{PaginatedResponse, PaginationMeta, PaginationParams},
    auth::{AuthIdentity, EitherAuth},
    billing::tiers::{get_tier_limits, Tier},
    db::{
        models::{Monitor, MonitorCheck, MonitorIncident},
        repositories::{
            MonitorCheckRepository, MonitorIncidentRepository, MonitorRepository,
            OrganizationRepository, ProjectRepository,
        },
    },
    AppError, AppResult, AppState,
};

use crate::utils::validate_monitor_url;

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
        AuthIdentity::User(user) => {
            ProjectRepository::find_by_owner(&state.db, &user.id, 100, 0).await?
        }
        AuthIdentity::Agent(agent) => {
            ProjectRepository::find_by_organization(&state.db, &agent.organization_id, 100, 0)
                .await?
        }
    };

    if projects.is_empty() {
        return Ok(Json(MonitorsAcrossProjectsResponse {
            data: vec![],
            summary: MonitorsSummary {
                total: 0,
                up: 0,
                down: 0,
            },
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
        summary: MonitorsSummary {
            total,
            up: up_count,
            down: down_count,
        },
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
    let monitor_org = OrganizationRepository::find_by_project_id(&state.db, &project_id)
        .await
        .unwrap_or(None);
    let tier_str = monitor_org
        .as_ref()
        .map(|o| o.tier.clone())
        .unwrap_or_else(|| "free".to_string());
    let tier = Tier::from_str(&tier_str);
    let limits = get_tier_limits(tier);
    if limits.monitor_limit >= 0 {
        let owner_id = match &*auth {
            AuthIdentity::User(user) => user.id.clone(),
            AuthIdentity::Agent(_) => project.owner_id.clone(),
        };
        let current_count = MonitorRepository::count_by_owner(&state.db, &owner_id)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to count monitors: {}", e)))?;
        let x402_extra_monitors = monitor_org
            .as_ref()
            .map(|o| o.x402_extra_monitors as i64)
            .unwrap_or(0);
        let effective_limit = limits.monitor_limit as i64 + x402_extra_monitors;
        if current_count >= effective_limit {
            let msg = format!(
                "Monitor limit reached ({}/{}). Upgrade your plan or pay to add a monitor slot.",
                current_count, effective_limit
            );
            let org_id = match monitor_org.as_ref().map(|o| o.id.clone()) {
                Some(id) if !id.is_empty() => id,
                _ => {
                    return Err(AppError::PaymentRequired(
                        "Resource limit reached. Upgrade your plan.".to_string(),
                    ))
                }
            };
            let resource = format!("/api/v1/projects/{}/monitors", project_id);
            if state.config.x402_enabled && !state.config.deployment_mode.is_self_hosted() {
                let nonce = uuid::Uuid::new_v4().to_string();
                let challenge = crate::payments::challenge::build_capacity_challenge(
                    &state.config.x402_wallet_address,
                    &state.config.x402_usdc_address,
                    &resource,
                    "monitor",
                    1,
                    &tier_str,
                    &nonce,
                );
                match state
                    .payment_store
                    .create_capacity_challenge(
                        &nonce,
                        &org_id,
                        None,
                        &resource,
                        "monitor",
                        1,
                        crate::payments::challenge::PaymentPricing::for_capacity_grant(
                            "monitor", &tier_str, 1,
                        ) as i64,
                        300,
                    )
                    .await
                {
                    Ok(_) => {
                        return Err(AppError::PaymentRequiredWithChallenge {
                            message: msg,
                            challenge: serde_json::json!(challenge),
                        })
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to persist x402 challenge for nonce {}: {}",
                            nonce,
                            e
                        );
                        return Err(AppError::PaymentRequired(msg));
                    }
                }
            }
            return Err(AppError::PaymentRequired(msg));
        }
    }

    // Input length validation
    if request.name.len() > 200 {
        return Err(AppError::BadRequest(
            "Monitor name too long (max 200 characters)".to_string(),
        ));
    }
    if request.url.len() > 2048 {
        return Err(AppError::BadRequest(
            "Monitor URL too long (max 2048 characters)".to_string(),
        ));
    }

    // Validate URL (scheme + SSRF protection)
    validate_monitor_url(&request.url)?;

    // Validate interval (minimum 30 seconds)
    if request.interval_seconds < 30 {
        return Err(AppError::BadRequest(
            "Interval must be at least 30 seconds".to_string(),
        ));
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

    let (monitors, total) =
        MonitorRepository::list_by_project(&state.db, &project_id, params.page, params.per_page)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to list monitors: {}", e)))?;

    // Batch-fetch stats and last errors (single query each instead of N+1)
    let monitor_ids: Vec<String> = monitors.iter().map(|m| m.id.clone()).collect();
    let down_ids: Vec<String> = monitors
        .iter()
        .filter(|m| m.current_status == "down")
        .map(|m| m.id.clone())
        .collect();

    let (batch_stats, batch_errors) = tokio::join!(
        MonitorCheckRepository::batch_uptime_stats(&state.db, &monitor_ids, 24),
        MonitorCheckRepository::batch_last_errors(&state.db, &down_ids),
    );
    let batch_stats = batch_stats.unwrap_or_default();
    let batch_errors = batch_errors.unwrap_or_default();

    let mut monitor_responses = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let (uptime, avg_response) = match batch_stats.get(&monitor.id) {
            Some(&(total, up, avg)) if total > 0 => (Some((up as f64 / total as f64) * 100.0), avg),
            _ => (None, None),
        };
        let last_error = batch_errors.get(&monitor.id).cloned();
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
            return Err(AppError::BadRequest(
                "Monitor name too long (max 200 characters)".to_string(),
            ));
        }
    }
    if let Some(ref url) = request.url {
        if url.len() > 2048 {
            return Err(AppError::BadRequest(
                "Monitor URL too long (max 2048 characters)".to_string(),
            ));
        }
    }

    // Validate URL if provided (scheme + SSRF protection)
    if let Some(ref url) = request.url {
        validate_monitor_url(url)?;
    }

    // Validate interval if provided
    if let Some(interval) = request.interval_seconds {
        if interval < 30 {
            return Err(AppError::BadRequest(
                "Interval must be at least 30 seconds".to_string(),
            ));
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

    Ok(Json(
        serde_json::json!({ "message": "Monitor deleted successfully" }),
    ))
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
