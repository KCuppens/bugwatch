use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    db::repositories::{EventRepository, IssueRepository, ProjectRepository, ReplayRepository},
    processing::fingerprint::{generate_fingerprint, generate_title},
    AppError, AppResult, AppState,
};

fn default_environment() -> String {
    "production".to_string()
}

/// Error event payload from SDK
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ErrorEvent {
    /// Unique event ID (UUID)
    pub event_id: String,

    /// ISO 8601 timestamp
    pub timestamp: String,

    /// Log level
    pub level: EventLevel,

    /// Error message (optional - exceptions may not have a separate message)
    #[serde(default)]
    pub message: Option<String>,

    /// Exception details
    pub exception: Option<ExceptionInfo>,

    /// Environment (production, staging, development)
    #[serde(default = "default_environment")]
    pub environment: String,

    /// Release version
    pub release: Option<String>,

    /// Server hostname
    pub server_name: Option<String>,

    /// Request context
    pub request: Option<RequestContext>,

    /// User context
    pub user: Option<UserContext>,

    /// Custom tags (indexed)
    pub tags: Option<std::collections::HashMap<String, String>>,

    /// Extra context (not indexed)
    pub extra: Option<serde_json::Value>,

    /// Breadcrumbs
    pub breadcrumbs: Option<Vec<Breadcrumb>>,

    /// SDK metadata
    #[serde(default)]
    pub sdk: Option<SdkInfo>,

    /// Platform
    #[serde(default)]
    pub platform: String,

    /// Runtime info
    pub runtime: Option<RuntimeInfo>,

    /// Session ID for linking to session replay
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EventLevel {
    Fatal,
    Error,
    Warning,
    Info,
    Debug,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExceptionInfo {
    #[serde(rename = "type")]
    pub exception_type: String,
    pub value: String,
    pub stacktrace: Vec<StackFrame>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StackFrame {
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub function: String,
    #[serde(default)]
    pub lineno: u32,
    #[serde(default)]
    pub colno: u32,
    pub abs_path: Option<String>,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    pub in_app: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RequestContext {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub method: String,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub query_string: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UserContext {
    pub id: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub ip_address: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Breadcrumb {
    #[serde(default)]
    pub timestamp: String,
    #[serde(rename = "type", default)]
    pub breadcrumb_type: String,
    #[serde(default)]
    pub category: String,
    pub message: Option<String>,
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub level: Option<EventLevel>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SdkInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Serialize)]
pub struct IngestResponse {
    pub id: String,
    pub status: String,
}

/// POST /api/v1/events
///
/// Ingest error events from SDKs.
/// Requires API key authentication via Bearer token.
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut event): Json<ErrorEvent>,
) -> AppResult<(StatusCode, Json<IngestResponse>)> {
    tracing::debug!("Event ingest request received");

    // 1. Extract API key from Authorization header
    let api_key = extract_api_key(&headers)?;

    // 2. Validate API key and get project
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    // 3. Check rate limit (tier is looked up from organization)
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
        tracing::warn!(
            "Rate limit exceeded for project {}: {} remaining, retry in {:?}s",
            project.id,
            rate_limit_result.remaining,
            rate_limit_result.retry_after_secs
        );
        return Err(AppError::RateLimitExceeded {
            retry_after_secs: rate_limit_result.retry_after_secs.unwrap_or(60),
            limit: rate_limit_result.limit,
            remaining: rate_limit_result.remaining,
        });
    }

    tracing::debug!(
        "Processing event {} for project {} ({})",
        event.event_id,
        project.name,
        project.id
    );

    // Validate tags to prevent abuse: cap count and key/value lengths.
    if let Some(ref tags) = event.tags {
        if tags.len() > 64 {
            return Err(AppError::Validation("Too many tags (max 64)".to_string()));
        }
        for (k, v) in tags {
            if k.len() > 256 || v.len() > 256 {
                return Err(AppError::Validation(
                    "Tag key/value too long (max 256 characters each)".to_string(),
                ));
            }
            // Reject control characters (except tab/newline) and null bytes in tag values.
            if v.as_bytes()
                .iter()
                .any(|&b| b == 0 || (b < 0x20 && b != b'\t' && b != b'\n'))
            {
                return Err(AppError::Validation(
                    "Tag values cannot contain null bytes or control characters".to_string(),
                ));
            }
        }
    }

    // Validate exception and event field bounds to prevent storage exhaustion.
    if let Some(ref exc) = event.exception {
        if exc.stacktrace.len() > 200 {
            return Err(AppError::Validation(
                "Too many stack frames (max 200)".to_string(),
            ));
        }
        if exc.exception_type.len() > 256 {
            return Err(AppError::Validation(
                "exception type too long (max 256 bytes)".to_string(),
            ));
        }
        if exc.value.len() > 8192 {
            return Err(AppError::Validation(
                "exception value too long (max 8192 bytes)".to_string(),
            ));
        }
        for frame in &exc.stacktrace {
            if frame.filename.len() > 512 || frame.function.len() > 512 {
                return Err(AppError::Validation(
                    "Stack frame filename/function too long (max 512 bytes)".to_string(),
                ));
            }
            if frame.abs_path.as_deref().map(|s| s.len()).unwrap_or(0) > 1024 {
                return Err(AppError::Validation(
                    "Stack frame abs_path too long (max 1024 bytes)".to_string(),
                ));
            }
            if frame.context_line.as_deref().map(|s| s.len()).unwrap_or(0) > 1024 {
                return Err(AppError::Validation(
                    "Stack frame context_line too long (max 1024 bytes)".to_string(),
                ));
            }
        }
    }
    if let Some(ref breadcrumbs) = event.breadcrumbs {
        if breadcrumbs.len() > 100 {
            return Err(AppError::Validation(
                "Too many breadcrumbs (max 100)".to_string(),
            ));
        }
    }
    if let Some(ref msg) = event.message {
        if msg.len() > 8192 {
            return Err(AppError::Validation(
                "Message too long (max 8192 bytes)".to_string(),
            ));
        }
    }
    if event.environment.len() > 64 {
        return Err(AppError::Validation(
            "environment too long (max 64 characters)".to_string(),
        ));
    }
    if let Some(ref release) = event.release {
        if release.len() > 200 {
            return Err(AppError::Validation(
                "release too long (max 200 characters)".to_string(),
            ));
        }
    }
    if event.platform.len() > 64 {
        return Err(AppError::Validation(
            "platform too long (max 64 characters)".to_string(),
        ));
    }
    // Validate the unstructured `extra` blob to prevent storage exhaustion.
    if let Some(ref extra) = event.extra {
        let extra_size = serde_json::to_string(extra).map(|s| s.len()).unwrap_or(0);
        if extra_size > 65_536 {
            return Err(AppError::Validation(
                "extra field too large (max 64 KB)".to_string(),
            ));
        }
    }

    // Validate user context field lengths.
    if let Some(ref u) = event.user {
        if u.id.as_deref().map(|s| s.len()).unwrap_or(0) > 256
            || u.email.as_deref().map(|s| s.len()).unwrap_or(0) > 256
            || u.username.as_deref().map(|s| s.len()).unwrap_or(0) > 256
            || u.ip_address.as_deref().map(|s| s.len()).unwrap_or(0) > 64
        {
            return Err(AppError::Validation(
                "user context fields too long".to_string(),
            ));
        }
    }

    // 4b. Deduplicate client-side error boundary events when onRequestError
    //     already captured the same server error with full details.
    //     Client error boundaries tag events with "next.digest" — if we already
    //     have a recent event from "nextjs.onRequestError" with the same digest,
    //     the client-side capture is redundant (it only has a generic message).
    if let Some(ref tags) = event.tags {
        let mechanism = tags.get("mechanism").map(|s| s.as_str());
        let is_error_boundary = matches!(
            mechanism,
            Some("app-router-error-boundary" | "global-error-boundary" | "custom-error-boundary")
        );
        if is_error_boundary {
            if let Some(digest) = tags.get("next.digest") {
                let has_server_event =
                    EventRepository::has_recent_event_with_digest(&state.db, &project.id, digest)
                        .await
                        .unwrap_or(false);

                if has_server_event {
                    tracing::debug!(
                        "Dropping duplicate client error boundary event {} (digest {} already captured server-side)",
                        event.event_id, digest
                    );
                    return Ok((
                        StatusCode::ACCEPTED,
                        Json(IngestResponse {
                            id: event.event_id,
                            status: "deduplicated".to_string(),
                        }),
                    ));
                }
            }
        }
    }

    // 5. Unminify React production errors in exception value (server-side)
    if let Some(ref mut exc) = event.exception {
        let unminified = crate::processing::fingerprint::unminify_react_error(&exc.value);
        if unminified != exc.value {
            tracing::debug!(
                "Unminified React error: {} -> {}",
                exc.value.chars().take(60).collect::<String>(),
                unminified.chars().take(60).collect::<String>()
            );
            exc.value = unminified;
        }
    }

    // 6. Generate fingerprint and title
    let (fingerprint, title) = if let Some(ref exc) = event.exception {
        let fp = generate_fingerprint(exc);
        let t = generate_title(exc);
        tracing::debug!(
            "Fingerprint for {}: {} (type={}, in_app_frames={}, msg_prefix={})",
            event.event_id,
            fp,
            exc.exception_type,
            exc.stacktrace.iter().filter(|f| f.in_app).count(),
            exc.value.chars().take(80).collect::<String>()
        );
        (fp, t)
    } else {
        // For events without exception, use message as fingerprint base
        let msg = event.message.as_deref().unwrap_or("(no message)");
        let fp = sha256_fingerprint(msg);
        (fp, msg.to_string())
    };

    // 7. Get level as string
    let level = match event.level {
        EventLevel::Fatal => "fatal",
        EventLevel::Error => "error",
        EventLevel::Warning => "warning",
        EventLevel::Info => "info",
        EventLevel::Debug => "debug",
    };

    // 8. Find or create issue
    let (issue, is_new) = IssueRepository::find_or_create(
        &state.db,
        &project.id,
        &fingerprint,
        &title,
        level,
        &event.environment,
    )
    .await?;

    if is_new {
        tracing::debug!("Created new issue {} for project {}", issue.id, project.id);
    }

    // 9. Strip sensitive headers before storing (Authorization, Cookie, X-API-Key must never
    //    be persisted — they would be readable to anyone with DB read access).
    if let Some(ref mut request) = event.request {
        if let Some(ref mut hdrs) = request.headers {
            const SENSITIVE: &[&str] = &["authorization", "cookie", "x-api-key"];
            hdrs.retain(|k, _| !SENSITIVE.contains(&k.to_lowercase().as_str()));
        }
    }

    // Store event
    let payload = serde_json::to_string(&event)
        .map_err(|e| AppError::Internal(format!("Failed to serialize event: {}", e)))?;

    // Parse timestamp string to DateTime<Utc>; reject unparseable values so events
    // are not silently recorded at server time (which corrupts frequency charts).
    let timestamp = chrono::DateTime::parse_from_rfc3339(&event.timestamp)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|_| AppError::Validation("timestamp must be a valid RFC3339 timestamp".into()))?;

    let inserted =
        EventRepository::create(&state.db, &issue.id, &event.event_id, timestamp, &payload).await?;

    // Duplicate event_id (race condition or retry) — return idempotent success
    if inserted.is_none() {
        return Ok((
            StatusCode::ACCEPTED,
            Json(IngestResponse {
                id: event.event_id,
                status: "duplicate".to_string(),
            }),
        ));
    }

    let created_event = inserted.expect("None was handled by the early return above");

    // Link event to session recording if session_id is present
    let session_id_value = event.session_id.as_deref().or_else(|| {
        event
            .tags
            .as_ref()
            .and_then(|t| t.get("session_id").map(|s| s.as_str()))
    });
    if let Some(session_id) = session_id_value {
        if let Ok(Some(recording)) =
            ReplayRepository::find_by_session_id(&state.db, &project.id, session_id).await
        {
            if let Err(e) = sqlx::query("UPDATE events SET session_recording_id = $1 WHERE id = $2")
                .bind(&recording.id)
                .bind(&created_event.id)
                .execute(&state.db)
                .await
            {
                tracing::warn!(
                    event_id = %created_event.id,
                    recording_id = %recording.id,
                    "Failed to link session recording to event: {}",
                    e
                );
            }
        }
    }

    // 10. Evaluate alert rules (async, non-blocking, with backpressure)
    if is_new {
        tracing::debug!(
            "New issue created - triggering alert evaluation for issue {}",
            issue.id
        );
        let alerting = state.alerting_service.clone();
        let project_id = project.id.clone();
        let issue_clone = issue.clone();
        let semaphore = state.alert_semaphore.clone();

        match semaphore.try_acquire_owned() {
            Ok(permit) => {
                tokio::spawn(async move {
                    let _permit = permit;
                    if let Err(e) = alerting.on_new_issue(&project_id, &issue_clone).await {
                        tracing::error!("Failed to trigger new issue alert: {}", e);
                    }
                });
            }
            Err(_) => {
                tracing::warn!(
                    issue_id = %issue.id,
                    project_id = %project.id,
                    "Alert semaphore full — scheduling delayed retry in 5s"
                );
                // Retry once after 5s rather than silently dropping the trigger.
                let alerting_retry = state.alerting_service.clone();
                let project_id_retry = project.id.clone();
                let issue_retry = issue.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    if let Err(e) = alerting_retry
                        .on_new_issue(&project_id_retry, &issue_retry)
                        .await
                    {
                        tracing::error!(
                            issue_id = %issue_retry.id,
                            "Alert retry after semaphore backpressure failed: {}", e
                        );
                    }
                });
            }
        }
    } else {
        tracing::debug!(
            "Issue {} already exists (fingerprint match) - no alert triggered",
            issue.id
        );
    }

    Ok((
        StatusCode::ACCEPTED,
        Json(IngestResponse {
            id: event.event_id,
            status: "accepted".to_string(),
        }),
    ))
}

