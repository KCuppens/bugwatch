use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    db::repositories::{EventRepository, IssueRepository, ProjectRepository},
    processing::fingerprint::{generate_fingerprint, generate_title},
    AppError, AppResult, AppState,
};

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
    pub sdk: SdkInfo,

    /// Platform
    pub platform: String,

    /// Runtime info
    pub runtime: Option<RuntimeInfo>,
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
    pub filename: String,
    pub function: String,
    pub lineno: u32,
    pub colno: u32,
    pub abs_path: Option<String>,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    pub in_app: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RequestContext {
    pub url: String,
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
    pub timestamp: String,
    #[serde(rename = "type")]
    pub breadcrumb_type: String,
    pub category: String,
    pub message: Option<String>,
    pub data: Option<serde_json::Value>,
    pub level: EventLevel,
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
    Json(event): Json<ErrorEvent>,
) -> AppResult<(StatusCode, Json<IngestResponse>)> {
    // 1. Extract API key from Authorization header
    let api_key = extract_api_key(&headers)?;

    // 2. Validate API key and get project
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;

    // 3. Check rate limit (tier is looked up from organization)
    let rate_limit_result = state.rate_limiter.check_with_tier_lookup(&api_key, &state.db).await;

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

    tracing::debug!("Received event for project {}: {}", project.id, event.event_id);

    // 4. Check for duplicate event
    if EventRepository::find_by_event_id(&state.db, &event.event_id)
        .await?
        .is_some()
    {
        // Idempotent - return success for duplicate
        return Ok((
            StatusCode::ACCEPTED,
            Json(IngestResponse {
                id: event.event_id,
                status: "duplicate".to_string(),
            }),
        ));
    }

    // 5. Generate fingerprint and title
    let (fingerprint, title) = if let Some(ref exc) = event.exception {
        (generate_fingerprint(exc), generate_title(exc))
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

    EventRepository::create(&state.db, &issue.id, &event.event_id, timestamp, &payload)
        .await?;

    // 9. Evaluate alert rules (async, non-blocking)
    if is_new {
        let alerting = state.alerting_service.clone();
        let project_id = project.id.clone();
        let issue_clone = issue.clone();

        tokio::spawn(async move {
            if let Err(e) = alerting.on_new_issue(&project_id, &issue_clone).await {
                tracing::error!("Failed to trigger new issue alert: {}", e);
            }
        });
    }

    Ok((
        StatusCode::ACCEPTED,
        Json(IngestResponse {
            id: event.event_id,
            status: "accepted".to_string(),
        }),
    ))
}

/// Extract API key from Authorization header
fn extract_api_key(headers: &HeaderMap) -> AppResult<String> {
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

/// Deserialize null as None for Option<String>
fn deserialize_null_default<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer).ok().flatten())
}
