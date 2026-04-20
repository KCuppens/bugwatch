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
    db::repositories::{
        OrganizationRepository, ProjectRepository, ServerMetricsRepository, ServerRepository,
    },
    AppError, AppResult, AppState,
};

use super::events::extract_api_key;

/// Verify the authenticated user owns `project_id`. Returns Forbidden otherwise.
async fn require_project_owner(
    db: &crate::db::DbPool,
    user_id: &str,
    project_id: &str,
) -> AppResult<crate::db::models::Project> {
    let project = ProjectRepository::find_by_id(db, project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;
    if project.owner_id != user_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }
    Ok(project)
}

// ============================================================================
// Ingestion Payload Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ServerMetricsPayload {
    pub server_id: String,
    pub hostname: String,
    pub os: Option<String>,
    pub kernel: Option<String>,
    pub cpu: Option<CpuMetrics>,
    pub memory: Option<MemoryMetrics>,
    pub swap: Option<SwapMetrics>,
    pub network: Option<NetworkMetrics>,
    pub load: Option<LoadMetrics>,
    pub uptime_seconds: Option<i64>,
    pub disks: Option<Vec<DiskInfo>>,
    pub processes: Option<Vec<ProcessInfo>>,
    pub docker: Option<Vec<DockerContainer>>,
}

#[derive(Debug, Deserialize)]
pub struct CpuMetrics {
    pub usage_percent: f64,
}

#[derive(Debug, Deserialize)]
pub struct MemoryMetrics {
    pub total_bytes: i64,
    pub used_bytes: i64,
    pub available_bytes: i64,
    pub usage_percent: f64,
}

#[derive(Debug, Deserialize)]
pub struct SwapMetrics {
    pub total_bytes: i64,
    pub used_bytes: i64,
}

#[derive(Debug, Deserialize)]
pub struct NetworkMetrics {
    pub rx_bytes_per_sec: i64,
    pub tx_bytes_per_sec: i64,
}

