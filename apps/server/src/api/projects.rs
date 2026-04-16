use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use super::{ApiResponse, PaginatedResponse, PaginationMeta, PaginationParams};
use crate::{
    auth::{AuthIdentity, EitherAuth},
    billing::{get_tier_limits, Tier},
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
    auth: EitherAuth,
    Query(params): Query<PaginationParams>,
) -> AppResult<Json<PaginatedResponse<ProjectResponse>>> {
    auth.has_permission("read")
        .then_some(())
        .ok_or_else(|| AppError::Forbidden("read permission required".to_string()))?;

    let page = params.page.max(1);
    let per_page = params.per_page.min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    let (projects, total) = match &*auth {
        AuthIdentity::User(user) => {
            let projects =
                ProjectRepository::find_by_owner(&state.db, &user.id, per_page as i64, offset)
                    .await?;
            let total = ProjectRepository::count_by_owner(&state.db, &user.id).await?;
            (projects, total)
        }
        AuthIdentity::Agent(agent) => {
            let projects = ProjectRepository::find_by_organization(
                &state.db,
                &agent.organization_id,
                per_page as i64,
                offset,
            )
            .await?;
            let total =
                ProjectRepository::count_by_organization(&state.db, &agent.organization_id).await?;
            (projects, total)
        }
    };

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;

    Ok(Json(PaginatedResponse {
        // NOTE: api_key is intentionally truncated to the first 8 chars in list responses to
        // avoid exposing full keys in bulk. The GET /projects/:id endpoint returns the full key.
        data: projects
            .into_iter()
            .map(|p| {
                let mut r = ProjectResponse::from(p);
                r.api_key = r.api_key.chars().take(8).collect();
                r
            })
            .collect(),
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
    auth: EitherAuth,
    Json(req): Json<CreateProjectRequest>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    if req.name.trim().is_empty() {
        return Err(AppError::Validation(
            "Project name cannot be empty".to_string(),
        ));
    }
    if req.name.chars().count() > 100 {
        return Err(AppError::Validation(
            "Project name too long (max 100 characters)".to_string(),
        ));
    }

    // Resolve owner_id and org for tier checks
    let (owner_id, org) = match &*auth {
        AuthIdentity::User(user) => {
            let org = OrganizationRepository::find_by_user(&state.db, &user.id).await?;
            (user.id.clone(), org)
        }
        AuthIdentity::Agent(agent) => {
            let org = OrganizationRepository::find_by_id(&state.db, &agent.organization_id).await?;
            let owner_id = org.as_ref().map(|o| o.owner_id.clone()).ok_or_else(|| {
                AppError::Internal("Organization not found for agent".to_string())
            })?;
            (owner_id, org)
        }
    };

    // Check project limit based on tier
    let tier = match &org {
        Some(org) => Tier::from_str(&org.tier),
        None => Tier::Free,
    };
    let limits = get_tier_limits(tier);

    let slug = generate_slug(&req.name);

    // Begin a transaction so the count check and INSERT are atomic.
    // An advisory lock keyed on owner_id serialises concurrent project-create
    // requests for the same user, preventing TOCTOU races on the project limit.
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start transaction: {}", e)))?;

    let lock_key: i64 = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        owner_id.hash(&mut h);
        h.finish() as i64
    };
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(lock_key)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to acquire project limit lock: {}", e)))?;

    // Re-count within the lock to get a consistent view
    let current_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE owner_id = $1")
            .bind(&owner_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to count projects: {}", e)))?;

    if let Some(project_limit) = limits.project_limit {
        let x402_extra = org
            .as_ref()
            .map(|o| o.x402_extra_projects as i64)
            .unwrap_or(0);
        let effective_limit = project_limit as i64 + x402_extra;
        if current_count >= effective_limit {
            let msg = format!(
                "Project limit reached ({}/{}). Upgrade your plan or pay to add a project slot.",
                current_count, effective_limit
            );
            let tier_str = org
                .as_ref()
                .map(|o| o.tier.clone())
                .unwrap_or_else(|| "free".to_string());
            let org_id = match org.as_ref().map(|o| o.id.clone()) {
                Some(id) if !id.is_empty() => id,
                _ => {
                    return Err(AppError::PaymentRequired(
                        "Resource limit reached. Upgrade your plan.".to_string(),
                    ))
                }
            };
            if state.config.x402_enabled && !state.config.deployment_mode.is_self_hosted() {
                let nonce = uuid::Uuid::new_v4().to_string();
                let challenge = crate::payments::challenge::build_capacity_challenge(
                    &state.config.x402_wallet_address,
                    &state.config.x402_usdc_address,
                    "/api/v1/projects",
                    "project",
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
                        "/api/v1/projects",
                        "project",
                        1,
                        crate::payments::challenge::PaymentPricing::for_capacity_grant(
                            "project", &tier_str, 1,
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

    let project = ProjectRepository::create_in_tx(
        &mut tx,
        &req.name,
        &slug,
        &owner_id,
        req.platform.as_deref(),
        req.framework.as_deref(),
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to commit project creation: {}", e)))?;

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(project),
    }))
}

/// GET /api/v1/projects/:id
/// Returns the full api_key (unlike the list endpoint which returns only the first 8 chars).
pub async fn get(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    auth.has_permission("read")
        .then_some(())
        .ok_or_else(|| AppError::Forbidden("read permission required".to_string()))?;

    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    Ok(Json(ApiResponse {
        data: ProjectResponse::from(project),
    }))
}

/// PATCH /api/v1/projects/:id
pub async fn update(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(id): Path<String>,
    Json(req): Json<UpdateProjectRequest>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    // Update name if provided
    if let Some(name) = &req.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation(
                "Project name cannot be empty".to_string(),
            ));
        }
        if name.chars().count() > 100 {
            return Err(AppError::Validation(
                "Project name too long (max 100 characters)".to_string(),
            ));
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
    auth: EitherAuth,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    ProjectRepository::delete(&state.db, &id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Project deleted successfully" }),
    }))
}

/// POST /api/v1/projects/:id/keys
pub async fn rotate_key(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    if !auth.has_permission("admin") {
        return Err(AppError::Forbidden("admin permission required".to_string()));
    }

    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
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
    auth: EitherAuth,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<ProjectResponse>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
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
    auth: EitherAuth,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<VerificationResponse>>> {
    auth.has_permission("read")
        .then_some(())
        .ok_or_else(|| AppError::Forbidden("read permission required".to_string()))?;

    let project = ProjectRepository::find_by_id(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
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
