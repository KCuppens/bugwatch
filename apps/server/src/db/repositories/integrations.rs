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
                updated_at = NOW()
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

    /// Update access token (for token refresh)
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
            SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
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
            SET external_status = $1, updated_at = NOW()
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