#[derive(Debug, Deserialize)]
pub struct LoadMetrics {
    pub avg_1: f64,
    pub avg_5: f64,
    pub avg_15: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DiskInfo {
    pub mount: String,
    pub filesystem: Option<String>,
    pub total_bytes: i64,
    pub used_bytes: i64,
    pub available_bytes: i64,
    pub usage_percent: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub user: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DockerContainer {
    pub name: String,
    pub id: String,
    pub status: String,
    pub cpu_percent: Option<f64>,
    pub mem_usage: Option<String>,
    pub mem_percent: Option<f64>,
}

// ============================================================================
// Ingestion Response
// ============================================================================

#[derive(Debug, Serialize)]
pub struct MetricsIngestResponse {
    pub status: String,
    pub server_db_id: String,
}

// ============================================================================
// POST /api/v1/metrics — Agent pushes metrics
// ============================================================================

pub async fn ingest_metrics(
    State(state): State<AppState>,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    headers: HeaderMap,
    Json(payload): Json<ServerMetricsPayload>,
) -> AppResult<(StatusCode, Json<MetricsIngestResponse>)> {
    // 1. Extract API key
    let api_key = extract_api_key(&headers)?;

    // 2. Look up project
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    // 3. Check tier — server monitoring is Pro+ only (bypassed in self-hosted mode or valid x402 payment)
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let tier_str = OrganizationRepository::get_project_tier(&state.db, &project.id)
            .await
            .unwrap_or_else(|_| "free".to_string());
        if !can_access_feature(&tier_str, "server_monitoring") {
            let org_id = project.organization_id.as_deref().unwrap_or("");
            let resource = "/api/v1/metrics";
            return Err(crate::payments::x402_feature_response(
                &state,
                "server_monitoring",
                &resource,
                org_id,
                None,
                "Server monitoring requires a Pro plan or higher. Upgrade to access this feature.",
            )
            .await);
        }
    }

    // 4. Rate limit
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

    // 5. Upsert server record
    let server = ServerRepository::upsert(
        &state.db,
        &project.id,
        &payload.server_id,
        &payload.hostname,
        payload.os.as_deref(),
        payload.kernel.as_deref(),
    )
    .await?;

    // 6. Serialize JSON columns
    let disks_json = payload
        .disks
        .as_ref()
        .map(|d| serde_json::to_string(d).unwrap_or_default());
    let processes_json = payload
        .processes
        .as_ref()
        .map(|p| serde_json::to_string(p).unwrap_or_default());
    let docker_json = payload
        .docker
        .as_ref()
        .map(|d| serde_json::to_string(d).unwrap_or_default());

    // 7. Insert metrics
    let metric = ServerMetricsRepository::create(
        &state.db,
        &server.id,
        payload.cpu.as_ref().map(|c| c.usage_percent),
        payload.load.as_ref().map(|l| l.avg_1),
        payload.load.as_ref().map(|l| l.avg_5),
        payload.load.as_ref().map(|l| l.avg_15),
        payload.memory.as_ref().map(|m| m.total_bytes),
        payload.memory.as_ref().map(|m| m.used_bytes),
        payload.memory.as_ref().map(|m| m.available_bytes),
        payload.memory.as_ref().map(|m| m.usage_percent),
        payload.swap.as_ref().map(|s| s.total_bytes),
        payload.swap.as_ref().map(|s| s.used_bytes),
        payload.network.as_ref().map(|n| n.rx_bytes_per_sec),
        payload.network.as_ref().map(|n| n.tx_bytes_per_sec),
        payload.uptime_seconds,
        disks_json.as_deref(),
        processes_json.as_deref(),
        docker_json.as_deref(),
    )
    .await?;

    // 8. Async alert evaluation
    let alerting = state.alerting_service.clone();
    let project_id = project.id.clone();
    let server_id_clone = server.id.clone();
    let metric_clone = metric.clone();
    tokio::spawn(async move {
        if let Err(e) = alerting
            .on_metrics_threshold(&project_id, &server_id_clone, &metric_clone)
            .await
        {
            tracing::error!("Failed to evaluate server metric alerts: {}", e);
        }
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(MetricsIngestResponse {
            status: "accepted".to_string(),
            server_db_id: server.id,
        }),
    ))
}

// ============================================================================
// Dashboard Read Endpoints
// ============================================================================

/// GET /projects/:project_id/servers — List servers
pub async fn list_servers(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    require_project_owner(&state.db, &auth_user.id, &project_id).await?;
    let servers = ServerRepository::list_by_project(&state.db, &project_id).await?;

    Ok(Json(serde_json::json!({ "data": servers })))
}

/// GET /projects/:project_id/servers/status — Agent status check
pub async fn servers_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    require_project_owner(&state.db, &auth_user.id, &project_id).await?;

    let has_agent = ServerRepository::has_servers(&state.db, &project_id).await?;
    let server_count = if has_agent {
        ServerRepository::count_by_project(&state.db, &project_id).await? as u32
    } else {
        0
    };

    Ok(Json(serde_json::json!({
        "has_agent": has_agent,
        "server_count": server_count
    })))
}

#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    #[serde(default = "default_period")]
    pub period: String,
}

fn default_period() -> String {
    "1h".to_string()
}

