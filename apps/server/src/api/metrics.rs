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

    // 3. Rate limit — checked before the expensive tier/org DB lookup (E4)
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

    // 4. Check tier — server monitoring is Pro+ only (bypassed in self-hosted mode or valid x402 payment)
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

    // 5. Validate field lengths (B3)
    if payload.server_id.len() > 128 {
        return Err(AppError::BadRequest(
            "server_id too long (max 128 bytes)".to_string(),
        ));
    }
    if payload.hostname.len() > 253 {
        return Err(AppError::BadRequest(
            "hostname too long (max 253 bytes)".to_string(),
        ));
    }
    if payload.os.as_deref().map(|s| s.len()).unwrap_or(0) > 128 {
        return Err(AppError::BadRequest(
            "os too long (max 128 bytes)".to_string(),
        ));
    }
    if payload.kernel.as_deref().map(|s| s.len()).unwrap_or(0) > 128 {
        return Err(AppError::BadRequest(
            "kernel too long (max 128 bytes)".to_string(),
        ));
    }

    // B6: cap Vec counts
    if payload.disks.as_ref().map(|v| v.len()).unwrap_or(0) > 100 {
        return Err(AppError::BadRequest("Too many disks (max 100)".to_string()));
    }
    if payload.processes.as_ref().map(|v| v.len()).unwrap_or(0) > 500 {
        return Err(AppError::BadRequest(
            "Too many processes (max 500)".to_string(),
        ));
    }
    if payload.docker.as_ref().map(|v| v.len()).unwrap_or(0) > 200 {
        return Err(AppError::BadRequest(
            "Too many docker containers (max 200)".to_string(),
        ));
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

    // 8. Async alert evaluation (bounded by a timeout to prevent runaway tasks)
    let alerting = state.alerting_service.clone();
    let project_id = project.id.clone();
    let server_id_clone = server.id.clone();
    let metric_clone = metric.clone();
    tokio::spawn(async move {
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            alerting.on_metrics_threshold(&project_id, &server_id_clone, &metric_clone),
        )
        .await
        {
            Ok(Err(e)) => {
                tracing::error!("Failed to evaluate server metric alerts: {}", e);
            }
            Err(_elapsed) => {
                tracing::error!("Server metric alert evaluation timed out after 30s");
            }
            Ok(Ok(())) => {}
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
    crate::api::enforce_rate_limit(&state, &format!("servers_list:user:{}", auth_user.id), 30)?;
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
    crate::api::enforce_rate_limit(&state, &format!("servers_status:user:{}", auth_user.id), 60)?;
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
    crate::api::enforce_rate_limit(&state, &format!("server_metrics:user:{}", auth_user.id), 60)?;
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
        _ => return Err(AppError::BadRequest("Invalid period".to_string())),
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
    crate::api::enforce_rate_limit(
        &state,
        &format!("server_metrics_latest:user:{}", auth_user.id),
        60,
    )?;
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

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
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
            .body(Body::from(r#"{"name":"Metrics Test Project"}"#))
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

    // ── ingest_metrics auth guards ────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_metrics_without_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/metrics")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"server_id":"srv1","hostname":"host1"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_metrics_invalid_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/metrics")
            .header("content-type", "application/json")
            .header("x-api-key", "bad-key")
            .body(Body::from(r#"{"server_id":"srv1","hostname":"host1"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── dashboard endpoints auth guards ───────────────────────────────────────

    #[tokio::test]
    async fn list_servers_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/servers")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn servers_status_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/servers/status")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn get_server_metrics_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/servers/srv1/metrics")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn get_latest_metrics_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/servers/srv1/metrics/latest")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── ingest_metrics success ─────────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_metrics_succeeds_with_valid_key() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "metrics_ingest@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/metrics")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(r#"{"server_id":"srv1","hostname":"web-01"}"#))
            .unwrap();
        let status = app.oneshot(req).await.unwrap().status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::ACCEPTED
                || status == StatusCode::CREATED,
            "expected 2xx, got {}",
            status
        );
    }

    // ── list_servers with auth ─────────────────────────────────────────────────

    #[tokio::test]
    async fn list_servers_returns_200_when_authenticated() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "metrics_list@example.com").await;
        let (project_id, _) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/servers", project_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }
}
