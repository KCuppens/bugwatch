use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::{
    auth::middleware::AuthUser,
    db::repositories::{OrganizationRepository, ProjectRepository, ReplayRepository},
    AppError, AppResult, AppState,
};

use super::events::extract_api_key;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct IngestSegmentRequest {
    pub session_id: String,
    pub segment_index: i32,
    pub data: String, // base64 encoded compressed rrweb events
    pub started_at: Option<String>,
    pub user_agent: Option<String>,
    pub screen_width: Option<i32>,
    pub screen_height: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct FinishRecordingRequest {
    pub session_id: String,
    pub duration_ms: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ListRecordingsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    20
}

#[derive(Debug, Serialize)]
pub struct IngestSegmentResponse {
    pub status: String,
    pub recording_id: String,
}

#[derive(Debug, Serialize)]
pub struct SegmentData {
    pub segment_index: i32,
    pub data: String, // base64 encoded
    pub size_bytes: i32,
}

// ============================================================================
// SDK Ingestion Endpoints (API key auth)
// ============================================================================

/// POST /api/v1/replay/segments
///
/// SDK pushes compressed rrweb segments. Authenticated via API key.
pub async fn ingest_segment(
    State(state): State<AppState>,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    headers: HeaderMap,
    Json(req): Json<IngestSegmentRequest>,
) -> AppResult<(StatusCode, Json<IngestSegmentResponse>)> {
    // 1. Auth via API key
    let api_key = extract_api_key(&headers)?;
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    // 1a. Validate field lengths
    if req.session_id.len() > 128 {
        return Err(AppError::Validation(
            "session_id too long (max 128 bytes)".into(),
        ));
    }
    if req.user_agent.as_deref().map(|s| s.len()).unwrap_or(0) > 512 {
        return Err(AppError::Validation(
            "user_agent too long (max 512 bytes)".into(),
        ));
    }

    // B4: bound segment_index
    if req.segment_index < 0 {
        return Err(AppError::BadRequest(
            "segment_index must be non-negative".to_string(),
        ));
    }
    if req.segment_index > 10_000 {
        return Err(AppError::BadRequest(
            "segment_index too large (max 10000)".to_string(),
        ));
    }

    // 2. Check tier and storage limits
    if !state.config.deployment_mode.is_self_hosted() {
        let replay_org = OrganizationRepository::find_by_project_id(&state.db, &project.id)
            .await
            .unwrap_or(None);
        let tier_str = replay_org
            .as_ref()
            .map(|o| o.tier.clone())
            .unwrap_or_else(|| "free".to_string());
        if !crate::billing::tiers::can_access_feature(&tier_str, "session_replay")
            && !(state.config.x402_enabled && x402_verified.is_some())
        {
            let org_id = project.organization_id.as_deref().unwrap_or("");
            return Err(crate::payments::x402_feature_response(
                &state,
                "session_replay",
                "/api/v1/replay/segments",
                org_id,
                None,
                "Session replay requires a Team plan or higher.",
            )
            .await);
        }

        // Check per-project storage limit
        let tier = crate::billing::tiers::Tier::from_str(&tier_str);
        let limits = crate::billing::tiers::get_tier_limits(tier);
        if limits.replay_storage_bytes > 0 {
            let current_usage: (i64,) = sqlx::query_as(
                "SELECT COALESCE(SUM(total_size_bytes), 0) FROM session_recordings WHERE project_id = $1"
            )
            .bind(&project.id)
            .fetch_one(&state.db)
            .await
            .unwrap_or((0,));

            let x402_extra_storage = replay_org
                .as_ref()
                .map(|o| o.x402_extra_storage_bytes)
                .unwrap_or(0);
            let effective_storage = limits.replay_storage_bytes + x402_extra_storage;

            if current_usage.0 >= effective_storage {
                let org_id = match replay_org.as_ref().map(|o| o.id.clone()) {
                    Some(id) if !id.is_empty() => id,
                    _ => {
                        return Err(AppError::PaymentRequired(
                            "Resource limit reached. Upgrade your plan.".to_string(),
                        ))
                    }
                };
                let segment_quantity = 1_048_576i64; // 1MB default segment estimate
                let msg = "Replay storage limit exceeded. Upgrade your plan or pay to add storage."
                    .to_string();
                if state.config.x402_enabled && !state.config.deployment_mode.is_self_hosted() {
                    let nonce = uuid::Uuid::new_v4().to_string();
                    let challenge = crate::payments::challenge::build_capacity_challenge(
                        &state.config.x402_wallet_address,
                        &state.config.x402_usdc_address,
                        "/api/v1/replay/segments",
                        "storage_bytes",
                        segment_quantity,
                        &tier_str,
                        &nonce,
                    );
                    match state
                        .payment_store
                        .create_capacity_challenge(
                            &nonce,
                            &org_id,
                            None,
                            "/api/v1/replay/segments",
                            "storage_bytes",
                            segment_quantity,
                            crate::payments::challenge::PaymentPricing::for_capacity_grant(
                                "storage_bytes",
                                &tier_str,
                                segment_quantity,
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
    }

    // 3. Rate limit
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

    // 4. Decode base64 data
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&req.data)
        .map_err(|e| AppError::BadRequest(format!("Invalid base64 data: {}", e)))?;

    // 5. Check segment size limit (1MB)
    if decoded.len() > 1_048_576 {
        return Err(AppError::BadRequest(
            "Segment data exceeds 1MB limit".to_string(),
        ));
    }

    // 6. Find or create recording
    let recording = match ReplayRepository::find_by_session_id(
        &state.db,
        &project.id,
        &req.session_id,
    )
    .await?
    {
        Some(r) => {
            // B4: cap total segment count per recording
            if r.segment_count >= 10_000 {
                return Err(AppError::BadRequest(
                    "Recording has reached the maximum number of segments (10000)".to_string(),
                ));
            }
            r
        }
        None => {
            let started_at = req
                .started_at
                .as_ref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now);

            ReplayRepository::create_recording(
                &state.db,
                &project.id,
                &req.session_id,
                started_at,
                req.user_agent.as_deref(),
                req.screen_width,
                req.screen_height,
            )
            .await?
        }
    };

    // 7. Store segment
    let _segment =
        ReplayRepository::create_segment(&state.db, &recording.id, req.segment_index, &decoded)
            .await?;

    // 8. Update recording stats (atomic increment to avoid race conditions)
    sqlx::query("UPDATE session_recordings SET segment_count = segment_count + 1, total_size_bytes = total_size_bytes + $1 WHERE id = $2")
        .bind(decoded.len() as i64)
        .bind(&recording.id)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to update recording stats: {}", e)))?;

    info!(
        "Stored replay segment {} for session {} (recording {})",
        req.segment_index, req.session_id, recording.id
    );

    Ok((
        StatusCode::ACCEPTED,
        Json(IngestSegmentResponse {
            status: "accepted".to_string(),
            recording_id: recording.id,
        }),
    ))
}

/// POST /api/v1/replay/finish
///
/// SDK signals that a recording session is complete.
pub async fn finish_recording(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FinishRecordingRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let api_key = extract_api_key(&headers)?;
    crate::api::enforce_rate_limit(&state, &format!("replay_finish:apikey:{}", api_key), 60)?;

    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    let recording = ReplayRepository::find_by_session_id(&state.db, &project.id, &req.session_id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Recording not found for session {}",
                req.session_id
            ))
        })?;

    // B5: bound duration_ms
    if let Some(dur) = req.duration_ms {
        if dur < 0 {
            return Err(AppError::BadRequest(
                "duration_ms must be non-negative".to_string(),
            ));
        }
        if dur > 86_400_000 {
            return Err(AppError::BadRequest(
                "duration_ms too large (max 86400000 ms / 24h)".to_string(),
            ));
        }
    }

    ReplayRepository::finish_recording(&state.db, &recording.id, req.duration_ms).await?;

    info!(
        "Finished replay recording {} (session {})",
        recording.id, req.session_id
    );

    Ok(Json(serde_json::json!({
        "status": "completed",
        "recording_id": recording.id
    })))
}

// ============================================================================
// Dashboard Endpoints (user auth, tier gated)
// ============================================================================

/// GET /projects/:project_id/replay
///
/// List recent recordings for a project.
pub async fn list_recordings(
    State(state): State<AppState>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path(project_id): Path<String>,
    Query(params): Query<ListRecordingsQuery>,
) -> AppResult<Json<serde_json::Value>> {
    crate::api::enforce_rate_limit(&state, &format!("replay_list:user:{}", user.id), 30)?;

    // Tier gate
    {
        if !state.config.deployment_mode.is_self_hosted()
            && !(state.config.x402_enabled && x402_verified.is_some())
        {
            let org = OrganizationRepository::find_by_user(&state.db, &user.id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;
            if !crate::billing::tiers::can_access_feature(&org.tier, "session_replay") {
                return Err(crate::payments::x402_feature_response(
                    &state,
                    "session_replay",
                    &format!("/api/v1/projects/{}/replay", project_id),
                    &org.id,
                    None,
                    &format!(
                        "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                        "session_replay", org.tier
                    ),
                ).await);
            }
        }
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let limit = params.limit.min(100);
    let offset = params.offset.max(0).min(1_000_000);

    let recordings =
        ReplayRepository::list_recordings(&state.db, &project_id, limit, offset).await?;
    let total = ReplayRepository::count_recordings(&state.db, &project_id).await?;

    Ok(Json(serde_json::json!({
        "data": recordings,
        "total": total
    })))
}

/// GET /projects/:project_id/replay/:recording_id
///
/// Get recording metadata.
pub async fn get_recording(
    State(state): State<AppState>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path((project_id, recording_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    crate::api::enforce_rate_limit(&state, &format!("replay_get:user:{}", user.id), 60)?;

    {
        if !state.config.deployment_mode.is_self_hosted()
            && !(state.config.x402_enabled && x402_verified.is_some())
        {
            let org = OrganizationRepository::find_by_user(&state.db, &user.id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;
            if !crate::billing::tiers::can_access_feature(&org.tier, "session_replay") {
                return Err(crate::payments::x402_feature_response(
                    &state,
                    "session_replay",
                    &format!("/api/v1/projects/{}/replay", project_id),
                    &org.id,
                    None,
                    &format!(
                        "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                        "session_replay", org.tier
                    ),
                ).await);
            }
        }
    }

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let recording = ReplayRepository::find_recording(&state.db, &recording_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Recording not found".to_string()))?;

    // Verify it belongs to the project
    if recording.project_id != project_id {
        return Err(AppError::NotFound("Recording not found".to_string()));
    }

    Ok(Json(serde_json::json!({ "data": recording })))
}

/// GET /projects/:project_id/replay/:recording_id/segments
///
/// Get all segments for playback.
pub async fn get_segments(
    State(state): State<AppState>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path((project_id, recording_id)): Path<(String, String)>,
) -> AppResult<Json<Vec<SegmentData>>> {
    crate::api::enforce_rate_limit(&state, &format!("replay_segments:user:{}", user.id), 60)?;

    {
        if !state.config.deployment_mode.is_self_hosted()
            && !(state.config.x402_enabled && x402_verified.is_some())
        {
            let org = OrganizationRepository::find_by_user(&state.db, &user.id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;
            if !crate::billing::tiers::can_access_feature(&org.tier, "session_replay") {
                return Err(crate::payments::x402_feature_response(
                    &state,
                    "session_replay",
                    &format!("/api/v1/projects/{}/replay", project_id),
                    &org.id,
                    None,
                    &format!(
                        "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                        "session_replay", org.tier
                    ),
                ).await);
            }
        }
    }

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Verify recording belongs to project
    let recording = ReplayRepository::find_recording(&state.db, &recording_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Recording not found".to_string()))?;

    if recording.project_id != project_id {
        return Err(AppError::NotFound("Recording not found".to_string()));
    }

    let segments = ReplayRepository::list_segments(&state.db, &recording_id).await?;

    use base64::Engine;
    let segment_data: Vec<SegmentData> = segments
        .into_iter()
        .map(|s| SegmentData {
            segment_index: s.segment_index,
            data: base64::engine::general_purpose::STANDARD.encode(&s.data),
            size_bytes: s.size_bytes,
        })
        .collect();

    Ok(Json(segment_data))
}

/// GET /projects/:project_id/issues/:issue_id/replay
///
/// Get the recording linked to an issue's latest event.
pub async fn get_issue_replay(
    State(state): State<AppState>,
    user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    crate::api::enforce_rate_limit(&state, &format!("replay_issue:user:{}", user.id), 60)?;

    {
        if !state.config.deployment_mode.is_self_hosted()
            && !(state.config.x402_enabled && x402_verified.is_some())
        {
            let org = OrganizationRepository::find_by_user(&state.db, &user.id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .ok_or_else(|| AppError::Forbidden("No organization found".to_string()))?;
            if !crate::billing::tiers::can_access_feature(&org.tier, "session_replay") {
                return Err(crate::payments::x402_feature_response(
                    &state,
                    "session_replay",
                    &format!("/api/v1/projects/{}/replay", project_id),
                    &org.id,
                    None,
                    &format!(
                        "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                        "session_replay", org.tier
                    ),
                ).await);
            }
        }
    }

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let recording = ReplayRepository::find_by_event_issue(&state.db, &issue_id).await?;

    match recording {
        Some(r) if r.project_id == project_id => Ok(Json(serde_json::json!({ "data": r }))),
        _ => Ok(Json(serde_json::json!({ "data": null }))),
    }
}

#[cfg(test)]
mod tests {
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
            .body(Body::from(r#"{"name":"Replay Test Project"}"#))
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

    // ── SDK ingestion auth guards ─────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_segment_without_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/replay/segments")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"session_id":"sess1","segment_index":0,"data":"AAAA"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn finish_recording_without_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/replay/finish")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"session_id":"sess1"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── dashboard auth guards ─────────────────────────────────────────────────

    #[tokio::test]
    async fn list_recordings_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/replay")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn get_recording_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/replay/rec1")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn get_segments_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/replay/rec1/segments")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── SDK ingestion validation ──────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_segment_invalid_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/replay/segments")
            .header("content-type", "application/json")
            .header("x-api-key", "bad-key")
            .body(Body::from(
                r#"{"session_id":"sess1","segment_index":0,"data":"AAAA"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_segment_succeeds_with_valid_key() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "replay_seg@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        // base64-encoded minimal rrweb payload
        let b64_data = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            br#"[{"type":4,"data":{"href":"http://example.com","width":1280,"height":800},"timestamp":1000}]"#,
        );
        let body = format!(
            r#"{{"session_id":"test-session-1","segment_index":0,"data":"{}"}}"#,
            b64_data
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/replay/segments")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(body))
            .unwrap();
        let status = app.oneshot(req).await.unwrap().status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::ACCEPTED,
            "expected 2xx, got {}",
            status
        );
    }
}
