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
    db::repositories::{AgentAuditLogRepository, AgentKeyRepository, OrganizationRepository},
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
    let valid_permissions = ["read", "write", "admin"];
    for perm in &req.permissions {
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
    let permissions_json = serde_json::to_string(&req.permissions)
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
        Some(&serde_json::json!({"name": req.name, "permissions": req.permissions}).to_string()),
        None,
    )
    .await;

    Ok(Json(ApiResponse {
        data: AgentKeyCreatedResponse {
            id: agent_key.id,
            name: agent_key.name,
            key: raw_key, // Only returned once!
            key_prefix: agent_key.key_prefix,
            permissions: req.permissions,
            created_at: agent_key.created_at.to_rfc3339(),
        },
    }))
}

/// GET /api/v1/agent-keys — List all agent keys for the organization
pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> AppResult<Json<ApiResponse<Vec<AgentKeyResponse>>>> {
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
    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

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
