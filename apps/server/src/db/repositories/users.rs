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

    /// Get user's current credit balance
    pub async fn get_credits(pool: &DbPool, id: &str) -> Result<i32> {
        let row: (i32,) = sqlx::query_as("SELECT credits FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await?;
        Ok(row.0)
    }

    /// Deduct credits from user account
    /// Returns the new credit balance, or error if insufficient credits
    pub async fn deduct_credits(pool: &DbPool, id: &str, amount: i32) -> Result<i32> {
        // First check if user has enough credits
        let current_credits = Self::get_credits(pool, id).await?;
        if current_credits < amount {
            anyhow::bail!("Insufficient credits. Have {}, need {}", current_credits, amount);
        }

        // Deduct credits and return new balance
        let row: (i32,) = sqlx::query_as(
            r#"
            UPDATE users
            SET credits = credits - $1
            WHERE id = $2 AND credits >= $3
            RETURNING credits
            "#,
        )
        .bind(amount)
        .bind(id)
        .bind(amount)
        .fetch_one(pool)
        .await?;

        Ok(row.0)
    }

    /// Add credits to user account
    pub async fn add_credits(pool: &DbPool, id: &str, amount: i32) -> Result<i32> {
        let row: (i32,) = sqlx::query_as(
            r#"
            UPDATE users
            SET credits = credits + $1
            WHERE id = $2
            RETURNING credits
            "#,
        )
        .bind(amount)
        .bind(id)
        .fetch_one(pool)
        .await?;

        Ok(row.0)
    }
}
