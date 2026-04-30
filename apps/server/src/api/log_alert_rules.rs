use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::EitherAuth,
    billing::tiers::can_access_feature,
    db::repositories::{LogAlertRuleRepository, OrganizationRepository, ProjectRepository},
    AppError, AppResult, AppState,
};

use super::ApiResponse;

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateLogAlertRuleRequest {
    pub name: String,
    pub level_filter: Option<String>,
    pub search_filter: Option<String>,
    pub threshold: i64,
    pub window_seconds: i64,
    pub notification_type: String,
    pub notification_target: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLogAlertRuleRequest {
    pub name: Option<String>,
    pub level_filter: Option<String>,
    pub search_filter: Option<String>,
    pub threshold: Option<i64>,
    pub window_seconds: Option<i64>,
    pub notification_type: Option<String>,
    pub notification_target: Option<String>,
    pub is_active: Option<bool>,
}

/// DTO returned to callers — mirrors the LogAlertRule model from Slice A.
#[derive(Debug, Serialize, Clone)]
pub struct LogAlertRuleDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub level_filter: Option<String>,
    pub search_filter: Option<String>,
    pub threshold: i64,
    pub window_seconds: i64,
    pub notification_type: String,
    pub notification_target: String,
    pub is_active: bool,
    pub last_fired_at: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Resolve the org tier string for a project (defaults to "free" on error).
async fn project_tier(state: &AppState, project_id: &str) -> String {
    OrganizationRepository::find_by_project_id(&state.db, project_id)
        .await
        .unwrap_or(None)
        .map(|o| o.tier)
        .unwrap_or_else(|| "free".to_string())
}

/// Validate create/update fields that are subject to range checks.
/// Returns an error if any value is out of bounds.
fn validate_threshold(threshold: i64) -> AppResult<()> {
    if threshold < 1 {
        return Err(AppError::Validation("threshold must be >= 1".to_string()));
    }
    Ok(())
}

fn validate_window_seconds(window_seconds: i64) -> AppResult<()> {
    if window_seconds <= 0 {
        return Err(AppError::Validation(
            "window_seconds must be > 0".to_string(),
        ));
    }
    if window_seconds > 86400 {
        return Err(AppError::Validation(
            "window_seconds must be <= 86400 (24 hours)".to_string(),
        ));
    }
    Ok(())
}

fn validate_notification_type(notification_type: &str) -> AppResult<()> {
    match notification_type {
        "email" | "webhook" => Ok(()),
        other => Err(AppError::Validation(format!(
            "notification_type must be 'email' or 'webhook', got '{}'",
            other
        ))),
    }
}

fn validate_notification_target(target: &str) -> AppResult<()> {
    if target.trim().is_empty() {
        return Err(AppError::Validation(
            "notification_target must not be empty".to_string(),
        ));
    }
    Ok(())
}

// ============================================================================
// Conversion helper
// ============================================================================

fn rule_to_dto(rule: crate::db::models::LogAlertRule) -> LogAlertRuleDto {
    LogAlertRuleDto {
        id: rule.id,
        project_id: rule.project_id,
        name: rule.name,
        level_filter: rule.level_filter,
        search_filter: rule.search_filter,
        threshold: rule.threshold as i64,
        window_seconds: rule.window_seconds as i64,
        notification_type: rule.notification_type,
        notification_target: rule.notification_target,
        is_active: *rule.is_active,
        last_fired_at: rule.last_fired_at.map(|ts| ts.0.to_rfc3339()),
        created_at: rule.created_at.0.to_rfc3339(),
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /api/v1/projects/:project_id/log-alert-rules
///
/// Returns all log alert rules for the project (Pro+).
pub async fn list(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<LogAlertRuleDto>>>> {
    // 1. Project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // 2. Tier check
    let tier = project_tier(&state, &project_id).await;
    if !can_access_feature(&tier, "log_monitoring") {
        return Err(AppError::PaymentRequired(
            "Log monitoring requires a Pro plan or higher.".to_string(),
        ));
    }

    let rules = LogAlertRuleRepository::list(&state.db, &project_id).await?;
    let dtos = rules.into_iter().map(rule_to_dto).collect();
    Ok(Json(ApiResponse { data: dtos }))
}

/// POST /api/v1/projects/:project_id/log-alert-rules
///
/// Creates a new log alert rule (Pro+).
pub async fn create(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Json(request): Json<CreateLogAlertRuleRequest>,
) -> AppResult<(StatusCode, Json<ApiResponse<LogAlertRuleDto>>)> {
    // 1. Validate input
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("name must not be empty".to_string()));
    }
    if name.len() > 255 {
        return Err(AppError::Validation(
            "name too long (max 255 characters)".to_string(),
        ));
    }
    validate_threshold(request.threshold)?;
    validate_window_seconds(request.window_seconds)?;
    validate_notification_type(&request.notification_type)?;
    validate_notification_target(&request.notification_target)?;

    // 2. Project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // 3. Tier check
    let tier = project_tier(&state, &project_id).await;
    if !can_access_feature(&tier, "log_monitoring") {
        return Err(AppError::PaymentRequired(
            "Log monitoring requires a Pro plan or higher.".to_string(),
        ));
    }

    let rule = LogAlertRuleRepository::create(
        &state.db,
        &project_id,
        &name,
        request.level_filter.as_deref(),
        request.search_filter.as_deref(),
        request.threshold as i32,
        request.window_seconds as i32,
        &request.notification_type,
        &request.notification_target,
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(ApiResponse {
            data: rule_to_dto(rule),
        }),
    ))
}

/// PATCH /api/v1/projects/:project_id/log-alert-rules/:rule_id
///
/// Partial update of a log alert rule (Pro+).
pub async fn update(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, rule_id)): Path<(String, String)>,
    Json(request): Json<UpdateLogAlertRuleRequest>,
) -> AppResult<Json<ApiResponse<LogAlertRuleDto>>> {
    // 1. Validate provided fields
    if let Some(ref name) = request.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("name must not be empty".to_string()));
        }
        if trimmed.len() > 255 {
            return Err(AppError::Validation(
                "name too long (max 255 characters)".to_string(),
            ));
        }
    }
    if let Some(threshold) = request.threshold {
        validate_threshold(threshold)?;
    }
    if let Some(window) = request.window_seconds {
        validate_window_seconds(window)?;
    }
    if let Some(ref ntype) = request.notification_type {
        validate_notification_type(ntype)?;
    }
    if let Some(ref ntarget) = request.notification_target {
        validate_notification_target(ntarget)?;
    }

    // 2. Project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // 3. Tier check
    let tier = project_tier(&state, &project_id).await;
    if !can_access_feature(&tier, "log_monitoring") {
        return Err(AppError::PaymentRequired(
            "Log monitoring requires a Pro plan or higher.".to_string(),
        ));
    }

    let rule = LogAlertRuleRepository::update(
        &state.db,
        &rule_id,
        &project_id,
        request.name.as_deref(),
        request.level_filter.as_ref().map(|s| Some(s.as_str())),
        request.search_filter.as_ref().map(|s| Some(s.as_str())),
        request.threshold.map(|t| t as i32),
        request.window_seconds.map(|w| w as i32),
        request.notification_type.as_deref(),
        request.notification_target.as_deref(),
        request.is_active,
    )
    .await?
    .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    Ok(Json(ApiResponse {
        data: rule_to_dto(rule),
    }))
}

