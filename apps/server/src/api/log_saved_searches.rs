use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::EitherAuth,
    billing::tiers::can_access_feature,
    db::repositories::{LogSavedSearchRepository, OrganizationRepository, ProjectRepository},
    AppError, AppResult, AppState,
};

use super::ApiResponse;

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateSavedSearchRequest {
    pub name: String,
    pub filters: serde_json::Value,
}

/// DTO returned to callers — mirrors the LogSavedSearch model from Slice A.
#[derive(Debug, Serialize, Clone)]
pub struct LogSavedSearchDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub filters: serde_json::Value,
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

// ============================================================================
// Handlers
// ============================================================================

/// GET /api/v1/projects/:project_id/log-saved-searches
///
/// Returns all saved log searches for the project (Pro+).
pub async fn list(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<LogSavedSearchDto>>>> {
    // 1. Project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // 2. Tier check — log_monitoring is Pro+
    let tier = project_tier(&state, &project_id).await;
    if !can_access_feature(&tier, "log_monitoring") {
        return Err(AppError::PaymentRequired(
            "Log monitoring requires a Pro plan or higher.".to_string(),
        ));
    }

    let searches = LogSavedSearchRepository::list(&state.db, &project_id).await?;
    let dtos = searches
        .into_iter()
        .map(|s| LogSavedSearchDto {
            id: s.id,
            project_id: s.project_id,
            name: s.name,
            filters: serde_json::from_str(&s.filters).unwrap_or_default(),
            created_at: s.created_at.0.to_rfc3339(),
        })
        .collect();
    Ok(Json(ApiResponse { data: dtos }))
}

/// POST /api/v1/projects/:project_id/log-saved-searches
///
/// Creates a new saved log search (Pro+).
pub async fn create(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Json(request): Json<CreateSavedSearchRequest>,
) -> AppResult<(StatusCode, Json<ApiResponse<LogSavedSearchDto>>)> {
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

    let user_id = auth.user_id().unwrap_or("").to_string();

    let search =
        LogSavedSearchRepository::create(&state.db, &project_id, &user_id, &name, &request.filters)
            .await?;

    let dto = LogSavedSearchDto {
        id: search.id,
        project_id: search.project_id,
        name: search.name,
        filters: serde_json::from_str(&search.filters).unwrap_or_default(),
        created_at: search.created_at.0.to_rfc3339(),
    };
    Ok((StatusCode::CREATED, Json(ApiResponse { data: dto })))
}

/// DELETE /api/v1/projects/:project_id/log-saved-searches/:search_id
///
/// Deletes a saved log search (Pro+).
pub async fn delete(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, search_id)): Path<(String, String)>,
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

    let deleted = LogSavedSearchRepository::delete(&state.db, &search_id, &project_id).await?;
    if !deleted {
        return Err(AppError::NotFound("Saved search not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::billing::tiers::can_access_feature;

    // ── tier gate ─────────────────────────────────────────────────────────────

    #[test]
    fn log_monitoring_free_tier_denied() {
        assert!(!can_access_feature("free", "log_monitoring"));
    }

    #[test]
    fn log_monitoring_pro_tier_allowed() {
        assert!(can_access_feature("pro", "log_monitoring"));
    }

    #[test]
    fn log_monitoring_team_tier_allowed() {
        assert!(can_access_feature("team", "log_monitoring"));
    }

    #[test]
    fn log_monitoring_enterprise_tier_allowed() {
        assert!(can_access_feature("enterprise", "log_monitoring"));
    }

    // ── input validation helpers ──────────────────────────────────────────────

    #[test]
    fn saved_search_name_empty_is_invalid() {
        let name = "   ".trim().to_string();
        assert!(name.is_empty());
    }

    #[test]
    fn saved_search_name_256_chars_is_too_long() {
        let name = "a".repeat(256);
        assert!(name.len() > 255);
    }

    #[test]
    fn saved_search_name_255_chars_is_valid() {
        let name = "a".repeat(255);
        assert!(name.len() <= 255 && !name.is_empty());
    }
}
