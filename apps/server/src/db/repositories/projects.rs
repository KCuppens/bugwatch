use crate::db::{models::Project, DbPool};
use anyhow::Result;
use uuid::Uuid;

pub struct ProjectRepository;

impl ProjectRepository {
    pub async fn create(
        pool: &DbPool,
        name: &str,
        slug: &str,
        owner_id: &str,
        platform: Option<&str>,
        framework: Option<&str>,
    ) -> Result<Project> {
        let id = Uuid::new_v4().to_string();
        let api_key = format!("bw_live_{}", Uuid::new_v4().to_string().replace("-", ""));

        sqlx::query_as::<_, Project>(
            r#"
            INSERT INTO projects (id, name, slug, api_key, owner_id, platform, framework)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(&api_key)
        .bind(owner_id)
        .bind(platform)
        .bind(framework)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Project>> {
        sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn find_by_api_key(pool: &DbPool, api_key: &str) -> Result<Option<Project>> {
        sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE api_key = $1")
            .bind(api_key)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn find_by_owner(pool: &DbPool, owner_id: &str, limit: i64, offset: i64) -> Result<Vec<Project>> {
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(owner_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn count_by_owner(pool: &DbPool, owner_id: &str) -> Result<i64> {
        let result: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects WHERE owner_id = $1")
            .bind(owner_id)
            .fetch_one(pool)
            .await?;
        Ok(result.0)
    }

    pub async fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<()> {
        sqlx::query("UPDATE projects SET name = $1 WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn rotate_api_key(pool: &DbPool, id: &str) -> Result<String> {
        let new_key = format!("bw_live_{}", Uuid::new_v4().to_string().replace("-", ""));
        sqlx::query("UPDATE projects SET api_key = $1 WHERE id = $2")
            .bind(&new_key)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(new_key)
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM projects WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn update_sdk(
        pool: &DbPool,
        id: &str,
        platform: Option<&str>,
        framework: Option<&str>,
    ) -> Result<()> {
        sqlx::query("UPDATE projects SET platform = $1, framework = $2 WHERE id = $3")
            .bind(platform)
            .bind(framework)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn complete_onboarding(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("UPDATE projects SET onboarding_completed_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
