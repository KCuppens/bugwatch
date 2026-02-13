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
        environment: &str,
    ) -> Result<(Issue, bool)> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        // Atomic upsert: INSERT or increment count on fingerprint conflict.
        // This prevents race conditions where two concurrent events with the
        // same fingerprint could both INSERT (the old SELECT-then-INSERT pattern).
        let issue = sqlx::query_as::<_, Issue>(
            r#"
            INSERT INTO issues (id, project_id, fingerprint, title, level, first_seen, last_seen, environment, count)
            VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 1)
            ON CONFLICT (project_id, fingerprint) DO UPDATE
            SET last_seen = $6, count = issues.count + 1, environment = $7
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(fingerprint)
        .bind(title)
        .bind(level)
        .bind(now)
        .bind(environment)
        .fetch_one(pool)
        .await?;

        // count == 1 means we just created it; count > 1 means it already existed
        let is_new = issue.count == 1;
        Ok((issue, is_new))
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
        environment: Option<&str>,
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

        if let Some(e) = environment {
            query.push_str(&format!(" AND environment = ${}", param_idx));
            params.push(e.to_string());
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

        // Environment filter (multiple values)
        if let Some(environments) = &filters.environment {
            if !environments.is_empty() {
                let placeholders: Vec<String> = environments.iter().enumerate().map(|(i, _)| format!("${}", param_idx + i)).collect();
                query.push_str(&format!(" AND environment IN ({})", placeholders.join(",")));
                params.extend(environments.clone());
                param_idx += environments.len();
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

        // Environment filter
        if let Some(environments) = &filters.environment {
            if !environments.is_empty() {
                let placeholders: Vec<String> = environments.iter().enumerate().map(|(i, _)| format!("${}", param_idx + i)).collect();
                query.push_str(&format!(" AND environment IN ({})", placeholders.join(",")));
                params.extend(environments.clone());
                param_idx += environments.len();
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

        // Get environment counts
        let env_rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT environment, COUNT(*) as count FROM issues WHERE project_id = $1 GROUP BY environment"
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let mut environment = std::collections::HashMap::new();
        for (e, c) in env_rows {
            environment.insert(e, c as u32);
        }

        Ok(Facets { level, status, environment })
    }
}

/// Search filters for advanced issue search
#[derive(Debug, Default)]
pub struct SearchFilters {
    pub status: Option<Vec<String>>,
    pub level: Option<Vec<String>>,
    pub environment: Option<Vec<String>>,
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
    pub environment: std::collections::HashMap<String, u32>,
}

/// Statistics for a single project
#[derive(Debug, serde::Serialize)]
pub struct ProjectStats {
    pub project_id: String,
    pub unresolved_count: i64,
    pub total_events: i64,
    pub total_users: i64,
    pub critical_count: i64,
}

impl IssueRepository {
    /// Find issues across multiple projects
    pub async fn find_across_projects(
        pool: &DbPool,
        project_ids: &[String],
        status: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Issue>> {
        if project_ids.is_empty() {
            return Ok(vec![]);
        }

        let mut param_idx = 1;
        let placeholders: Vec<String> = project_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", param_idx + i))
            .collect();
        param_idx += project_ids.len();

        let mut query = format!(
            "SELECT * FROM issues WHERE project_id IN ({})",
            placeholders.join(",")
        );

        if let Some(s) = status {
            query.push_str(&format!(" AND status = ${}", param_idx));
            param_idx += 1;
        }

        query.push_str(&format!(
            " ORDER BY last_seen DESC LIMIT ${} OFFSET ${}",
            param_idx,
            param_idx + 1
        ));

        let mut q = sqlx::query_as::<_, Issue>(&query);
        for pid in project_ids {
            q = q.bind(pid);
        }
        if let Some(s) = status {
            q = q.bind(s);
        }
        q = q.bind(limit).bind(offset);

        q.fetch_all(pool).await.map_err(Into::into)
    }

    /// Count issues across multiple projects
    pub async fn count_across_projects(
        pool: &DbPool,
        project_ids: &[String],
        status: Option<&str>,
    ) -> Result<i64> {
        if project_ids.is_empty() {
            return Ok(0);
        }

        let mut param_idx = 1;
        let placeholders: Vec<String> = project_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", param_idx + i))
            .collect();
        param_idx += project_ids.len();

        let mut query = format!(
            "SELECT COUNT(*) FROM issues WHERE project_id IN ({})",
            placeholders.join(",")
        );

        if let Some(s) = status {
            query.push_str(&format!(" AND status = ${}", param_idx));
        }

        let mut q = sqlx::query_as::<_, (i64,)>(&query);
        for pid in project_ids {
            q = q.bind(pid);
        }
        if let Some(s) = status {
            q = q.bind(s);
        }

        let (count,) = q.fetch_one(pool).await?;
        Ok(count)
    }

    /// Get statistics grouped by project
    pub async fn get_stats_by_project(
        pool: &DbPool,
        project_ids: &[String],
    ) -> Result<Vec<ProjectStats>> {
        if project_ids.is_empty() {
            return Ok(vec![]);
        }

        let placeholders: Vec<String> = project_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 1))
            .collect();

        let query = format!(
            r#"
            SELECT
                project_id,
                COUNT(*) FILTER (WHERE status = 'unresolved') as unresolved_count,
                COALESCE(SUM(count), 0)::BIGINT as total_events,
                COALESCE(SUM(user_count), 0)::BIGINT as total_users,
                COUNT(*) FILTER (WHERE status = 'unresolved' AND (level = 'fatal' OR level = 'error')) as critical_count
            FROM issues
            WHERE project_id IN ({})
            GROUP BY project_id
            "#,
            placeholders.join(",")
        );

        let mut q = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(&query);
        for pid in project_ids {
            q = q.bind(pid);
        }

        let rows = q.fetch_all(pool).await?;

        Ok(rows
            .into_iter()
            .map(|(project_id, unresolved_count, total_events, total_users, critical_count)| {
                ProjectStats {
                    project_id,
                    unresolved_count,
                    total_events,
                    total_users,
                    critical_count,
                }
            })
            .collect())
    }
}
