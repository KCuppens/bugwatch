use crate::db::{models::LogSavedSearch, DbPool};
use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

pub struct LogSavedSearchRepository;

impl LogSavedSearchRepository {
    /// Create a new saved search for a project+user.
    pub async fn create(
        pool: &DbPool,
        project_id: &str,
        user_id: &str,
        name: &str,
        filters: &serde_json::Value,
    ) -> Result<LogSavedSearch> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let filters_str = filters.to_string();

        sqlx::query_as::<_, LogSavedSearch>(
            r#"
            INSERT INTO log_saved_searches (id, project_id, user_id, name, filters, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(user_id)
        .bind(name)
        .bind(&filters_str)
        .bind(now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// List all saved searches for a project, newest first.
    pub async fn list(pool: &DbPool, project_id: &str) -> Result<Vec<LogSavedSearch>> {
        sqlx::query_as::<_, LogSavedSearch>(
            r#"
            SELECT * FROM log_saved_searches
            WHERE project_id = $1
            ORDER BY created_at DESC
            LIMIT 500
            "#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Delete a saved search by id, scoped to project_id for tenant safety.
    /// Returns `true` if a row was deleted.
    pub async fn delete(pool: &DbPool, id: &str, project_id: &str) -> Result<bool> {
        let result =
            sqlx::query("DELETE FROM log_saved_searches WHERE id = $1 AND project_id = $2")
                .bind(id)
                .bind(project_id)
                .execute(pool)
                .await?;
        Ok(result.rows_affected() > 0)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    fn filters() -> serde_json::Value {
        serde_json::json!({"level": "error", "search": "timeout"})
    }

    #[tokio::test]
    async fn create_and_list_saved_search() {
        let pool = test_any_pool().await;
        let search = LogSavedSearchRepository::create(
            &pool,
            "proj-ss-1",
            "user-ss-1",
            "My Errors",
            &filters(),
        )
        .await
        .unwrap();
        assert_eq!(search.name, "My Errors");
        assert_eq!(search.project_id, "proj-ss-1");

        let list = LogSavedSearchRepository::list(&pool, "proj-ss-1")
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, search.id);
    }

    #[tokio::test]
    async fn list_is_scoped_to_project() {
        let pool = test_any_pool().await;
        LogSavedSearchRepository::create(&pool, "proj-ss-a", "user-1", "Search A", &filters())
            .await
            .unwrap();
        LogSavedSearchRepository::create(&pool, "proj-ss-b", "user-1", "Search B", &filters())
            .await
            .unwrap();

        let list_a = LogSavedSearchRepository::list(&pool, "proj-ss-a")
            .await
            .unwrap();
        assert_eq!(list_a.len(), 1);
        assert_eq!(list_a[0].name, "Search A");

        let list_b = LogSavedSearchRepository::list(&pool, "proj-ss-b")
            .await
            .unwrap();
        assert_eq!(list_b.len(), 1);
        assert_eq!(list_b[0].name, "Search B");
    }

    #[tokio::test]
    async fn delete_saved_search_returns_true() {
        let pool = test_any_pool().await;
        let search =
            LogSavedSearchRepository::create(&pool, "proj-ss-2", "user-2", "To Delete", &filters())
                .await
                .unwrap();

        let deleted = LogSavedSearchRepository::delete(&pool, &search.id, "proj-ss-2")
            .await
            .unwrap();
        assert!(deleted);

        let list = LogSavedSearchRepository::list(&pool, "proj-ss-2")
            .await
            .unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn delete_wrong_project_returns_false() {
        let pool = test_any_pool().await;
        let search =
            LogSavedSearchRepository::create(&pool, "proj-ss-3", "user-3", "Keeper", &filters())
                .await
                .unwrap();

        // Wrong project_id — should not delete
        let deleted = LogSavedSearchRepository::delete(&pool, &search.id, "proj-ss-wrong")
            .await
            .unwrap();
        assert!(!deleted);

        // Row still exists
        let list = LogSavedSearchRepository::list(&pool, "proj-ss-3")
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn delete_nonexistent_returns_false() {
        let pool = test_any_pool().await;
        let deleted = LogSavedSearchRepository::delete(&pool, "nonexistent-id", "proj-ss-4")
            .await
            .unwrap();
        assert!(!deleted);
    }
}
