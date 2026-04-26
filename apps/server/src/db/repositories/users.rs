use crate::db::{models::User, DbPool};
use anyhow::Result;
use uuid::Uuid;

pub struct UserRepository;

impl UserRepository {
    pub async fn create(
        pool: &DbPool,
        email: &str,
        password_hash: &str,
        name: Option<&str>,
    ) -> Result<User> {
        let id = Uuid::new_v4().to_string();

        sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (id, email, password_hash, name)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(email)
        .bind(password_hash)
        .bind(name)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<User>> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// Batch-load users by IDs in a single query.
    pub async fn find_by_ids(pool: &DbPool, ids: &[String]) -> Result<Vec<User>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!("SELECT * FROM users WHERE id IN ({})", placeholders);
        let mut q = sqlx::query_as::<_, User>(&query);
        for id in ids {
            q = q.bind(id);
        }
        q.fetch_all(pool).await.map_err(Into::into)
    }

    pub async fn find_by_email(pool: &DbPool, email: &str) -> Result<Option<User>> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn increment_failed_attempts(pool: &DbPool, id: &str) -> Result<()> {
        let mut tx = pool.begin().await?;

        // Calculate lockout time in Rust to avoid DB-specific interval syntax
        let locked_until_str = (chrono::Utc::now() + chrono::Duration::minutes(15)).to_rfc3339();

        sqlx::query(
            r#"
            -- threshold 5: see handle_login in api/auth.rs
            UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE
                    -- Lock after 5th failed attempt (pre-increment value >= 4 ≡ post-increment >= 5)
                    WHEN failed_login_attempts >= 4
                    THEN $1
                    ELSE locked_until
                END
            WHERE id = $2
            "#,
        )
        .bind(&locked_until_str)
        .bind(id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn reset_failed_attempts(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1",
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<()> {
        sqlx::query("UPDATE users SET name = $1 WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn update_password(pool: &DbPool, id: &str, password_hash: &str) -> Result<()> {
        sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
            .bind(password_hash)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    #[tokio::test]
    async fn create_and_find_by_id() {
        let pool = test_any_pool().await;
        let user = UserRepository::create(&pool, "a@example.com", "hash1", Some("Alice"))
            .await
            .unwrap();
        assert_eq!(user.email, "a@example.com");
        assert_eq!(user.name.as_deref(), Some("Alice"));
        assert!(!*user.email_verified);

        let found = UserRepository::find_by_id(&pool, &user.id).await.unwrap();
        assert_eq!(found.unwrap().id, user.id);
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_any_pool().await;
        let result = UserRepository::find_by_id(&pool, "nonexistent")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_email() {
        let pool = test_any_pool().await;
        UserRepository::create(&pool, "b@example.com", "hash2", None)
            .await
            .unwrap();
        let found = UserRepository::find_by_email(&pool, "b@example.com")
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().email, "b@example.com");
    }

    #[tokio::test]
    async fn find_by_email_missing_returns_none() {
        let pool = test_any_pool().await;
        let result = UserRepository::find_by_email(&pool, "nobody@example.com")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_ids_batch() {
        let pool = test_any_pool().await;
        let u1 = UserRepository::create(&pool, "c1@example.com", "h", None)
            .await
            .unwrap();
        let u2 = UserRepository::create(&pool, "c2@example.com", "h", None)
            .await
            .unwrap();
        let ids = vec![u1.id.clone(), u2.id.clone()];
        let users = UserRepository::find_by_ids(&pool, &ids).await.unwrap();
        assert_eq!(users.len(), 2);
    }

    #[tokio::test]
    async fn find_by_ids_empty_returns_empty() {
        let pool = test_any_pool().await;
        let users = UserRepository::find_by_ids(&pool, &[]).await.unwrap();
        assert!(users.is_empty());
    }

    #[tokio::test]
    async fn update_name() {
        let pool = test_any_pool().await;
        let user = UserRepository::create(&pool, "d@example.com", "h", Some("Old"))
            .await
            .unwrap();
        UserRepository::update_name(&pool, &user.id, "New Name")
            .await
            .unwrap();
        let updated = UserRepository::find_by_id(&pool, &user.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.name.as_deref(), Some("New Name"));
    }

    #[tokio::test]
    async fn update_password() {
        let pool = test_any_pool().await;
        let user = UserRepository::create(&pool, "e@example.com", "old_hash", None)
            .await
            .unwrap();
        UserRepository::update_password(&pool, &user.id, "new_hash")
            .await
            .unwrap();
        let updated = UserRepository::find_by_id(&pool, &user.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.password_hash, "new_hash");
    }

    #[tokio::test]
    async fn increment_and_reset_failed_attempts() {
        let pool = test_any_pool().await;
        let user = UserRepository::create(&pool, "f@example.com", "h", None)
            .await
            .unwrap();
        assert_eq!(user.failed_login_attempts, 0);

        UserRepository::increment_failed_attempts(&pool, &user.id)
            .await
            .unwrap();
        let after = UserRepository::find_by_id(&pool, &user.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.failed_login_attempts, 1);

        UserRepository::reset_failed_attempts(&pool, &user.id)
            .await
            .unwrap();
        let reset = UserRepository::find_by_id(&pool, &user.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reset.failed_login_attempts, 0);
        assert!(reset.locked_until.is_none());
    }

    #[tokio::test]
    async fn lockout_after_five_failed_attempts() {
        let pool = test_any_pool().await;
        let user = UserRepository::create(&pool, "g@example.com", "h", None)
            .await
            .unwrap();
        for _ in 0..5 {
            UserRepository::increment_failed_attempts(&pool, &user.id)
                .await
                .unwrap();
        }
        let locked = UserRepository::find_by_id(&pool, &user.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(locked.failed_login_attempts, 5);
        assert!(
            locked.locked_until.is_some(),
            "user should be locked after 5 failed attempts"
        );
    }
}
