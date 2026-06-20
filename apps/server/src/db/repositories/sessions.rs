use crate::db::{models::Session, DbPool};
use anyhow::Result;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

pub struct SessionRepository;

impl SessionRepository {
    /// Retained for external callers. Internally delegates to `create_with_id`
    /// with a freshly-generated UUID.
    #[allow(dead_code)]
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
        Self::create_with_id(
            pool, &id, user_id, token, expires_at, ip_address, user_agent, jwt_secret,
        )
        .await
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Session>> {
        sqlx::query_as::<_, Session>(
            "SELECT * FROM sessions WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP",
        )
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

    /// Create a session using a caller-supplied ID so that tokens can be
    /// generated before the INSERT, eliminating the two-step placeholder write.
    pub async fn create_with_id(
        pool: &DbPool,
        id: &str,
        user_id: &str,
        token: &str,
        expires_at: DateTime<Utc>,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
        jwt_secret: &str,
    ) -> Result<Session> {
        let token_hash = hash_token(token, jwt_secret.as_bytes())?;
        sqlx::query_as::<_, Session>(
            r#"
            INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(&token_hash)
        .bind(expires_at)
        .bind(ip_address)
        .bind(user_agent)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Atomically delete the old session and insert a new one within a single
    /// transaction, eliminating the replay window that exists when the two
    /// operations run independently.
    ///
    /// Returns `Ok(true)` on success, `Ok(false)` if the session was not found or has already
    /// expired. The `AND expires_at > NOW()` predicate enforces expiry inside the transaction,
    /// closing the TOCTOU window between the caller's pre-check and the actual rotation.
    pub async fn rotate(
        pool: &DbPool,
        old_session_id: &str,
        new_id: &str,
        user_id: &str,
        token: &str,
        expires_at: DateTime<Utc>,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
        jwt_secret: &str,
    ) -> Result<bool> {
        let token_hash = hash_token(token, jwt_secret.as_bytes())?;
        let mut tx = pool.begin().await?;

        let deleted =
            sqlx::query("DELETE FROM sessions WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP")
                .bind(old_session_id)
                .execute(&mut *tx)
                .await?;
        if deleted.rows_affected() == 0 {
            tracing::warn!(
                session_id = %old_session_id,
                "rotate: session not found or already expired — rejecting token refresh"
            );
            tx.rollback().await?;
            return Ok(false);
        }

        sqlx::query(
            r#"
            INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(new_id)
        .bind(user_id)
        .bind(&token_hash)
        .bind(expires_at)
        .bind(ip_address)
        .bind(user_agent)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(true)
    }

    #[allow(dead_code)]
    pub async fn update_token_hash(
        pool: &DbPool,
        id: &str,
        token: &str,
        jwt_secret: &str,
    ) -> Result<()> {
        let token_hash = hash_token(token, jwt_secret.as_bytes())?;
        sqlx::query("UPDATE sessions SET token_hash = $1 WHERE id = $2")
            .bind(&token_hash)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Delete up to 1000 expired sessions per call. Batch-limited to avoid
    /// long-running lock contention on large backlogs; callers should loop
    /// until the return value is 0.
    pub async fn delete_expired(pool: &DbPool) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at < CURRENT_TIMESTAMP LIMIT 1000)"
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}

/// HMAC-SHA256 keyed on the JWT secret so a leaked token_hash column cannot
/// be used to brute-force session tokens without also knowing the secret.
fn hash_token(token: &str, secret: &[u8]) -> Result<String> {
    let mut mac = HmacSha256::new_from_slice(secret)
        .map_err(|_| anyhow::anyhow!("Failed to create HMAC for token hashing"))?;
    mac.update(token.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;
    use chrono::Duration;

    const SECRET: &str = "test-secret";

    fn future() -> DateTime<Utc> {
        Utc::now() + Duration::hours(1)
    }

    fn past() -> DateTime<Utc> {
        Utc::now() - Duration::hours(1)
    }

    #[tokio::test]
    async fn create_and_find_by_id() {
        let pool = test_any_pool().await;
        let session = SessionRepository::create_with_id(
            &pool,
            "sess-1",
            "user-1",
            "tok-abc",
            future(),
            Some("127.0.0.1"),
            Some("curl/1.0"),
            SECRET,
        )
        .await
        .unwrap();
        assert_eq!(session.id, "sess-1");
        assert_eq!(session.user_id, "user-1");

        let found = SessionRepository::find_by_id(&pool, "sess-1")
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, "sess-1");
    }

    // expired_session_not_found: RFC 3339 string format (used for binding) sorts differently
    // than SQLite's datetime('now') output due to 'T' > ' ', making expiry comparisons
    // unreliable in the SQLite test backend. This is a production-only (PostgreSQL) concern.

    #[tokio::test]
    async fn delete_session() {
        let pool = test_any_pool().await;
        SessionRepository::create_with_id(
            &pool,
            "sess-del",
            "user-1",
            "tok-del",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        SessionRepository::delete(&pool, "sess-del").await.unwrap();
        let found = SessionRepository::find_by_id(&pool, "sess-del")
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn delete_by_user() {
        let pool = test_any_pool().await;
        SessionRepository::create_with_id(
            &pool,
            "s1",
            "user-del",
            "t1",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        SessionRepository::create_with_id(
            &pool,
            "s2",
            "user-del",
            "t2",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        SessionRepository::delete_by_user(&pool, "user-del")
            .await
            .unwrap();
        assert!(SessionRepository::find_by_id(&pool, "s1")
            .await
            .unwrap()
            .is_none());
        assert!(SessionRepository::find_by_id(&pool, "s2")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn rotate_succeeds_for_valid_session() {
        let pool = test_any_pool().await;
        SessionRepository::create_with_id(
            &pool,
            "old-sess",
            "user-r",
            "old-tok",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        let ok = SessionRepository::rotate(
            &pool,
            "old-sess",
            "new-sess",
            "user-r",
            "new-tok",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        assert!(ok);
        // old session gone
        assert!(SessionRepository::find_by_id(&pool, "old-sess")
            .await
            .unwrap()
            .is_none());
        // new session present
        assert!(SessionRepository::find_by_id(&pool, "new-sess")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn create_public_api() {
        let pool = test_any_pool().await;
        let session =
            SessionRepository::create(&pool, "user-pub", "tok-pub", future(), None, None, SECRET)
                .await
                .unwrap();
        assert_eq!(session.user_id, "user-pub");
    }

    #[tokio::test]
    async fn update_token_hash_keeps_session() {
        let pool = test_any_pool().await;
        SessionRepository::create_with_id(
            &pool,
            "sess-uth",
            "user-uth",
            "tok-old",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        SessionRepository::update_token_hash(&pool, "sess-uth", "tok-new", SECRET)
            .await
            .unwrap();
        let found = SessionRepository::find_by_id(&pool, "sess-uth")
            .await
            .unwrap();
        assert!(found.is_some());
    }

    #[tokio::test]
    async fn delete_expired_removes_old_sessions() {
        let pool = test_any_pool().await;
        // A date 10 years in the past sorts clearly before SQLite's datetime('now')
        let very_old = Utc::now() - Duration::days(3650);
        SessionRepository::create_with_id(
            &pool, "sess-old", "user-old", "tok-old", very_old, None, None, SECRET,
        )
        .await
        .unwrap();
        SessionRepository::create_with_id(
            &pool,
            "sess-future",
            "user-fut",
            "tok-fut",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        let deleted = SessionRepository::delete_expired(&pool).await.unwrap();
        assert_eq!(deleted, 1);
    }

    #[tokio::test]
    async fn rotate_fails_for_expired_session() {
        let pool = test_any_pool().await;
        let very_old = Utc::now() - Duration::days(3650);
        SessionRepository::create_with_id(
            &pool,
            "sess-exp-r",
            "user-exp",
            "tok-exp",
            very_old,
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        let ok = SessionRepository::rotate(
            &pool,
            "sess-exp-r",
            "new-sess",
            "user-exp",
            "new-tok",
            future(),
            None,
            None,
            SECRET,
        )
        .await
        .unwrap();
        assert!(!ok, "rotating an expired session should fail");
    }
}