/// GET /projects/:project_id/servers/:server_id/metrics?period=1h|6h|24h|7d
pub async fn get_server_metrics(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, server_id)): Path<(String, String)>,
    Query(params): Query<MetricsQuery>,
) -> AppResult<Json<serde_json::Value>> {
    require_project_owner(&state.db, &auth_user.id, &project_id).await?;

    // server_id here is the DB id of the server
    let server = ServerRepository::find_by_id(&state.db, &server_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Server not found".to_string()))?;

    if server.project_id != project_id {
        return Err(AppError::Forbidden(
            "Server does not belong to this project".to_string(),
        ));
    }

    let duration = match params.period.as_str() {
        "1h" => Duration::hours(1),
        "6h" => Duration::hours(6),
        "24h" => Duration::hours(24),
        "7d" => Duration::days(7),
        _ => Duration::hours(1),
    };

    let now = Utc::now();
    let from = now - duration;

    let metrics = ServerMetricsRepository::get_range(&state.db, &server.id, from, now).await?;

    // Serialize metrics with parsed JSON columns
    let data: Vec<serde_json::Value> = metrics
        .iter()
        .map(|m| {
            let disks: serde_json::Value = m
                .disks_json
                .as_deref()
                .and_then(|d| serde_json::from_str(d).ok())
                .unwrap_or(serde_json::Value::Null);
            let processes: serde_json::Value = m
                .processes_json
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok())
                .unwrap_or(serde_json::Value::Null);
            let docker: serde_json::Value = m
                .docker_json
                .as_deref()
                .and_then(|d| serde_json::from_str(d).ok())
                .unwrap_or(serde_json::Value::Null);

            serde_json::json!({
                "id": m.id,
                "recorded_at": m.recorded_at,
                "cpu_usage_percent": m.cpu_usage_percent,
                "load_avg_1": m.load_avg_1,
                "load_avg_5": m.load_avg_5,
                "load_avg_15": m.load_avg_15,
                "mem_total_bytes": m.mem_total_bytes,
                "mem_used_bytes": m.mem_used_bytes,
                "mem_available_bytes": m.mem_available_bytes,
                "mem_usage_percent": m.mem_usage_percent,
                "swap_total_bytes": m.swap_total_bytes,
                "swap_used_bytes": m.swap_used_bytes,
                "net_rx_bytes_per_sec": m.net_rx_bytes_per_sec,
                "net_tx_bytes_per_sec": m.net_tx_bytes_per_sec,
                "uptime_seconds": m.uptime_seconds,
                "disks": disks,
                "processes": processes,
                "docker": docker,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "data": data })))
}

/// GET /projects/:project_id/servers/:server_id/metrics/latest
pub async fn get_latest_metrics(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, server_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    require_project_owner(&state.db, &auth_user.id, &project_id).await?;

    let server = ServerRepository::find_by_id(&state.db, &server_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Server not found".to_string()))?;

    if server.project_id != project_id {
        return Err(AppError::Forbidden(
            "Server does not belong to this project".to_string(),
        ));
    }

    let metric = ServerMetricsRepository::get_latest(&state.db, &server.id).await?;

    match metric {
        Some(m) => {
            let disks: serde_json::Value = m
                .disks_json
                .as_deref()
                .and_then(|d| serde_json::from_str(d).ok())
                .unwrap_or(serde_json::Value::Null);
            let processes: serde_json::Value = m
                .processes_json
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok())
                .unwrap_or(serde_json::Value::Null);
            let docker: serde_json::Value = m
                .docker_json
                .as_deref()
                .and_then(|d| serde_json::from_str(d).ok())
                .unwrap_or(serde_json::Value::Null);

            Ok(Json(serde_json::json!({
                "data": {
                    "id": m.id,
                    "recorded_at": m.recorded_at,
                    "cpu_usage_percent": m.cpu_usage_percent,
                    "load_avg_1": m.load_avg_1,
                    "load_avg_5": m.load_avg_5,
                    "load_avg_15": m.load_avg_15,
                    "mem_total_bytes": m.mem_total_bytes,
                    "mem_used_bytes": m.mem_used_bytes,
                    "mem_available_bytes": m.mem_available_bytes,
                    "mem_usage_percent": m.mem_usage_percent,
                    "swap_total_bytes": m.swap_total_bytes,
                    "swap_used_bytes": m.swap_used_bytes,
                    "net_rx_bytes_per_sec": m.net_rx_bytes_per_sec,
                    "net_tx_bytes_per_sec": m.net_tx_bytes_per_sec,
                    "uptime_seconds": m.uptime_seconds,
                    "disks": disks,
                    "processes": processes,
                    "docker": docker,
                },
                "server": server
            })))
        }
        None => Ok(Json(serde_json::json!({
            "data": null,
            "server": server
        }))),
    }
}
