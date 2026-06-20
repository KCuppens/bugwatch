use crate::db::DbPool;
use chrono::Utc;
use uuid::Uuid;

use crate::db::models::IssueComment;
use crate::AppResult;

pub struct CommentRepository;

impl CommentRepository {
    pub async fn find_by_issue(
        db: &DbPool,
        issue_id: &str,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<IssueComment>> {
        // Clamp user-supplied pagination to safe bounds.
        let limit = limit.max(1).min(1000);
        let offset = offset.max(0).min(100_000);

        let comments = sqlx::query_as::<_, IssueComment>(
            r#"
            SELECT id, issue_id, user_id, content, created_at, updated_at
            FROM issue_comments
            WHERE issue_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(issue_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await?;

        Ok(comments)
    }

    pub async fn find_by_id(db: &DbPool, id: &str) -> AppResult<Option<IssueComment>> {
        let comment = sqlx::query_as::<_, IssueComment>(
            r#"
            SELECT id, issue_id, user_id, content, created_at, updated_at
            FROM issue_comments
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(db)
        .await?;

        Ok(comment)
    }

    pub async fn create(
        db: &DbPool,
        issue_id: &str,
        user_id: &str,
        content: &str,
    ) -> AppResult<IssueComment> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        let comment = sqlx::query_as::<_, IssueComment>(
            r#"
            INSERT INTO issue_comments (id, issue_id, user_id, content, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(issue_id)
        .bind(user_id)
        .bind(content)
        .bind(now)
        .bind(now)
        .fetch_one(db)
        .await?;

        Ok(comment)
    }

    pub async fn update(db: &DbPool, id: &str, issue_id: &str, content: &str) -> AppResult<()> {
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE issue_comments
            SET content = $1, updated_at = $2
            WHERE id = $3 AND issue_id = $4
            "#,
        )
        .bind(content)
        .bind(now)
        .bind(id)
        .bind(issue_id)
        .execute(db)
        .await?;

        Ok(())
    }

    pub async fn delete(db: &DbPool, id: &str, issue_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM issue_comments WHERE id = $1 AND issue_id = $2")
            .bind(id)
            .bind(issue_id)
            .execute(db)
            .await?;

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn count_by_issue(db: &DbPool, issue_id: &str) -> AppResult<i64> {
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM issue_comments WHERE issue_id = $1")
                .bind(issue_id)
                .fetch_one(db)
                .await?;

        Ok(count.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    #[tokio::test]
    async fn create_and_find_comment() {
        let pool = test_any_pool().await;
        let comment = CommentRepository::create(&pool, "issue-1", "user-1", "Great catch!")
            .await
            .unwrap();
        assert_eq!(comment.content, "Great catch!");
        assert_eq!(comment.issue_id, "issue-1");

        let found = CommentRepository::find_by_id(&pool, &comment.id)
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, comment.id);
    }

    #[tokio::test]
    async fn find_by_issue_and_count() {
        let pool = test_any_pool().await;
        CommentRepository::create(&pool, "issue-2", "user-1", "First")
            .await
            .unwrap();
        CommentRepository::create(&pool, "issue-2", "user-2", "Second")
            .await
            .unwrap();

        let comments = CommentRepository::find_by_issue(&pool, "issue-2", 10, 0)
            .await
            .unwrap();
        assert_eq!(comments.len(), 2);

        let count = CommentRepository::count_by_issue(&pool, "issue-2")
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn update_comment() {
        let pool = test_any_pool().await;
        let comment = CommentRepository::create(&pool, "issue-3", "user-1", "Original")
            .await
            .unwrap();
        CommentRepository::update(&pool, &comment.id, "issue-3", "Updated content")
            .await
            .unwrap();
        let updated = CommentRepository::find_by_id(&pool, &comment.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.content, "Updated content");
    }

    #[tokio::test]
    async fn delete_comment() {
        let pool = test_any_pool().await;
        let comment = CommentRepository::create(&pool, "issue-4", "user-1", "To delete")
            .await
            .unwrap();
        CommentRepository::delete(&pool, &comment.id, "issue-4")
            .await
            .unwrap();
        let result = CommentRepository::find_by_id(&pool, &comment.id)
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_any_pool().await;
        let result = CommentRepository::find_by_id(&pool, "nonexistent")
            .await
            .unwrap();
        assert!(result.is_none());
    }
}
