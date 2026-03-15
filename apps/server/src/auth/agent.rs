use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, HeaderName},
};
use sha2::{Digest, Sha256};

use crate::{
    db::{models::AgentKey, repositories::AgentKeyRepository},
    AppError, AppState,
};

static X_API_KEY: HeaderName = HeaderName::from_static("x-api-key");

/// Agent identity resolved from an agent API key
#[derive(Debug, Clone)]
pub struct AgentAuth {
    pub agent_key: AgentKey,
    pub organization_id: String,
    pub permissions: Vec<String>,
}

impl AgentAuth {
    /// Check if this agent has a specific permission
    pub fn has_permission(&self, permission: &str) -> bool {
        self.permissions.contains(&permission.to_string())
            || self.permissions.contains(&"admin".to_string())
    }
}

/// Hash an agent key using SHA-256
pub fn hash_agent_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a new agent API key
pub fn generate_agent_key() -> String {
    use uuid::Uuid;
    let random = Uuid::new_v4().to_string().replace('-', "")
        + &Uuid::new_v4().to_string().replace('-', "");
    // Take first 40 chars of the random string
    format!("bw_agent_{}", &random[..40])
}

/// Extract the key prefix for display (first 12 chars)
pub fn key_prefix(key: &str) -> String {
    if key.len() >= 12 {
        key[..12].to_string()
    } else {
        key.to_string()
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AgentAuth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Try X-API-Key header first
        let api_key = parts
            .headers
            .get(&X_API_KEY)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .or_else(|| {
                // Fall back to Authorization: Bearer bw_agent_*
                parts
                    .headers
                    .get(AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|h| h.strip_prefix("Bearer "))
                    .filter(|t| t.starts_with("bw_agent_"))
                    .map(|s| s.to_string())
            })
            .ok_or_else(|| {
                AppError::Unauthorized("Missing agent API key".to_string())
            })?;

        // Validate it's an agent key by prefix
        if !api_key.starts_with("bw_agent_") {
            return Err(AppError::Unauthorized("Invalid agent API key format".to_string()));
        }

        // Hash and look up
        let key_hash = hash_agent_key(&api_key);
        let agent_key = AgentKeyRepository::find_by_hash(&state.db, &key_hash)
            .await
            .map_err(|_| AppError::Internal("Failed to validate agent key".to_string()))?
            .ok_or_else(|| AppError::Unauthorized("Invalid or revoked agent API key".to_string()))?;

        // Parse permissions
        let permissions: Vec<String> = serde_json::from_str(&agent_key.permissions)
            .unwrap_or_default();

        let organization_id = agent_key.organization_id.clone();

        // Update last_used_at in background (don't block the request)
        let db = state.db.clone();
        let key_id = agent_key.id.clone();
        tokio::spawn(async move {
            let _ = AgentKeyRepository::touch(&db, &key_id).await;
        });

        Ok(AgentAuth {
            agent_key,
            organization_id,
            permissions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_agent_key_starts_with_prefix() {
        let key = generate_agent_key();
        assert!(key.starts_with("bw_agent_"), "Key should start with bw_agent_, got: {key}");
    }

    #[test]
    fn generate_agent_key_has_correct_length() {
        let key = generate_agent_key();
        assert_eq!(key.len(), 49, "Key should be 49 chars (9 prefix + 40 random), got: {}", key.len());
    }

    #[test]
    fn generate_agent_key_produces_unique_keys() {
        let key1 = generate_agent_key();
        let key2 = generate_agent_key();
        assert_ne!(key1, key2, "Two generated keys should be different");
    }

    #[test]
    fn hash_agent_key_deterministic() {
        let key = "bw_agent_abc123";
        let hash1 = hash_agent_key(key);
        let hash2 = hash_agent_key(key);
        assert_eq!(hash1, hash2, "Same input should produce same hash");
    }

    #[test]
    fn hash_agent_key_different_inputs_different_hashes() {
        let hash1 = hash_agent_key("bw_agent_key1");
        let hash2 = hash_agent_key("bw_agent_key2");
        assert_ne!(hash1, hash2, "Different inputs should produce different hashes");
    }

    #[test]
    fn hash_agent_key_is_64_hex_chars() {
        let hash = hash_agent_key("bw_agent_test");
        assert_eq!(hash.len(), 64, "SHA-256 hex digest should be 64 chars, got: {}", hash.len());
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "Hash should be all hex chars");
    }

    #[test]
    fn key_prefix_returns_first_12_chars() {
        let key = "bw_agent_abc123456789xyz";
        let prefix = key_prefix(key);
        assert_eq!(prefix, "bw_agent_abc");
    }

    #[test]
    fn key_prefix_handles_short_strings() {
        let short = "short";
        let prefix = key_prefix(short);
        assert_eq!(prefix, "short", "Short strings should be returned as-is");
    }
}
