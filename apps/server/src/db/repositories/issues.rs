use crate::db::{models::Issue, DbPool};
use anyhow::Result;
use chrono::{DateTime, Utc};
use uuid::Uuid;

pub struct IssueRepository;

impl IssueRepository {
    pub async fn find_or_create(
        pool: &DbPool,
        project_id: &str,
        fingerprint: &str,
        title: &str,
        level: &str,
    ) -> Result<(Issue, bool)> {
        // Try to find existing issue
        if let Some(mut issue) = Self::find_by_fingerprint(pool, project_id, fingerprint).await? {
            // Update existing issue
            let now = Utc::now();
            sqlx::query(
                r#"
                UPDATE issues
                SET last_seen = $1, count = count + 1
                WHERE id = $2
                "#,
            )
            .bind(now)
            .bind(&issue.id)
            .execute(pool)
            .await?;

            issue.last_seen = now;
            issue.count += 1;
            return Ok((issue, false));
        }

        // Create new issue
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        let issue = sqlx::query_as::<_, Issue>(
            r#"
            INSERT INTO issues (id, project_id, fingerprint, title, level, first_seen, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(fingerprint)
        .bind(title)
        .bind(level)
        .bind(now)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok((issue, true))
    }

    pub async fn find_by_fingerprint(
        pool: &DbPool,
        project_id: &str,
        fingerprint: &str,
    ) -> Result<Option<Issue>> {
        sqlx::query_as::<_, Issue>(
            "SELECT * FROM issues WHERE project_id = $1 AND fingerprint = $2",
        )
        .bind(project_id)
        .bind(fingerprint)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Issue>> {
        sqlx::query_as::<_, Issue>("SELECT * FROM issues WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    pub async fn find_by_project(
        pool: &DbPool,
        project_id: &str,
        status: Option<&str>,
        level: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Issue>> {
        let mut param_idx = 2;
        let mut query = String::from("SELECT * FROM issues WHERE project_id = $1");
        let mut params: Vec<String> = vec![project_id.to_string()];

        if let Some(s) = status {
            query.push_str(&format!(" AND status = ${}", param_idx));
            params.push(s.to_string());
            param_idx += 1;
        }

        if let Some(l) = level {
            query.push_str(&format!(" AND level = ${}", param_idx));
            params.push(l.to_string());
            param_idx += 1;
        }

        query.push_str(&format!(" ORDER BY last_seen DESC LIMIT ${} OFFSET ${}", param_idx, param_idx + 1));

        let mut q = sqlx::query_as::<_, Issue>(&query);
        for p in &params {
            q = q.bind(p);
        }
        q = q.bind(limit).bind(offset);

        q.fetch_all(pool).await.map_err(Into::into)
    }

    pub async fn count_by_project(
        pool: &DbPool,
        project_id: &str,
        status: Option<&str>,
    ) -> Result<i64> {
        let (count,): (i64,) = if let Some(s) = status {
            sqlx::query_as("SELECT COUNT(*) FROM issues WHERE project_id = $1 AND status = $2")
                .bind(project_id)
                .bind(s)
                .fetch_one(pool)
                .await?
        } else {
            sqlx::query_as("SELECT COUNT(*) FROM issues WHERE project_id = $1")
                .bind(project_id)
                .fetch_one(pool)
                .await?
        };
        Ok(count)
    }

    pub async fn update_status(pool: &DbPool, id: &str, status: &str) -> Result<()> {
        sqlx::query("UPDATE issues SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn delete(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM issues WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Advanced search with multiple filters
    pub async fn search(
        pool: &DbPool,
        project_id: &str,
        filters: &SearchFilters,
        sort_field: Option<&str>,
        sort_direction: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Issue>> {
        let mut param_idx = 2;
        let mut query = String::from("SELECT * FROM issues WHERE project_id = $1");
        let mut params: Vec<String> = vec![project_id.to_string()];

        // Status filter (multiple values)
        if let Some(statuses) = &filters.status {
            if !statuses.is_empty() {
                let placeholders: Vec<String> = statuses.iter().enumerate().map(|(i, _)| format!("${}", param_idx + i)).collect();
                query.push_str(&format!(" AND status IN ({})", placeholders.join(",")));
                params.extend(statuses.clone());
                param_idx += statuses.len();
            }
        }

        // Level filter (multiple values)
        if let Some(levels) = &filters.level {
            if !levels.is_empty() {
                let placeholders: Vec<String> = levels.iter().enumerate().map(|(i, _)| format!("${}", param_idx + i)).collect();
                query.push_str(&format!(" AND level IN ({})", placeholders.join(",")));
                params.extend(levels.clone());
                param_idx += levels.len();
            }
        }

        // Count filters
        if let Some(v) = filters.count_gt {
            query.push_str(&format!(" AND count > ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.count_lt {
            query.push_str(&format!(" AND count < ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.count_gte {
            query.push_str(&format!(" AND count >= ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.count_lte {
            query.push_str(&format!(" AND count <= ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }

        // Users filters
        if let Some(v) = filters.users_gt {
            query.push_str(&format!(" AND user_count > ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.users_lt {
            query.push_str(&format!(" AND user_count < ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }

        // Date filters
        if let Some(v) = &filters.first_seen_after {
            query.push_str(&format!(" AND first_seen > ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }
        if let Some(v) = &filters.first_seen_before {
            query.push_str(&format!(" AND first_seen < ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }
        if let Some(v) = &filters.last_seen_after {
            query.push_str(&format!(" AND last_seen > ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }
        if let Some(v) = &filters.last_seen_before {
            query.push_str(&format!(" AND last_seen < ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }

        // Text search (title and fingerprint)
        if let Some(text) = &filters.text {
            query.push_str(&format!(" AND (title LIKE ${} OR fingerprint LIKE ${})", param_idx, param_idx + 1));
            params.push(format!("%{}%", text));
            params.push(format!("%{}%", text));
            param_idx += 2;
        }

        // Sorting
        let sort_col = match sort_field {
            Some("count") => "count",
            Some("users") => "user_count",
            Some("first_seen") => "first_seen",
            _ => "last_seen",
        };
        let sort_dir = match sort_direction {
            Some("asc") => "ASC",
            _ => "DESC",
        };
        query.push_str(&format!(" ORDER BY {} {} LIMIT ${} OFFSET ${}", sort_col, sort_dir, param_idx, param_idx + 1));

        let mut q = sqlx::query_as::<_, Issue>(&query);
        for p in &params {
            q = q.bind(p);
        }
        q = q.bind(limit).bind(offset);

        q.fetch_all(pool).await.map_err(Into::into)
    }

    /// Count issues matching search filters
    pub async fn count_search(
        pool: &DbPool,
        project_id: &str,
        filters: &SearchFilters,
    ) -> Result<i64> {
        let mut param_idx = 2;
        let mut query = String::from("SELECT COUNT(*) FROM issues WHERE project_id = $1");
        let mut params: Vec<String> = vec![project_id.to_string()];

        // Status filter
        if let Some(statuses) = &filters.status {
            if !statuses.is_empty() {
                let placeholders: Vec<String> = statuses.iter().enumerate().map(|(i, _)| format!("${}", param_idx + i)).collect();
                query.push_str(&format!(" AND status IN ({})", placeholders.join(",")));
                params.extend(statuses.clone());
                param_idx += statuses.len();
            }
        }

        // Level filter
        if let Some(levels) = &filters.level {
            if !levels.is_empty() {
                let placeholders: Vec<String> = levels.iter().enumerate().map(|(i, _)| format!("${}", param_idx + i)).collect();
                query.push_str(&format!(" AND level IN ({})", placeholders.join(",")));
                params.extend(levels.clone());
                param_idx += levels.len();
            }
        }

        // Count filters (all variants for consistency with search)
        if let Some(v) = filters.count_gt {
            query.push_str(&format!(" AND count > ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.count_lt {
            query.push_str(&format!(" AND count < ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.count_gte {
            query.push_str(&format!(" AND count >= ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.count_lte {
            query.push_str(&format!(" AND count <= ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }

        // Users filters
        if let Some(v) = filters.users_gt {
            query.push_str(&format!(" AND user_count > ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }
        if let Some(v) = filters.users_lt {
            query.push_str(&format!(" AND user_count < ${}", param_idx));
            params.push(v.to_string());
            param_idx += 1;
        }

        // Date filters (all variants for consistency with search)
        if let Some(v) = &filters.first_seen_after {
            query.push_str(&format!(" AND first_seen > ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }
        if let Some(v) = &filters.first_seen_before {
            query.push_str(&format!(" AND first_seen < ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }
        if let Some(v) = &filters.last_seen_after {
            query.push_str(&format!(" AND last_seen > ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }
        if let Some(v) = &filters.last_seen_before {
            query.push_str(&format!(" AND last_seen < ${}", param_idx));
            params.push(v.clone());
            param_idx += 1;
        }

        // Text search
        if let Some(text) = &filters.text {
            query.push_str(&format!(" AND (title LIKE ${} OR fingerprint LIKE ${})", param_idx, param_idx + 1));
            params.push(format!("%{}%", text));
            params.push(format!("%{}%", text));
        }

        let mut q = sqlx::query_as::<_, (i64,)>(&query);
        for p in &params {
            q = q.bind(p);
        }

        let (count,) = q.fetch_one(pool).await?;
        Ok(count)
    }

    /// Get facet counts for filtering UI
    pub async fn get_facets(
        pool: &DbPool,
        project_id: &str,
    ) -> Result<Facets> {
        // Get level counts
        let level_rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT level, COUNT(*) as count FROM issues WHERE project_id = $1 GROUP BY level"
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let mut level = std::collections::HashMap::new();
        for (l, c) in level_rows {
            level.insert(l, c as u32);
        }

        // Get status counts
        let status_rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT status, COUNT(*) as count FROM issues WHERE project_id = $1 GROUP BY status"
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let mut status = std::collections::HashMap::new();
        for (s, c) in status_rows {
            status.insert(s, c as u32);
        }

        Ok(Facets { level, status })
    }
}

/// Search filters for advanced issue search
#[derive(Debug, Default)]
pub struct SearchFilters {
    pub status: Option<Vec<String>>,
    pub level: Option<Vec<String>>,
    pub count_gt: Option<i64>,
    pub count_lt: Option<i64>,
    pub count_gte: Option<i64>,
    pub count_lte: Option<i64>,
    pub users_gt: Option<i64>,
    pub users_lt: Option<i64>,
    pub first_seen_after: Option<String>,
    pub first_seen_before: Option<String>,
    pub last_seen_after: Option<String>,
    pub last_seen_before: Option<String>,
    pub text: Option<String>,
}

/// Facet counts for filtering UI
#[derive(Debug, serde::Serialize)]
pub struct Facets {
    pub level: std::collections::HashMap<String, u32>,
    pub status: std::collections::HashMap<String, u32>,
}
