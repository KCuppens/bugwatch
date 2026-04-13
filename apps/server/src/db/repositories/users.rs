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

    pub async fn find_by_email(pool: &DbPool, email: &str) -> Result<Option<User>> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn increment_failed_attempts(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE
                    WHEN failed_login_attempts >= 4
                    THEN NOW() + INTERVAL '15 minutes'
                    ELSE locked_until
                END
            WHERE id = $1
            "#,
        )
        .bind(id)
        .execute(pool)
        .await?;
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
