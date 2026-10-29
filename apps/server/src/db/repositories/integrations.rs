use crate::db::{
    models::{Integration, IssueLink},
    DbPool,
};
use anyhow::Result;
use uuid::Uuid;

/// Get the encryption key from environment (cached per process).
fn get_encryption_key() -> Option<String> {
    std::env::var("BUGWATCH_ENCRYPTION_KEY").ok()
}

/// Encrypt a token if an encryption key is configured, otherwise return plaintext.
/// Returns an error if encryption is configured but fails (never stores plaintext silently).
fn maybe_encrypt(token: &str) -> Result<String> {
    match get_encryption_key() {
        Some(key) => crate::utils::crypto::encrypt_token(token, &key)
            .map_err(|e| anyhow::anyhow!("Failed to encrypt token: {}", e)),
        None => Ok(token.to_string()),
    }
}

/// Decrypt a token if it was encrypted with `encrypt_token`.
/// Detects encrypted tokens by the `enc:` prefix.
/// Plaintext tokens (legacy, pre-encryption) are returned as-is.
/// Returns an error if a token is encrypted but decryption fails (never returns ciphertext).
fn maybe_decrypt(token: &str) -> Result<String> {
    if !crate::utils::crypto::is_encrypted(token) {
        // Plaintext token (pre-encryption or no encryption configured)
        return Ok(token.to_string());
    }
    match get_encryption_key() {
        Some(key) => crate::utils::crypto::decrypt_token(token, &key)
            .map_err(|e| anyhow::anyhow!("Failed to decrypt token: {}", e)),
        None => {
            // Token is encrypted but no key is configured — cannot decrypt
            Err(anyhow::anyhow!(
                "Token is encrypted but BUGWATCH_ENCRYPTION_KEY is not set"
            ))
        }
    }
}

/// Decrypt integration tokens after reading from DB.
/// Returns an error if any encrypted token fails to decrypt.
fn decrypt_integration(mut integration: Integration) -> Result<Integration> {
    integration.access_token = maybe_decrypt(&integration.access_token)?;
    integration.refresh_token = integration
        .refresh_token
        .map(|t| maybe_decrypt(&t))
        .transpose()?;
    Ok(integration)
}

pub struct IntegrationRepository;

