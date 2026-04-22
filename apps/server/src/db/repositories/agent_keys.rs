use crate::db::{
    models::{AgentAuditLog, AgentKey},
    DbPool,
};
use anyhow::Result;
use uuid::Uuid;

pub struct AgentKeyRepository;

impl AgentKeyRepository {
    /// Create a new agent key
    pub async fn create(
        pool: &DbPool,
        organization_id: &str,
        name: &str,
        key_hash: &str,
        key_prefix: &str,
        permissions: &str,
        created_by: &str,
    ) -> Result<AgentKey> {
        let id = Uuid::new_v4().to_string();

        sqlx::query_as::<_, AgentKey>(
            r#"
            INSERT INTO agent_keys (id, organization_id, name, key_hash, key_prefix, permissions, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(name)
        .bind(key_hash)
        .bind(key_prefix)
        .bind(permissions)
        .bind(created_by)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Find an agent key by its hash (for authentication)
    pub async fn find_by_hash(pool: &DbPool, key_hash: &str) -> Result<Option<AgentKey>> {
        sqlx::query_as::<_, AgentKey>(
            "SELECT * FROM agent_keys WHERE key_hash = $1 AND revoked_at IS NULL",
        )
        .bind(key_hash)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Find an agent key by ID
    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<AgentKey>> {
        sqlx::query_as::<_, AgentKey>("SELECT * FROM agent_keys WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// List all agent keys for an organization
    pub async fn list_by_organization(
        pool: &DbPool,
        organization_id: &str,
    ) -> Result<Vec<AgentKey>> {
        // Hard cap to prevent unbounded scans on organizations with huge key counts.
        sqlx::query_as::<_, AgentKey>(
            "SELECT * FROM agent_keys WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 10000",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Revoke an agent key
    pub async fn revoke(pool: &DbPool, id: &str) -> Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE agent_keys SET revoked_at = $1 WHERE id = $2")
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Update last_used_at timestamp
    pub async fn touch(pool: &DbPool, id: &str) -> Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE agent_keys SET last_used_at = $1 WHERE id = $2")
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

pub struct AgentAuditLogRepository;

impl AgentAuditLogRepository {
    /// Create an audit log entry
    pub async fn create(
        pool: &DbPool,
        agent_key_id: &str,
        action: &str,
        resource_type: Option<&str>,
        resource_id: Option<&str>,
        metadata: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<AgentAuditLog> {
        let id = Uuid::new_v4().to_string();

        sqlx::query_as::<_, AgentAuditLog>(
            r#"
            INSERT INTO agent_audit_log (id, agent_key_id, action, resource_type, resource_id, metadata, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(agent_key_id)
        .bind(action)
        .bind(resource_type)
        .bind(resource_id)
        .bind(metadata)
        .bind(ip_address)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// List audit logs for an agent key
    pub async fn list_by_key(
        pool: &DbPool,
        agent_key_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentAuditLog>> {
        let limit = limit.max(1).min(10_000);
        sqlx::query_as::<_, AgentAuditLog>(
            "SELECT * FROM agent_audit_log WHERE agent_key_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(agent_key_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// List audit logs for an organization (across all keys)
    pub async fn list_by_organization(
        pool: &DbPool,
        organization_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentAuditLog>> {
        let limit = limit.max(1).min(10_000);
        sqlx::query_as::<_, AgentAuditLog>(
            r#"
            SELECT al.* FROM agent_audit_log al
            JOIN agent_keys ak ON al.agent_key_id = ak.id
            WHERE ak.organization_id = $1
            ORDER BY al.created_at DESC
            LIMIT $2
            "#,
        )
        .bind(organization_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}
