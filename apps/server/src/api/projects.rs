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
    let per_page = params.per_page; // already clamped 1..=200 by PaginationParams deserializer
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
    if req
        .platform
        .as_deref()
        .map(|s| s.chars().count())
        .unwrap_or(0)
        > 50
    {
        return Err(AppError::Validation(
            "Platform too long (max 50 characters)".to_string(),
        ));
    }
    if req
        .framework
        .as_deref()
        .map(|s| s.chars().count())
        .unwrap_or(0)
        > 50
    {
        return Err(AppError::Validation(
            "Framework too long (max 50 characters)".to_string(),
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
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start transaction: {}", e)))?;

    // Re-count within the transaction to get a consistent view
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
        &mut *tx,
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
        if let Some(ref p) = req.platform {
            if p.chars().count() > 50 {
                return Err(AppError::Validation(
                    "Platform too long (max 50 characters)".to_string(),
                ));
            }
        }
        if let Some(ref f) = req.framework {
            if f.chars().count() > 50 {
                return Err(AppError::Validation(
                    "Framework too long (max 50 characters)".to_string(),
                ));
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_lowercases_name() {
        let slug = generate_slug("MyProject");
        assert!(slug.starts_with("myproject-"));
    }

    #[test]
    fn slug_replaces_spaces_with_dashes() {
        let slug = generate_slug("my project");
        assert!(slug.starts_with("my-project-"));
    }

    #[test]
    fn slug_replaces_special_chars_with_dashes() {
        let slug = generate_slug("hello@world!");
        assert!(slug.starts_with("hello-world-"));
    }

    #[test]
    fn slug_has_unique_suffix() {
        let s1 = generate_slug("same");
        let s2 = generate_slug("same");
        assert_ne!(s1, s2);
    }

    #[test]
    fn slug_suffix_length_is_eight() {
        let slug = generate_slug("test");
        let suffix = slug.split('-').last().unwrap();
        assert_eq!(suffix.len(), 8);
    }

    #[test]
    fn slug_all_alphanumeric_name_unchanged() {
        let slug = generate_slug("abc123");
        assert!(slug.starts_with("abc123-"));
    }

    // ── integration helpers ───────────────────────────────────────────────────

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

    async fn signup_and_token(app: &axum::Router, email: &str) -> String {
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

    async fn create_project(app: &axum::Router, token: &str, name: &str) -> Value {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(format!(r#"{{"name":"{}"}}"#, name)))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    // ── auth guards ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_projects_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn create_project_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"test"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn get_project_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/some-id")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn update_project_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/v1/projects/some-id")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"new"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn delete_project_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("DELETE")
            .uri("/api/v1/projects/some-id")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── list projects ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_projects_empty_initially() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_list_empty@example.com").await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"].as_array().unwrap().len(), 0);
        assert_eq!(json["pagination"]["total"], 0);
    }

    #[tokio::test]
    async fn list_projects_truncates_api_key_to_8_chars() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_list_key@example.com").await;
        create_project(&app, &token, "Key Truncation Test").await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let api_key = json["data"][0]["api_key"].as_str().unwrap();
        assert_eq!(
            api_key.len(),
            8,
            "list endpoint must truncate api_key to 8 chars"
        );
    }

    // ── create project ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn create_project_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_create@example.com").await;
        let json = create_project(&app, &token, "My App").await;
        assert_eq!(json["data"]["name"], "My App");
        assert!(json["data"]["api_key"]
            .as_str()
            .unwrap()
            .starts_with("bw_live_"));
        assert!(json["data"]["id"].as_str().is_some());
    }

    #[tokio::test]
    async fn create_project_empty_name_returns_422() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_empty_name@example.com").await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"   "}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn create_project_name_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_longname@example.com").await;
        let long_name = "x".repeat(101);
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(format!(r#"{{"name":"{}"}}"#, long_name)))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn create_project_platform_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_long_platform@example.com").await;
        let long_platform = "x".repeat(51);
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(format!(
                r#"{{"name":"Test","platform":"{}"}}"#,
                long_platform
            )))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn create_project_with_platform_and_framework() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_platform@example.com").await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"SDK App","platform":"web","framework":"nextjs"}"#,
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["platform"], "web");
        assert_eq!(json["data"]["framework"], "nextjs");
    }

    // ── get project ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_project_returns_full_api_key() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_get_key@example.com").await;
        let created = create_project(&app, &token, "Full Key Project").await;
        let id = created["data"]["id"].as_str().unwrap();
        let full_key = created["data"]["api_key"].as_str().unwrap();

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}", id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["api_key"].as_str().unwrap(), full_key);
    }

    #[tokio::test]
    async fn get_project_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_get_404@example.com").await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/nonexistent-id")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn get_project_owned_by_other_user_returns_403() {
        let app = make_app().await;
        let token_a = signup_and_token(&app, "proj_owner_a@example.com").await;
        let token_b = signup_and_token(&app, "proj_other_b@example.com").await;
        let created = create_project(&app, &token_a, "Owner A Project").await;
        let id = created["data"]["id"].as_str().unwrap();

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}", id))
            .header("authorization", format!("Bearer {}", token_b))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    // ── update project ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn update_project_name_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_update_name@example.com").await;
        let created = create_project(&app, &token, "Old Name").await;
        let id = created["data"]["id"].as_str().unwrap();

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/projects/{}", id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"New Name"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["name"], "New Name");
    }

    #[tokio::test]
    async fn update_project_platform_and_framework() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_update_sdk@example.com").await;
        let created = create_project(&app, &token, "SDK Project").await;
        let id = created["data"]["id"].as_str().unwrap();

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/projects/{}", id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"platform":"mobile","framework":"flutter"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["platform"], "mobile");
        assert_eq!(json["data"]["framework"], "flutter");
    }

    #[tokio::test]
    async fn update_project_empty_name_returns_422() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_update_empty@example.com").await;
        let created = create_project(&app, &token, "To Update").await;
        let id = created["data"]["id"].as_str().unwrap();

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/projects/{}", id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":""}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn update_project_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_update_404@example.com").await;
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/v1/projects/no-such-project")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"anything"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    // ── delete project ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn delete_project_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_delete@example.com").await;
        let created = create_project(&app, &token, "To Delete").await;
        let id = created["data"]["id"].as_str().unwrap();

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/projects/{}", id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::OK
        );

        // Verify gone
        let req2 = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}", id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req2).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn delete_project_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_delete_404@example.com").await;
        let req = Request::builder()
            .method("DELETE")
            .uri("/api/v1/projects/no-such-id")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    // ── rotate key ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn rotate_key_requires_auth() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/some-id/keys")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn rotate_key_returns_new_key() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_rotate@example.com").await;
        let created = create_project(&app, &token, "Rotate Key Project").await;
        let id = created["data"]["id"].as_str().unwrap();
        let old_key = created["data"]["api_key"].as_str().unwrap().to_string();

        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/keys", id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let new_key = json["data"]["api_key"].as_str().unwrap();
        assert_ne!(new_key, old_key);
        assert!(new_key.starts_with("bw_live_"));
    }

    // ── onboarding ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn complete_onboarding_sets_timestamp() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_onboard@example.com").await;
        let created = create_project(&app, &token, "Onboard Project").await;
        let id = created["data"]["id"].as_str().unwrap();
        assert!(created["data"]["onboarding_completed_at"].is_null());

        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/onboarding/complete", id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(!json["data"]["onboarding_completed_at"].is_null());
    }

    // ── verify events ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn verify_events_returns_waiting_with_no_issues() {
        let app = make_app().await;
        let token = signup_and_token(&app, "proj_verify@example.com").await;
        let created = create_project(&app, &token, "Verify Project").await;
        let id = created["data"]["id"].as_str().unwrap();

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/verify", id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["status"], "waiting");
        assert_eq!(json["data"]["event_count"], 0);
    }
}
