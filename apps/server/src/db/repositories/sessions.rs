use crate::db::{models::Session, DbPool};
use anyhow::Result;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

pub struct SessionRepository;

impl SessionRepository {
    pub async fn create(
        pool: &DbPool,
        user_id: &str,
        token: &str,
        expires_at: DateTime<Utc>,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
        jwt_secret: &str,
    ) -> Result<Session> {
        let id = Uuid::new_v4().to_string();
        let token_hash = hash_token(token, jwt_secret.as_bytes());

        sqlx::query_as::<_, Session>(
            r#"
            INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(user_id)
        .bind(&token_hash)
        .bind(expires_at)
        .bind(ip_address)
        .bind(user_agent)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Session>> {
        sqlx::query_as::<_, Session>("SELECT * FROM sessions WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn delete_by_user(pool: &DbPool, user_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE user_id = $1")
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn update_token_hash(
        pool: &DbPool,
        id: &str,
        token: &str,
        jwt_secret: &str,
    ) -> Result<()> {
        let token_hash = hash_token(token, jwt_secret.as_bytes());
        sqlx::query("UPDATE sessions SET token_hash = $1 WHERE id = $2")
            .bind(&token_hash)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Delete all sessions that have passed their `expires_at`.
    /// Returns the number of rows deleted.
    pub async fn delete_expired(pool: &DbPool) -> Result<u64> {
        let result = sqlx::query("DELETE FROM sessions WHERE expires_at < NOW()")
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

/// HMAC-SHA256 keyed on the JWT secret so a leaked token_hash column cannot
/// be used to brute-force session tokens without also knowing the secret.
fn hash_token(token: &str, secret: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts keys of any length");
    mac.update(token.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
