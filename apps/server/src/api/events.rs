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
    tracing::info!("Event ingest request received");

    // 1. Extract API key from Authorization header
    let api_key = extract_api_key(&headers)?;
    tracing::info!("API key extracted successfully");

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

    tracing::info!(
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
        }
    }

    // Validate exception and event field bounds to prevent storage exhaustion.
    if let Some(ref exc) = event.exception {
        if exc.stacktrace.len() > 200 {
            return Err(AppError::Validation(
                "Too many stack frames (max 200)".to_string(),
            ));
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
        let fp = format!("{:x}", md5_hash(msg));
        (fp[..16].to_string(), msg.to_string())
    };

    // 6. Get level as string
    let level = match event.level {
        EventLevel::Fatal => "fatal",
        EventLevel::Error => "error",
        EventLevel::Warning => "warning",
        EventLevel::Info => "info",
        EventLevel::Debug => "debug",
    };

    // 7. Find or create issue
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
        tracing::info!("Created new issue {} for project {}", issue.id, project.id);
    }

    // 8. Store event
    let payload = serde_json::to_string(&event)
        .map_err(|e| AppError::Internal(format!("Failed to serialize event: {}", e)))?;

    // Parse timestamp string to DateTime<Utc>
    let timestamp = chrono::DateTime::parse_from_rfc3339(&event.timestamp)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now());

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

    let created_event = inserted.expect("inserted is_some was verified above");

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

    // 9. Evaluate alert rules (async, non-blocking, with backpressure)
    if is_new {
        tracing::info!(
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
                    "Alert semaphore full — skipping alert evaluation for issue {}",
                    issue.id
                );
            }
        }
    } else {
        tracing::info!(
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
        return api_key
            .to_str()
            .map(|s| s.to_string())
            .map_err(|_| AppError::Unauthorized("Invalid X-API-Key header".to_string()));
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

    Ok(auth_header.trim_start_matches("Bearer ").to_string())
}

/// Simple MD5 hash for non-exception fingerprints
fn md5_hash(input: &str) -> u128 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish() as u128
}
