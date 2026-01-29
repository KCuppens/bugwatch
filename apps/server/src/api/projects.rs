use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use super::{ApiResponse, PaginatedResponse, PaginationMeta, PaginationParams};
use crate::{
    auth::AuthUser,
    billing::{Tier, get_tier_limits},
    db::repositories::{OrganizationRepository, ProjectRepository},
    AppError, AppResult, AppState,
};

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub api_key: String,
    pub owner_id: String,
    pub created_at: String,
    pub platform: Option<String>,
    pub framework: Option<String>,
    pub onboarding_completed_at: Option<String>,
}

impl From<crate::db::models::Project> for ProjectResponse {
    fn from(p: crate::db::models::Project) -> Self {
        Self {
            id: p.id,
            name: p.name,
            slug: p.slug,
            api_key: p.api_key,
            owner_id: p.owner_id,
            created_at: p.created_at.to_rfc3339(),
            platform: p.platform,
            framework: p.framework,
            onboarding_completed_at: p.onboarding_completed_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub platform: Option<String>,
    pub framework: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub platform: Option<String>,
    pub framework: Option<String>,
}

/// GET /api/v1/projects
pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(params): Query<PaginationParams>,
) -> AppResult<Json<PaginatedResponse<ProjectResponse>>> {
    let page = params.page.max(1);
    let per_page = params.per_page.min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    let projects = ProjectRepository::find_by_owner(&state.db, &auth_user.id, per_page as i64, offset).await?;
    let total = ProjectRepository::count_by_owner(&state.db, &auth_user.id).await?;
    let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;

    Ok(Json(PaginatedResponse {
        data: projects.into_iter().map(ProjectResponse::from).collect(),
        pagination: PaginationMeta {
            page,
            per_page,
            total: total as u32,
            total_pages,
        },
    }))
}

/// POST /api/v1/projects
pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateProjectRequest>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    if req.name.trim().is_empty() {
        return Err(AppError::Validation("Project name cannot be empty".to_string()));
    }

    // Check project limit based on user's tier
    let tier = match OrganizationRepository::find_by_user(&state.db, &auth_user.id).await? {
        Some(org) => Tier::from_str(&org.tier),
        None => Tier::Free,
    };
    let limits = get_tier_limits(tier);

    if let Some(project_limit) = limits.project_limit {
        let current_count = ProjectRepository::count_by_owner(&state.db, &auth_user.id).await?;
        if current_count >= project_limit as i64 {
            return Err(AppError::PaymentRequired(format!(
                "Project limit reached ({}/{}). Upgrade your plan to create more projects.",
                current_count, project_limit
            )));
        }
    }

    let slug = generate_slug(&req.name);

    let project = ProjectRepository::create(
        &state.db,
        &req.name,
        &slug,
        &auth_user.id,
        req.platform.as_deref(),
        req.framework.as_deref(),
    )
    .await?;

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(project),
    }))
}

/// GET /api/v1/projects/:id
pub async fn get(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    // Verify user has access
    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(project),
    }))
}

/// PATCH /api/v1/projects/:id
pub async fn update(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateProjectRequest>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    // Verify user is owner
    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Update name if provided
    if let Some(name) = &req.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Project name cannot be empty".to_string()));
        }
        ProjectRepository::update_name(&state.db, &id, name).await?;
    }

    // Update platform/framework if provided
    if req.platform.is_some() || req.framework.is_some() {
        let platform = req.platform.as_deref().or(project.platform.as_deref());
        let framework = req.framework.as_deref().or(project.framework.as_deref());
        ProjectRepository::update_sdk(&state.db, &id, platform, framework).await?;
    }

    // Fetch updated project
    let updated = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to fetch updated project".to_string()))?;

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(updated),
    }))
}

/// DELETE /api/v1/projects/:id
pub async fn delete(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    // Verify user is owner
    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    ProjectRepository::delete(&state.db, &id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Project deleted successfully" }),
    }))
}

/// POST /api/v1/projects/:id/keys
pub async fn rotate_key(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    // Verify user is owner
    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    ProjectRepository::rotate_api_key(&state.db, &id).await?;

    // Fetch updated project with new key
    let updated = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to fetch updated project".to_string()))?;

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(updated),
    }))
}

/// POST /api/v1/projects/:id/onboarding/complete
pub async fn complete_onboarding(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    // Verify user is owner
    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    ProjectRepository::complete_onboarding(&state.db, &id).await?;

    // Fetch updated project
    let updated = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to fetch updated project".to_string()))?;

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(updated),
    }))
}

#[derive(Debug, Serialize)]
pub struct VerificationResponse {
    pub status: String,
    pub event_count: i64,
}

/// GET /api/v1/projects/:id/verify
/// Check if the project has received any events (for onboarding verification)
pub async fn verify_events(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<VerificationResponse>>> {
    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    // Verify user is owner
    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Count issues for this project (events are grouped into issues)
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM issues WHERE project_id = $1")
        .bind(&id)
        .fetch_one(&state.db)
        .await?;

    let status = if count.0 > 0 { "success" } else { "waiting" };

    Ok(Json(ApiResponse {
        data: VerificationResponse {
            status: status.to_string(),
            event_count: count.0,
        },
    }))
}

/// Generate a URL-safe slug from a project name
fn generate_slug(name: &str) -> String {
    let base_slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    // Add a short unique suffix to avoid collisions
    let suffix = &uuid::Uuid::new_v4().to_string()[..8];
    format!("{}-{}", base_slug, suffix)
}
