use crate::db::{models::Project, DbPool};
use anyhow::Result;
use dashmap::DashMap;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

const PROJECT_CACHE_TTL: Duration = Duration::from_secs(300);

fn project_cache() -> &'static DashMap<String, (Project, Instant)> {
    static CACHE: OnceLock<DashMap<String, (Project, Instant)>> = OnceLock::new();
    CACHE.get_or_init(DashMap::new)
}

/// Compute SHA-256 hash of an API key for constant-time lookups
fn hash_api_key(api_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(api_key.as_bytes());
    hex::encode(hasher.finalize())
}

pub struct ProjectRepository;

#[allow(dead_code)]
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
        let api_key_hash = hash_api_key(&api_key);

        sqlx::query_as::<_, Project>(
            r#"
            INSERT INTO projects (id, name, slug, api_key, api_key_hash, owner_id, platform, framework)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(&api_key)
        .bind(&api_key_hash)
        .bind(owner_id)
        .bind(platform)
        .bind(framework)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Insert a new project using an existing connection (e.g., inside a transaction).
    /// Callers are responsible for committing or rolling back the transaction.
    pub async fn create_in_tx(
        conn: &mut sqlx::AnyConnection,
        name: &str,
        slug: &str,
        owner_id: &str,
        platform: Option<&str>,
        framework: Option<&str>,
    ) -> Result<Project> {
        let id = Uuid::new_v4().to_string();
        let api_key = format!("bw_live_{}", Uuid::new_v4().to_string().replace("-", ""));
        let api_key_hash = hash_api_key(&api_key);

        sqlx::query_as::<_, Project>(
            r#"
            INSERT INTO projects (id, name, slug, api_key, api_key_hash, owner_id, platform, framework)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(&api_key)
        .bind(&api_key_hash)
        .bind(owner_id)
        .bind(platform)
        .bind(framework)
        .fetch_one(conn)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Project>> {
        if let Some(entry) = project_cache().get(id) {
            let (project, inserted_at) = entry.value();
            if inserted_at.elapsed() < PROJECT_CACHE_TTL {
                return Ok(Some(project.clone()));
            }
        }

        let result = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;

        if let Some(ref project) = result {
            project_cache().insert(id.to_string(), (project.clone(), Instant::now()));
        }

        Ok(result)
    }

    pub async fn find_by_api_key(pool: &DbPool, api_key: &str) -> Result<Option<Project>> {
        // Use hash-based lookup for constant-time comparison
        let key_hash = hash_api_key(api_key);
        sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE api_key_hash = $1")
            .bind(&key_hash)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn find_by_owner(
        pool: &DbPool,
        owner_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Project>> {
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

    /// Find projects by organization ID (for agent key access)
    pub async fn find_by_organization(
        pool: &DbPool,
        organization_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Project>> {
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(organization_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Count projects by organization ID
    pub async fn count_by_organization(pool: &DbPool, organization_id: &str) -> Result<i64> {
        let result: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM projects WHERE organization_id = $1")
                .bind(organization_id)
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
        project_cache().remove(id);
        Ok(())
    }

    pub async fn rotate_api_key(pool: &DbPool, id: &str) -> Result<String> {
        let new_key = format!("bw_live_{}", Uuid::new_v4().to_string().replace("-", ""));
        let new_hash = hash_api_key(&new_key);
        sqlx::query("UPDATE projects SET api_key = $1, api_key_hash = $2 WHERE id = $3")
            .bind(&new_key)
            .bind(&new_hash)
            .bind(id)
            .execute(pool)
            .await?;
        project_cache().remove(id);
        Ok(new_key)
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM projects WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        project_cache().remove(id);
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
        project_cache().remove(id);
        Ok(())
    }

    pub async fn complete_onboarding(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE projects SET onboarding_completed_at = CURRENT_TIMESTAMP WHERE id = $1",
        )
        .bind(id)
        .execute(pool)
        .await?;
        project_cache().remove(id);
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
        let p = ProjectRepository::create(
            &pool,
            "My App",
            "my-app",
            "owner-1",
            Some("web"),
            Some("nextjs"),
        )
        .await
        .unwrap();
        assert_eq!(p.name, "My App");
        assert_eq!(p.slug, "my-app");
        assert_eq!(p.owner_id, "owner-1");
        assert!(p.api_key.starts_with("bw_live_"));

        let found = ProjectRepository::find_by_id(&pool, &p.id).await.unwrap();
        assert_eq!(found.unwrap().id, p.id);
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_any_pool().await;
        let result = ProjectRepository::find_by_id(&pool, "no-such-id")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_api_key() {
        let pool = test_any_pool().await;
        let p = ProjectRepository::create(&pool, "App", "app-slug", "owner-2", None, None)
            .await
            .unwrap();
        let found = ProjectRepository::find_by_api_key(&pool, &p.api_key)
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, p.id);
    }

    #[tokio::test]
    async fn find_by_api_key_wrong_key_returns_none() {
        let pool = test_any_pool().await;
        let result = ProjectRepository::find_by_api_key(&pool, "bw_live_bogus")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_owner_and_count() {
        let pool = test_any_pool().await;
        ProjectRepository::create(&pool, "P1", "p1", "owner-3", None, None)
            .await
            .unwrap();
        ProjectRepository::create(&pool, "P2", "p2", "owner-3", None, None)
            .await
            .unwrap();
        ProjectRepository::create(&pool, "Other", "other", "owner-4", None, None)
            .await
            .unwrap();

        let projects = ProjectRepository::find_by_owner(&pool, "owner-3", 10, 0)
            .await
            .unwrap();
        assert_eq!(projects.len(), 2);

        let count = ProjectRepository::count_by_owner(&pool, "owner-3")
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn update_name() {
        let pool = test_any_pool().await;
        let p = ProjectRepository::create(&pool, "Old Name", "update-slug", "owner-5", None, None)
            .await
            .unwrap();
        ProjectRepository::update_name(&pool, &p.id, "New Name")
            .await
            .unwrap();
        let updated = ProjectRepository::find_by_id(&pool, &p.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.name, "New Name");
    }

    #[tokio::test]
    async fn rotate_api_key() {
        let pool = test_any_pool().await;
        let p = ProjectRepository::create(&pool, "App", "rotate-slug", "owner-6", None, None)
            .await
            .unwrap();
        let old_key = p.api_key.clone();
        let new_key = ProjectRepository::rotate_api_key(&pool, &p.id)
            .await
            .unwrap();
        assert_ne!(new_key, old_key);
        assert!(new_key.starts_with("bw_live_"));
        // Old key should no longer work
        let found = ProjectRepository::find_by_api_key(&pool, &old_key)
            .await
            .unwrap();
        assert!(found.is_none());
        // New key should work
        let found_new = ProjectRepository::find_by_api_key(&pool, &new_key)
            .await
            .unwrap();
        assert!(found_new.is_some());
    }

    #[tokio::test]
    async fn delete() {
        let pool = test_any_pool().await;
        let p = ProjectRepository::create(&pool, "To Delete", "del-slug", "owner-7", None, None)
            .await
            .unwrap();
        ProjectRepository::delete(&pool, &p.id).await.unwrap();
        let result = ProjectRepository::find_by_id(&pool, &p.id).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn update_sdk() {
        let pool = test_any_pool().await;
        let p = ProjectRepository::create(&pool, "App", "sdk-slug", "owner-8", None, None)
            .await
            .unwrap();
        ProjectRepository::update_sdk(&pool, &p.id, Some("mobile"), Some("flutter"))
            .await
            .unwrap();
        let updated = ProjectRepository::find_by_id(&pool, &p.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.platform.as_deref(), Some("mobile"));
        assert_eq!(updated.framework.as_deref(), Some("flutter"));
    }
}
