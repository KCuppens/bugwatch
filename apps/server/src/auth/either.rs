use axum::{async_trait, extract::FromRequestParts, http::request::Parts};

use crate::{
    auth::{agent::AgentAuth, middleware::AuthUser},
    db::models::User,
    AppError, AppState,
};

/// Unified auth identity — either a JWT-authenticated user or an agent API key
#[derive(Debug, Clone)]
pub enum AuthIdentity {
    User(User),
    Agent(AgentAuth),
}

/// Extractor that accepts either JWT auth or agent API key auth.
/// Tries JWT first, falls back to agent key.
pub struct EitherAuth(pub AuthIdentity);

impl std::ops::Deref for EitherAuth {
    type Target = AuthIdentity;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AuthIdentity {
    /// Get the user ID (for users) or None (for agents)
    pub fn user_id(&self) -> Option<&str> {
        match self {
            AuthIdentity::User(user) => Some(&user.id),
            AuthIdentity::Agent(_) => None,
        }
    }

    /// Get the organization ID for this identity.
    /// For agents, this is the org the key belongs to.
    /// For users, this must be resolved separately.
    pub fn agent_org_id(&self) -> Option<&str> {
        match self {
            AuthIdentity::User(_) => None,
            AuthIdentity::Agent(agent) => Some(&agent.organization_id),
        }
    }

    /// Check if the agent has a specific permission (always true for users)
    pub fn has_permission(&self, permission: &str) -> bool {
        match self {
            AuthIdentity::User(_) => true,
            AuthIdentity::Agent(agent) => agent.has_permission(permission),
        }
    }

    /// Check if a user/agent has access to a project.
    /// For users: checks owner_id.
    /// For agents: checks if project belongs to agent's organization.
    pub async fn can_access_project(
        &self,
        db: &crate::db::DbPool,
        project: &crate::db::models::Project,
    ) -> bool {
        match self {
            AuthIdentity::User(user) => project.owner_id == user.id,
            AuthIdentity::Agent(agent) => {
                // Check if the project belongs to the agent's organization
                match &project.organization_id {
                    Some(org_id) => org_id == &agent.organization_id,
                    None => {
                        // Fallback: check if project owner is in the agent's org
                        use crate::db::repositories::OrganizationRepository;
                        match OrganizationRepository::find_by_id(db, &agent.organization_id).await {
                            Ok(Some(org)) => project.owner_id == org.owner_id,
                            _ => false,
                        }
                    }
                }
            }
        }
    }
}

#[async_trait]
impl FromRequestParts<AppState> for EitherAuth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Try JWT auth first
        if let Ok(auth_user) = AuthUser::from_request_parts(parts, state).await {
            return Ok(EitherAuth(AuthIdentity::User(auth_user.0.clone())));
        }

        // Try agent auth
        if let Ok(agent_auth) = AgentAuth::from_request_parts(parts, state).await {
            return Ok(EitherAuth(AuthIdentity::Agent(agent_auth)));
        }

        Err(AppError::Unauthorized(
            "Authentication required. Provide a JWT token or agent API key.".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::AgentKey;
    use crate::db::types::{Bool, Timestamp};

    fn make_user() -> User {
        User {
            id: "user-1".to_string(),
            email: "test@example.com".to_string(),
            password_hash: "hash".to_string(),
            name: Some("Test User".to_string()),
            created_at: Timestamp::now(),
            email_verified: Bool(true),
            failed_login_attempts: 0,
            locked_until: None,
        }
    }

    fn make_agent(permissions: Vec<String>) -> AgentAuth {
        AgentAuth {
            agent_key: AgentKey {
                id: "ak-1".to_string(),
                organization_id: "org-1".to_string(),
                name: "Test Agent".to_string(),
                key_hash: "abc123".to_string(),
                key_prefix: "bw_agent_abc".to_string(),
                permissions: serde_json::to_string(&permissions).unwrap(),
                created_by: "user-1".to_string(),
                last_used_at: None,
                created_at: Timestamp::now(),
                revoked_at: None,
            },
            organization_id: "org-1".to_string(),
            permissions,
        }
    }

    #[test]
    fn user_has_permission_always_true() {
        let identity = AuthIdentity::User(make_user());
        assert!(identity.has_permission("read"));
        assert!(identity.has_permission("write"));
        assert!(identity.has_permission("admin"));
        assert!(identity.has_permission("anything"));
    }

    #[test]
    fn agent_with_read_permission() {
        let identity = AuthIdentity::Agent(make_agent(vec!["read".to_string()]));
        assert!(
            identity.has_permission("read"),
            "Agent with read permission should have read access"
        );
        assert!(
            !identity.has_permission("write"),
            "Agent with only read permission should not have write access"
        );
    }

    #[test]
    fn agent_with_admin_permission_implies_all() {
        let identity = AuthIdentity::Agent(make_agent(vec!["admin".to_string()]));
        assert!(identity.has_permission("read"), "Admin should imply read");
        assert!(identity.has_permission("write"), "Admin should imply write");
        assert!(identity.has_permission("admin"), "Admin should imply admin");
        assert!(
            identity.has_permission("anything"),
            "Admin should imply any permission"
        );
    }
}
