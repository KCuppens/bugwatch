use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};

use super::ApiResponse;
use crate::{
    auth::{
        agent::{generate_agent_key, hash_agent_key, key_prefix},
        AuthUser,
    },
    db::repositories::{
        AgentAuditLogRepository, AgentKeyRepository, OrganizationMemberRepository,
        OrganizationRepository,
    },
    AppError, AppResult, AppState,
};

#[derive(Debug, Serialize)]
pub struct AgentKeyResponse {
    pub id: String,
    pub organization_id: String,
    pub name: String,
    pub key_prefix: String,
    pub permissions: Vec<String>,
    pub created_by: String,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentKeyCreatedResponse {
    pub id: String,
    pub name: String,
    pub key: String, // Full key, only shown once at creation
    pub key_prefix: String,
    pub permissions: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct AuditLogResponse {
    pub id: String,
    pub agent_key_id: String,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub ip_address: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentKeyRequest {
    pub name: String,
    #[serde(default = "default_permissions")]
    pub permissions: Vec<String>,
}

fn default_permissions() -> Vec<String> {
    vec!["read".to_string()]
}

/// POST /api/v1/agent-keys — Create a new agent API key (JWT auth required)
pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateAgentKeyRequest>,
) -> AppResult<Json<ApiResponse<AgentKeyCreatedResponse>>> {
    // Rate limit: 10 create_agent_key requests per user
    let rl = state
        .rate_limiter
        .check(&format!("create_agent_key:{}", auth_user.id), 10);
    if !rl.allowed {
        return Err(AppError::BadRequest(
            "Too many requests. Please try again later.".to_string(),
        ));
    }

    // Validate name
    if req.name.trim().is_empty() {
        return Err(AppError::Validation("Key name cannot be empty".to_string()));
    }
    if req.name.len() > 100 {
        return Err(AppError::Validation(
            "Key name too long (max 100 characters)".to_string(),
        ));
    }

    // Validate permissions
    if req.permissions.len() > 10 {
        return Err(AppError::BadRequest(
            "Too many permissions (max 10)".to_string(),
        ));
    }
    // B4: deduplicate permissions before validation and storage
    let mut seen = std::collections::HashSet::new();
    let permissions: Vec<String> = req
        .permissions
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect();
    let valid_permissions = ["read", "write", "admin"];
    for perm in &permissions {
        if !valid_permissions.contains(&perm.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid permission '{}'. Valid: read, write, admin",
                perm
            )));
        }
    }

    // Get user's organization
    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(
                "You must belong to an organization to create agent keys".to_string(),
            )
        })?;

    // Only org owner can create agent keys
    if org.owner_id != auth_user.id {
        return Err(AppError::Forbidden(
            "Only the organization owner can manage agent keys".to_string(),
        ));
    }

    // Generate the key
    let raw_key = generate_agent_key();
    let hash = hash_agent_key(&raw_key, state.config.jwt_secret.as_bytes());
    let prefix = key_prefix(&raw_key);
    let permissions_json = serde_json::to_string(&permissions)
        .map_err(|_| AppError::Internal("Failed to serialize permissions".to_string()))?;

    let agent_key = AgentKeyRepository::create(
        &state.db,
        &org.id,
        &req.name,
        &hash,
        &prefix,
        &permissions_json,
        &auth_user.id,
    )
    .await?;

    // Audit log: key created
    let _ = AgentAuditLogRepository::create(
        &state.db,
        &agent_key.id,
        "agent_key.created",
        Some("agent_key"),
        Some(&agent_key.id),
        Some(&serde_json::json!({"name": req.name, "permissions": permissions}).to_string()),
        None,
    )
    .await;

    Ok(Json(ApiResponse {
        data: AgentKeyCreatedResponse {
            id: agent_key.id,
            name: agent_key.name,
            key: raw_key, // Only returned once!
            key_prefix: agent_key.key_prefix,
            permissions,
            created_at: agent_key.created_at.to_rfc3339(),
        },
    }))
}

/// GET /api/v1/agent-keys — List all agent keys for the organization
pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> AppResult<Json<ApiResponse<Vec<AgentKeyResponse>>>> {
    crate::api::enforce_rate_limit(
        &state,
        &format!("agent_keys_list:user:{}", auth_user.id),
        30,
    )?;

    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    let keys = AgentKeyRepository::list_by_organization(&state.db, &org.id).await?;

    let response: Vec<AgentKeyResponse> = keys
        .into_iter()
        .map(|k| {
            let permissions: Vec<String> = serde_json::from_str(&k.permissions).unwrap_or_default();
            AgentKeyResponse {
                id: k.id,
                organization_id: k.organization_id,
                name: k.name,
                key_prefix: k.key_prefix,
                permissions,
                created_by: k.created_by,
                last_used_at: k.last_used_at.map(|dt| dt.to_rfc3339()),
                created_at: k.created_at.to_rfc3339(),
                revoked_at: k.revoked_at.map(|dt| dt.to_rfc3339()),
            }
        })
        .collect();

    Ok(Json(ApiResponse { data: response }))
}