impl IntegrationRepository {
    /// Create a new integration
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &DbPool,
        organization_id: &str,
        provider: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        token_expires_at: Option<chrono::DateTime<chrono::Utc>>,
        external_user_id: Option<&str>,
        external_username: Option<&str>,
        config: &str,
        created_by: &str,
    ) -> Result<Integration> {
        let id = Uuid::new_v4().to_string();
        let encrypted_access = maybe_encrypt(access_token)?;
        let encrypted_refresh = refresh_token.map(maybe_encrypt).transpose()?;

        let integration = sqlx::query_as::<_, Integration>(
            r#"
            INSERT INTO integrations (id, organization_id, provider, access_token, refresh_token, token_expires_at, external_user_id, external_username, config, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (organization_id, provider) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                external_user_id = EXCLUDED.external_user_id,
                external_username = EXCLUDED.external_username,
                config = EXCLUDED.config,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(provider)
        .bind(&encrypted_access)
        .bind(encrypted_refresh.as_deref())
        .bind(token_expires_at)
        .bind(external_user_id)
        .bind(external_username)
        .bind(config)
        .bind(created_by)
        .fetch_one(pool)
        .await?;

        decrypt_integration(integration)
    }

    /// Find an integration by ID
    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Integration>> {
        let result = sqlx::query_as::<_, Integration>("SELECT * FROM integrations WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        result.map(decrypt_integration).transpose()
    }

    /// Find an integration by organization and provider
    pub async fn find_by_org_and_provider(
        pool: &DbPool,
        organization_id: &str,
        provider: &str,
    ) -> Result<Option<Integration>> {
        let result = sqlx::query_as::<_, Integration>(
            "SELECT * FROM integrations WHERE organization_id = $1 AND provider = $2",
        )
        .bind(organization_id)
        .bind(provider)
        .fetch_optional(pool)
        .await?;
        result.map(decrypt_integration).transpose()
    }

    /// List all integrations for an organization
    pub async fn list_by_organization(
        pool: &DbPool,
        organization_id: &str,
    ) -> Result<Vec<Integration>> {
        let results = sqlx::query_as::<_, Integration>(
            "SELECT * FROM integrations WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1000",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await?;
        results.into_iter().map(decrypt_integration).collect()
    }

    /// Delete an integration
    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM integrations WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn update_token(
        pool: &DbPool,
        id: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        token_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<()> {
        let encrypted_access = maybe_encrypt(access_token)?;
        let encrypted_refresh = refresh_token.map(maybe_encrypt).transpose()?;

        let result = sqlx::query(
            r#"
            UPDATE integrations
            SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            "#,
        )
        .bind(&encrypted_access)
        .bind(encrypted_refresh.as_deref())
        .bind(token_expires_at)
        .bind(id)
        .execute(pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(anyhow::anyhow!(
                "Integration not found or could not be updated"
            ));
        }
        Ok(())
    }
}

pub struct IssueLinkRepository;

impl IssueLinkRepository {
    /// Create a new issue link
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &DbPool,
        issue_id: &str,
        integration_id: &str,
        provider: &str,
        external_issue_id: &str,
        external_issue_key: &str,
        external_issue_url: &str,
        external_status: Option<&str>,
    ) -> Result<IssueLink> {
        let id = Uuid::new_v4().to_string();

        sqlx::query_as::<_, IssueLink>(
            r#"
            INSERT INTO issue_links (id, issue_id, integration_id, provider, external_issue_id, external_issue_key, external_issue_url, external_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(issue_id)
        .bind(integration_id)
        .bind(provider)
        .bind(external_issue_id)
        .bind(external_issue_key)
        .bind(external_issue_url)
        .bind(external_status)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// List all links for an issue
    pub async fn list_by_issue(pool: &DbPool, issue_id: &str) -> Result<Vec<IssueLink>> {
        sqlx::query_as::<_, IssueLink>(
            "SELECT * FROM issue_links WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 100",
        )
        .bind(issue_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Find a link by ID
    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<IssueLink>> {
        sqlx::query_as::<_, IssueLink>("SELECT * FROM issue_links WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// Delete a link
    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM issue_links WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Update external status for a link (webhook sync)
    pub async fn update_status(
        pool: &DbPool,
        provider: &str,
        external_issue_id: &str,
        status: &str,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            UPDATE issue_links
            SET external_status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE provider = $2 AND external_issue_id = $3 AND sync_enabled = true
            "#,
        )
        .bind(status)
        .bind(provider)
        .bind(external_issue_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        models::{Integration, IssueLink},
        test_helpers::test_any_pool,
    };

    async fn make_integration(pool: &DbPool, org_id: &str, provider: &str) -> Integration {
        IntegrationRepository::create(
            pool,
            org_id,
            provider,
            "access-token-123",
            Some("refresh-abc"),
            None,
            Some("ext-user-1"),
            Some("jsmith"),
            "{}",
            "user-1",
        )
        .await
        .unwrap()
    }

    async fn make_link(
        pool: &DbPool,
        issue_id: &str,
        integration_id: &str,
        external_id: &str,
    ) -> IssueLink {
        IssueLinkRepository::create(
            pool,
            issue_id,
            integration_id,
            "github",
            external_id,
            "PROJ-1",
            "https://github.com/org/repo/issues/1",
            None,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn create_and_find_by_id() {
        let pool = test_any_pool().await;
        let integ = make_integration(&pool, "org-1", "github").await;
        assert_eq!(integ.provider, "github");
        assert_eq!(integ.access_token, "access-token-123");
        let found = IntegrationRepository::find_by_id(&pool, &integ.id)
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, integ.id);
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_any_pool().await;
        let found = IntegrationRepository::find_by_id(&pool, "nope")
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn find_by_org_and_provider() {
        let pool = test_any_pool().await;
        let integ = make_integration(&pool, "org-2", "jira").await;
        let found = IntegrationRepository::find_by_org_and_provider(&pool, "org-2", "jira")
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, integ.id);
    }

    #[tokio::test]
    async fn list_by_organization_scoped() {
        let pool = test_any_pool().await;
        make_integration(&pool, "org-list", "github").await;
        make_integration(&pool, "org-list", "jira").await;
        make_integration(&pool, "org-other", "github").await;
        let list = IntegrationRepository::list_by_organization(&pool, "org-list")
            .await
            .unwrap();
        assert_eq!(list.len(), 2);
    }

    #[tokio::test]
    async fn delete_integration() {
        let pool = test_any_pool().await;
        let integ = make_integration(&pool, "org-del", "github").await;
        IntegrationRepository::delete(&pool, &integ.id)
            .await
            .unwrap();
        let found = IntegrationRepository::find_by_id(&pool, &integ.id)
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn update_token_changes_access_token() {
        let pool = test_any_pool().await;
        let integ = make_integration(&pool, "org-ut", "github").await;
        IntegrationRepository::update_token(&pool, &integ.id, "new-token", None, None)
            .await
            .unwrap();
        let updated = IntegrationRepository::find_by_id(&pool, &integ.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.access_token, "new-token");
        assert!(updated.refresh_token.is_none());
    }

    #[tokio::test]
    async fn create_upserts_on_conflict() {
        let pool = test_any_pool().await;
        make_integration(&pool, "org-ups", "github").await;
        make_integration(&pool, "org-ups", "github").await;
        let list = IntegrationRepository::list_by_organization(&pool, "org-ups")
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn issue_link_create_and_find_by_id() {
        let pool = test_any_pool().await;
        let link = make_link(&pool, "issue-1", "integ-1", "ext-123").await;
        assert_eq!(link.provider, "github");
        assert_eq!(link.external_issue_id, "ext-123");
        assert!(*link.sync_enabled);
        let found = IssueLinkRepository::find_by_id(&pool, &link.id)
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, link.id);
    }

    #[tokio::test]
    async fn issue_link_list_by_issue() {
        let pool = test_any_pool().await;
        make_link(&pool, "issue-list", "integ-1", "ext-a").await;
        make_link(&pool, "issue-other", "integ-2", "ext-b").await;
        let links = IssueLinkRepository::list_by_issue(&pool, "issue-list")
            .await
            .unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].issue_id, "issue-list");
    }

    #[tokio::test]
    async fn issue_link_delete() {
        let pool = test_any_pool().await;
        let link = make_link(&pool, "issue-del", "integ-del", "ext-del").await;
        IssueLinkRepository::delete(&pool, &link.id).await.unwrap();
        let found = IssueLinkRepository::find_by_id(&pool, &link.id)
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn issue_link_update_status() {
        let pool = test_any_pool().await;
        make_link(&pool, "issue-us", "integ-us", "ext-us-1").await;
        let affected = IssueLinkRepository::update_status(&pool, "github", "ext-us-1", "closed")
            .await
            .unwrap();
        assert_eq!(affected, 1);
    }
}
