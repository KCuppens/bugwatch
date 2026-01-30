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

    pub async fn update(
        db: &DbPool,
        id: &str,
        content: &str,
    ) -> AppResult<()> {
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE issue_comments
            SET content = $1, updated_at = $2
            WHERE id = $3
            "#,
        )
        .bind(content)
        .bind(now)
        .bind(id)
        .execute(db)
        .await?;

        Ok(())
    }

    pub async fn delete(db: &DbPool, id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM issue_comments WHERE id = $1")
            .bind(id)
            .execute(db)
            .await?;

        Ok(())
    }

    pub async fn count_by_issue(db: &DbPool, issue_id: &str) -> AppResult<i64> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM issue_comments WHERE issue_id = $1",
        )
        .bind(issue_id)
        .fetch_one(db)
        .await?;

        Ok(count.0)
    }
}