/// DELETE /api/v1/agent-keys/:key_id — Revoke an agent key
pub async fn revoke(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(key_id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    crate::api::enforce_rate_limit(
        &state,
        &format!("agent_keys_revoke:user:{}", auth_user.id),
        10,
    )?;

    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    // Only org owner can revoke keys
    if org.owner_id != auth_user.id {
        return Err(AppError::Forbidden(
            "Only the organization owner can manage agent keys".to_string(),
        ));
    }

    let key = AgentKeyRepository::find_by_id(&state.db, &key_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Agent key not found".to_string()))?;

    // Verify key belongs to the user's organization
    if key.organization_id != org.id {
        return Err(AppError::Forbidden("Agent key not found".to_string()));
    }

    AgentKeyRepository::revoke(&state.db, &key_id).await?;

    // Audit log: key revoked
    let _ = AgentAuditLogRepository::create(
        &state.db,
        &key_id,
        "agent_key.revoked",
        Some("agent_key"),
        Some(&key_id),
        Some(&serde_json::json!({"name": key.name, "revoked_by": auth_user.id}).to_string()),
        None,
    )
    .await;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Agent key revoked successfully" }),
    }))
}

/// GET /api/v1/agent-keys/:key_id/audit-log — Get audit log for an agent key
pub async fn audit_log(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(key_id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<AuditLogResponse>>>> {
    crate::api::enforce_rate_limit(
        &state,
        &format!("agent_keys_audit:user:{}", auth_user.id),
        30,
    )?;

    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    // Audit logs are sensitive (keystroke of agent activity). Restrict to org
    // owner or an `admin` member — matches the owner/admin RBAC pattern used
    // in billing.rs (invite/remove members).
    let caller_member =
        OrganizationMemberRepository::find_by_user_in_org(&state.db, &org.id, &auth_user.id)
            .await?;
    let can_view =
        org.owner_id == auth_user.id || caller_member.map(|m| m.role == "admin").unwrap_or(false);
    if !can_view {
        return Err(AppError::Forbidden(
            "Only owner or admin can view agent key audit logs".to_string(),
        ));
    }

    let key = AgentKeyRepository::find_by_id(&state.db, &key_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Agent key not found".to_string()))?;

    if key.organization_id != org.id {
        return Err(AppError::Forbidden("Agent key not found".to_string()));
    }

    let logs = AgentAuditLogRepository::list_by_key(&state.db, &key_id, 100).await?;

    let response: Vec<AuditLogResponse> = logs
        .into_iter()
        .map(|l| AuditLogResponse {
            id: l.id,
            agent_key_id: l.agent_key_id,
            action: l.action,
            resource_type: l.resource_type,
            resource_id: l.resource_id,
            metadata: l.metadata.and_then(|m| serde_json::from_str(&m).ok()),
            ip_address: l.ip_address,
            created_at: l.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(ApiResponse { data: response }))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
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

    // ── auth guards ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_keys_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/agent-keys")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn create_key_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"test","permissions":["read"]}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn revoke_key_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("DELETE")
            .uri("/api/v1/agent-keys/some-id")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn audit_log_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/agent-keys/some-id/audit-log")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── create and list flow ──────────────────────────────────────────────────

    #[tokio::test]
    async fn list_keys_without_org_returns_400() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_list@example.com").await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/agent-keys")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        // User exists but has no org — handler returns 400
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn create_key_without_org_returns_error() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_create@example.com").await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"my-key","permissions":["read"]}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        // No org exists yet for this fresh user
        let status = resp.status();
        assert!(
            status == StatusCode::BAD_REQUEST
                || status == StatusCode::NOT_FOUND
                || status == StatusCode::FORBIDDEN,
            "expected 4xx without org, got {}",
            status
        );
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    async fn create_org(app: &axum::Router, token: &str) {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/organization")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Test Org"}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert!(
            resp.status().is_success(),
            "org creation failed: {}",
            resp.status()
        );
    }

    async fn create_agent_key(app: &axum::Router, token: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"my-key","permissions":["read","write"]}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "create key failed");
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        json["data"]["id"].as_str().unwrap().to_string()
    }

    // ── happy paths ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn create_key_succeeds() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_happy@example.com").await;
        create_org(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"my-key","permissions":["read","write"]}"#,
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["name"], "my-key");
        assert!(json["data"]["key"].as_str().is_some());
        assert!(json["data"]["key_prefix"].as_str().is_some());
    }

    #[tokio::test]
    async fn list_keys_returns_created_key() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_list2@example.com").await;
        create_org(&app, &token).await;
        create_agent_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/agent-keys")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let keys = json["data"].as_array().unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0]["name"], "my-key");
    }

    #[tokio::test]
    async fn revoke_key_succeeds() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_revoke@example.com").await;
        create_org(&app, &token).await;
        let key_id = create_agent_key(&app, &token).await;

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/agent-keys/{}", key_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn revoke_key_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_revoke404@example.com").await;
        create_org(&app, &token).await;

        let req = Request::builder()
            .method("DELETE")
            .uri("/api/v1/agent-keys/nonexistent-id")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn audit_log_returns_entries_after_create() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_audit@example.com").await;
        create_org(&app, &token).await;
        let key_id = create_agent_key(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/agent-keys/{}/audit-log", key_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let logs = json["data"].as_array().unwrap();
        assert!(!logs.is_empty(), "audit log should have at least one entry");
        assert_eq!(logs[0]["action"], "agent_key.created");
    }

    #[tokio::test]
    async fn audit_log_key_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_audit404@example.com").await;
        create_org(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/agent-keys/nonexistent-id/audit-log")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // ── validation ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn create_key_empty_name_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_emptyname@example.com").await;
        create_org(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"   ","permissions":["read"]}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn create_key_name_too_long_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_longname@example.com").await;
        create_org(&app, &token).await;

        let long_name = "x".repeat(101);
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(format!(
                r#"{{"name":"{}","permissions":["read"]}}"#,
                long_name
            )))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn create_key_invalid_permission_returns_422() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "agentkeys_badperm@example.com").await;
        create_org(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/agent-keys")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"bad-perm-key","permissions":["superuser"]}"#,
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}
