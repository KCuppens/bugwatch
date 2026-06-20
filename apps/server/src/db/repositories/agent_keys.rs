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
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Update last_used_at timestamp
    pub async fn touch(pool: &DbPool, id: &str) -> Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE agent_keys SET last_used_at = $1 WHERE id = $2")
            .bind(now)
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

    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        models::{AgentAuditLog, AgentKey},
        test_helpers::test_any_pool,
    };

    async fn make_key(pool: &DbPool, org_id: &str, key_hash: &str) -> AgentKey {
        AgentKeyRepository::create(
            pool,
            org_id,
            "Test Key",
            key_hash,
            "bw_tst_abc",
            r#"["read"]"#,
            "user-1",
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn create_and_find_by_id() {
        let pool = test_any_pool().await;
        let key = make_key(&pool, "org-1", "hash-1").await;
        assert_eq!(key.organization_id, "org-1");
        assert_eq!(key.name, "Test Key");
        let found = AgentKeyRepository::find_by_id(&pool, &key.id)
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, key.id);
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_any_pool().await;
        let result = AgentKeyRepository::find_by_id(&pool, "nonexistent")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_hash_returns_active_key() {
        let pool = test_any_pool().await;
        let key = make_key(&pool, "org-2", "hash-fh").await;
        let found = AgentKeyRepository::find_by_hash(&pool, "hash-fh")
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, key.id);
    }

    #[tokio::test]
    async fn find_by_hash_revoked_returns_none() {
        let pool = test_any_pool().await;
        let key = make_key(&pool, "org-3", "hash-rev").await;
        AgentKeyRepository::revoke(&pool, &key.id).await.unwrap();
        let found = AgentKeyRepository::find_by_hash(&pool, "hash-rev")
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn list_by_organization_scoped() {
        let pool = test_any_pool().await;
        make_key(&pool, "org-list", "h-l-1").await;
        make_key(&pool, "org-list", "h-l-2").await;
        make_key(&pool, "org-other", "h-l-3").await;
        let keys = AgentKeyRepository::list_by_organization(&pool, "org-list")
            .await
            .unwrap();
        assert_eq!(keys.len(), 2);
    }

    #[tokio::test]
    async fn revoke_sets_revoked_at() {
        let pool = test_any_pool().await;
        let key = make_key(&pool, "org-rev", "hash-r2").await;
        assert!(key.revoked_at.is_none());
        AgentKeyRepository::revoke(&pool, &key.id).await.unwrap();
        let updated = AgentKeyRepository::find_by_id(&pool, &key.id)
            .await
            .unwrap()
            .unwrap();
        assert!(updated.revoked_at.is_some());
    }

    #[tokio::test]
    async fn touch_sets_last_used_at() {
        let pool = test_any_pool().await;
        let key = make_key(&pool, "org-touch", "hash-touch").await;
        assert!(key.last_used_at.is_none());
        AgentKeyRepository::touch(&pool, &key.id).await.unwrap();
        let updated = AgentKeyRepository::find_by_id(&pool, &key.id)
            .await
            .unwrap()
            .unwrap();
        assert!(updated.last_used_at.is_some());
    }

    #[tokio::test]
    async fn audit_log_create_and_list_by_key() {
        let pool = test_any_pool().await;
        let key = make_key(&pool, "org-al", "hash-al").await;
        let log: AgentAuditLog = AgentAuditLogRepository::create(
            &pool,
            &key.id,
            "create_issue",
            Some("issue"),
            Some("issue-1"),
            None,
            Some("1.2.3.4"),
        )
        .await
        .unwrap();
        assert_eq!(log.action, "create_issue");
        assert_eq!(log.ip_address.as_deref(), Some("1.2.3.4"));
        let logs = AgentAuditLogRepository::list_by_key(&pool, &key.id, 10)
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].agent_key_id, key.id);
    }

    #[tokio::test]
    async fn audit_log_list_by_organization_across_keys() {
        let pool = test_any_pool().await;
        let k1 = make_key(&pool, "org-al2", "h-al2-1").await;
        let k2 = make_key(&pool, "org-al2", "h-al2-2").await;
        AgentAuditLogRepository::create(&pool, &k1.id, "action_a", None, None, None, None)
            .await
            .unwrap();
        AgentAuditLogRepository::create(&pool, &k2.id, "action_b", None, None, None, None)
            .await
            .unwrap();
        let logs = AgentAuditLogRepository::list_by_organization(&pool, "org-al2", 10)
            .await
            .unwrap();
        assert_eq!(logs.len(), 2);
    }
}