/// Extract API key from Authorization header or X-API-Key header
pub fn extract_api_key(headers: &HeaderMap) -> AppResult<String> {
    // Support X-API-Key header (used by @bugwatch/core SDK)
    // Note: HeaderMap normalizes header names to lowercase
    if let Some(api_key) = headers.get("x-api-key") {
        let key = api_key
            .to_str()
            .map(|s| s.to_string())
            .map_err(|_| AppError::Unauthorized("Invalid X-API-Key header".to_string()))?;
        if key.len() > 512 {
            return Err(AppError::Unauthorized("API key too long".to_string()));
        }
        return Ok(key);
    }

    // Fall back to Authorization: Bearer <key>
    let auth_header = headers
        .get("Authorization")
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?
        .to_str()
        .map_err(|_| AppError::Unauthorized("Invalid Authorization header".to_string()))?;

    if !auth_header.starts_with("Bearer ") {
        return Err(AppError::Unauthorized(
            "Authorization header must be Bearer token".to_string(),
        ));
    }

    let key = auth_header.trim_start_matches("Bearer ").to_string();
    if key.len() > 512 {
        return Err(AppError::Unauthorized("API key too long".to_string()));
    }
    Ok(key)
}

/// SHA-256 fingerprint (16 hex chars) for non-exception events.
/// Uses a real cryptographic hash so fingerprints are stable across processes
/// and Rust version upgrades (DefaultHasher is explicitly unstable).
fn sha256_fingerprint(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(input.as_bytes());
    hex::encode(&hash[..8]) // 8 bytes → 16 hex chars
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    fn headers_with_x_api_key(key: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-api-key", HeaderValue::from_str(key).unwrap());
        h
    }

    fn headers_with_bearer(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
        );
        h
    }

    #[test]
    fn x_api_key_header_preferred() {
        let result = extract_api_key(&headers_with_x_api_key("my-key")).unwrap();
        assert_eq!(result, "my-key");
    }

    #[test]
    fn bearer_fallback_works() {
        let result = extract_api_key(&headers_with_bearer("my-token")).unwrap();
        assert_eq!(result, "my-token");
    }

    #[test]
    fn missing_auth_returns_error() {
        assert!(extract_api_key(&HeaderMap::new()).is_err());
    }

    #[test]
    fn non_bearer_prefix_returns_error() {
        let mut h = HeaderMap::new();
        h.insert("Authorization", HeaderValue::from_static("Basic abc123"));
        assert!(extract_api_key(&h).is_err());
    }

    #[test]
    fn api_key_too_long_rejected_via_x_api_key() {
        let long_key = "a".repeat(513);
        assert!(extract_api_key(&headers_with_x_api_key(&long_key)).is_err());
    }

    #[test]
    fn api_key_too_long_rejected_via_bearer() {
        let long_key = "a".repeat(513);
        assert!(extract_api_key(&headers_with_bearer(&long_key)).is_err());
    }

    #[test]
    fn fingerprint_is_16_hex_chars() {
        let fp = sha256_fingerprint("some-input");
        assert_eq!(fp.len(), 16);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn fingerprint_is_deterministic() {
        assert_eq!(sha256_fingerprint("hello"), sha256_fingerprint("hello"));
    }

    #[test]
    fn fingerprint_differs_for_different_inputs() {
        assert_ne!(sha256_fingerprint("foo"), sha256_fingerprint("bar"));
    }

    // ── Integration tests ─────────────────────────────────────────────────────

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
            .body(Body::from(r#"{"name":"Events Test Project"}"#))
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

    #[tokio::test]
    async fn ingest_without_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"event_id":"e1","timestamp":"2024-01-01T00:00:00Z","level":"error"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_invalid_api_key_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", "not-a-real-key")
            .body(Body::from(
                r#"{"event_id":"e2","timestamp":"2024-01-01T00:00:00Z","level":"error"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn ingest_succeeds_returns_202() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_ok@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(
                r#"{"event_id":"evt-ok-001","timestamp":"2024-01-01T00:00:00Z","level":"error","exception":{"type":"Error","value":"Something went wrong","stacktrace":[]}}"#,
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"].as_str(), Some("accepted"));
    }

    #[tokio::test]
    async fn ingest_message_event_no_exception_returns_202() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_msg@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(
                r#"{"event_id":"evt-msg-001","timestamp":"2024-01-01T00:00:00Z","level":"info","message":"User logged in"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }

    #[tokio::test]
    async fn ingest_duplicate_event_returns_202_duplicate() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_dup@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload = r#"{"event_id":"evt-dup-001","timestamp":"2024-01-01T00:00:00Z","level":"error","exception":{"type":"Error","value":"dup","stacktrace":[]}}"#;

        let req1 = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp1 = app.clone().oneshot(req1).await.unwrap();
        assert_eq!(resp1.status(), StatusCode::ACCEPTED);

        let req2 = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        let resp2 = app.clone().oneshot(req2).await.unwrap();
        assert_eq!(resp2.status(), StatusCode::ACCEPTED);
        let bytes = axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"].as_str(), Some("duplicate"));
    }

    #[tokio::test]
    async fn ingest_too_many_tags_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_tags@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let tags: String = (0..65)
            .map(|i| format!(r#""key{}":"val{}""#, i, i))
            .collect::<Vec<_>>()
            .join(",");
        let payload = format!(
            r#"{{"event_id":"evt-tags-001","timestamp":"2024-01-01T00:00:00Z","level":"error","tags":{{{}}}}}"#,
            tags
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_tag_value_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_taglen@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long_val = "x".repeat(257);
        let payload = format!(
            r#"{{"event_id":"evt-taglen-001","timestamp":"2024-01-01T00:00:00Z","level":"error","tags":{{"key":"{}"}}}}"#,
            long_val
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_environment_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_env@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let long_env = "e".repeat(65);
        let payload = format!(
            r#"{{"event_id":"evt-env-001","timestamp":"2024-01-01T00:00:00Z","level":"error","environment":"{}"}}"#,
            long_env
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_invalid_timestamp_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_ts@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(
                r#"{"event_id":"evt-ts-001","timestamp":"not-a-timestamp","level":"error"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_too_many_stack_frames_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_frames@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let frame = r#"{"filename":"app.js","function":"fn","lineno":1,"colno":1,"in_app":false}"#;
        let frames = (0..201).map(|_| frame).collect::<Vec<_>>().join(",");
        let payload = format!(
            r#"{{"event_id":"evt-frames-001","timestamp":"2024-01-01T00:00:00Z","level":"error","exception":{{"type":"Error","value":"err","stacktrace":[{}]}}}}"#,
            frames
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_too_many_breadcrumbs_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ingest_crumbs@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let crumbs: String = (0..101)
            .map(|i| {
                format!(
                    r#"{{"timestamp":"2024-01-01T00:00:00Z","type":"default","category":"cat","message":"msg{}"}}"#,
                    i
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let payload = format!(
            r#"{{"event_id":"evt-crumbs-001","timestamp":"2024-01-01T00:00:00Z","level":"error","breadcrumbs":[{}]}}"#,
            crumbs
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_with_request_context_returns_202() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ev_req_ctx@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload = r#"{
            "event_id":"req-ctx-001","timestamp":"2024-01-01T00:00:00Z","level":"error",
            "exception":{"type":"Error","value":"test","stacktrace":[]},
            "request":{"url":"https://example.com/page","method":"POST",
                "headers":{"content-type":"application/json"},"query_string":"foo=bar"},
            "user":{"id":"u-1","email":"user@example.com","username":"testuser"}
        }"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }

    #[tokio::test]
    async fn ingest_with_breadcrumbs_returns_202() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ev_breadcrumbs@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload = r#"{
            "event_id":"breadcrumb-001","timestamp":"2024-01-01T00:00:00Z","level":"warning",
            "exception":{"type":"Warning","value":"low mem","stacktrace":[]},
            "breadcrumbs":[
                {"timestamp":"2024-01-01T00:00:00Z","type":"default","category":"ui.click",
                 "message":"user clicked button","level":"info"}
            ]
        }"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }

    #[tokio::test]
    async fn ingest_with_release_and_tags_returns_202() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ev_release@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload = r#"{
            "event_id":"release-001","timestamp":"2024-01-01T00:00:00Z","level":"info",
            "message":"app started",
            "release":"1.2.3","environment":"staging","server_name":"web-01",
            "tags":{"component":"auth","region":"us-east-1"}
        }"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }

    #[tokio::test]
    async fn ingest_extra_too_large_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ev_extra_large@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let large_value = "x".repeat(70_000);
        let payload = format!(
            r#"{{"event_id":"extra-lg-001","timestamp":"2024-01-01T00:00:00Z","level":"error",
            "exception":{{"type":"E","value":"e","stacktrace":[]}},
            "extra":{{"big":"{}"}}}}"#,
            large_value
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn ingest_with_session_id_returns_202() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ev_session@example.com").await;
        let (_, api_key) = create_project_with_key(&app, &token).await;

        let payload = r#"{
            "event_id":"sess-001","timestamp":"2024-01-01T00:00:00Z","level":"error",
            "exception":{"type":"Error","value":"crash","stacktrace":[]},
            "session_id":"sess-abc-123"
        }"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );
    }
}