/// DELETE /api/v1/projects/:project_id/log-alert-rules/:rule_id
///
/// Deletes a log alert rule (Pro+).
pub async fn delete(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, rule_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    // 1. Project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // 2. Tier check
    let tier = project_tier(&state, &project_id).await;
    if !can_access_feature(&tier, "log_monitoring") {
        return Err(AppError::PaymentRequired(
            "Log monitoring requires a Pro plan or higher.".to_string(),
        ));
    }

    let deleted = LogAlertRuleRepository::delete(&state.db, &rule_id, &project_id).await?;
    if !deleted {
        return Err(AppError::NotFound("Alert rule not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_threshold ────────────────────────────────────────────────────

    #[test]
    fn threshold_zero_is_invalid() {
        assert!(validate_threshold(0).is_err());
    }

    #[test]
    fn threshold_negative_is_invalid() {
        assert!(validate_threshold(-5).is_err());
    }

    #[test]
    fn threshold_one_is_valid() {
        assert!(validate_threshold(1).is_ok());
    }

    #[test]
    fn threshold_large_positive_is_valid() {
        assert!(validate_threshold(10_000).is_ok());
    }

    // ── validate_window_seconds ───────────────────────────────────────────────

    #[test]
    fn window_zero_is_invalid() {
        assert!(validate_window_seconds(0).is_err());
    }

    #[test]
    fn window_negative_is_invalid() {
        assert!(validate_window_seconds(-1).is_err());
    }

    #[test]
    fn window_86401_is_invalid() {
        assert!(validate_window_seconds(86401).is_err());
    }

    #[test]
    fn window_86400_is_valid() {
        assert!(validate_window_seconds(86400).is_ok());
    }

    #[test]
    fn window_one_second_is_valid() {
        assert!(validate_window_seconds(1).is_ok());
    }

    #[test]
    fn window_sixty_seconds_is_valid() {
        assert!(validate_window_seconds(60).is_ok());
    }

    // ── validate_notification_type ────────────────────────────────────────────

    #[test]
    fn notification_type_email_is_valid() {
        assert!(validate_notification_type("email").is_ok());
    }

    #[test]
    fn notification_type_webhook_is_valid() {
        assert!(validate_notification_type("webhook").is_ok());
    }

    #[test]
    fn notification_type_sms_is_invalid() {
        assert!(validate_notification_type("sms").is_err());
    }

    #[test]
    fn notification_type_slack_is_invalid() {
        assert!(validate_notification_type("slack").is_err());
    }

    #[test]
    fn notification_type_empty_is_invalid() {
        assert!(validate_notification_type("").is_err());
    }

    // ── validate_notification_target ─────────────────────────────────────────

    #[test]
    fn notification_target_empty_is_invalid() {
        assert!(validate_notification_target("").is_err());
    }

    #[test]
    fn notification_target_whitespace_only_is_invalid() {
        assert!(validate_notification_target("   ").is_err());
    }

    #[test]
    fn notification_target_nonempty_is_valid() {
        assert!(validate_notification_target("user@example.com").is_ok());
        assert!(validate_notification_target("https://hooks.example.com/abc").is_ok());
    }

    // ── tier gate ─────────────────────────────────────────────────────────────

    #[test]
    fn log_monitoring_free_denied() {
        assert!(!can_access_feature("free", "log_monitoring"));
    }

    #[test]
    fn log_monitoring_pro_allowed() {
        assert!(can_access_feature("pro", "log_monitoring"));
    }
}
