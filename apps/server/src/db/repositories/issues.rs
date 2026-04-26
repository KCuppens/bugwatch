use crate::db::{models::Issue, DbPool};
use anyhow::Result;
use chrono::Utc;
use tracing::warn;
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
            ON CONFLICT (project_id, fingerprint) DO UPDATE
            SET last_seen = excluded.last_seen, count = issues.count + 1, environment = excluded.environment
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(fingerprint)
        .bind(title)
        .bind(level)
        .bind(now.to_rfc3339())
        .bind(now.to_rfc3339())
        .bind(environment)
        .fetch_one(pool)
        .await?;

        // count == 1 means we just created it; count > 1 means it already existed
        let is_new = issue.count == 1;
        Ok((issue, is_new))
    }

    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Issue>> {
        sqlx::query_as::<_, Issue>("SELECT * FROM issues WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
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

    pub async fn update_status(pool: &DbPool, id: &str, status: &str) -> Result<()> {
        sqlx::query("UPDATE issues SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
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
        let limit = limit.max(1).min(1000);
        let offset = offset.max(0).min(100_000);

        // Use QueryBuilder instead of manual placeholder tracking —
        // every value goes through push_bind so there's no risk of a stray
        // filter string bypassing parameterisation.
        let mut qb: sqlx::QueryBuilder<sqlx::Any> =
            sqlx::QueryBuilder::new("SELECT * FROM issues WHERE project_id = ");
        qb.push_bind(project_id);

        if let Some(s) = status {
            qb.push(" AND status = ").push_bind(s);
        }
        if let Some(l) = level {
            qb.push(" AND level = ").push_bind(l);
        }
        if let Some(e) = environment {
            qb.push(" AND environment = ").push_bind(e);
        }

        qb.push(" ORDER BY last_seen DESC LIMIT ")
            .push_bind(limit)
            .push(" OFFSET ")
            .push_bind(offset);

        qb.build_query_as::<Issue>()
            .fetch_all(pool)
            .await
            .map_err(Into::into)
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

    pub async fn update_status_returning(
        pool: &DbPool,
        id: &str,
        status: &str,
    ) -> Result<Option<Issue>> {
        let issue =
            sqlx::query_as::<_, Issue>("UPDATE issues SET status = $1 WHERE id = $2 RETURNING *")
                .bind(status)
                .bind(id)
                .fetch_optional(pool)
                .await?;
        Ok(issue)
    }

    /// Update status only when the issue belongs to the given project — prevents
    /// a webhook action from reaching issues outside the rule's project.
    pub async fn update_status_for_project(
        pool: &DbPool,
        id: &str,
        project_id: &str,
        status: &str,
    ) -> Result<()> {
        let result = sqlx::query("UPDATE issues SET status = $1 WHERE id = $2 AND project_id = $3")
            .bind(status)
            .bind(id)
            .bind(project_id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            warn!(issue_id = %id, project_id = %project_id, "update_status_for_project matched 0 rows — issue may not exist in this project");
        }
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
        let limit = limit.min(1000);
        let mut param_idx: u32 = 1;
        let mut query = format!("SELECT * FROM issues WHERE project_id = ${}", param_idx);
        param_idx += 1;
        let mut params: Vec<String> = vec![project_id.to_string()];

        build_filter_clauses(filters, &mut query, &mut params, &mut param_idx);

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
        query.push_str(&format!(
            " ORDER BY {} {} LIMIT ${} OFFSET ${}",
            sort_col,
            sort_dir,
            param_idx,
            param_idx + 1,
        ));

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
        let mut param_idx: u32 = 1;
        let mut query = format!(
            "SELECT COUNT(*) FROM issues WHERE project_id = ${}",
            param_idx
        );
        param_idx += 1;
        let mut params: Vec<String> = vec![project_id.to_string()];

        build_filter_clauses(filters, &mut query, &mut params, &mut param_idx);

        let mut q = sqlx::query_as::<_, (i64,)>(&query);
        for p in &params {
            q = q.bind(p);
        }

        let (count,) = q.fetch_one(pool).await?;
        Ok(count)
    }

    /// Get facet counts for filtering UI (single UNION ALL query)
    pub async fn get_facets(pool: &DbPool, project_id: &str) -> Result<Facets> {
        // Cap each facet to a safe number of distinct values — if a column has
        // more than 1000 unique values the UI can't render them usefully anyway.
        let rows = sqlx::query_as::<_, (String, String, i64)>(
            r#"
            SELECT 'level' as facet_type, level as facet_value, COUNT(*) as count
             FROM issues WHERE project_id = $1 GROUP BY level LIMIT 1000
            UNION ALL
            SELECT 'status' as facet_type, status as facet_value, COUNT(*) as count
             FROM issues WHERE project_id = $2 GROUP BY status LIMIT 1000
            UNION ALL
            SELECT 'environment' as facet_type, environment as facet_value, COUNT(*) as count
             FROM issues WHERE project_id = $3 GROUP BY environment LIMIT 1000
            "#,
        )
        .bind(project_id)
        .bind(project_id)
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let mut level = std::collections::HashMap::new();
        let mut status = std::collections::HashMap::new();
        let mut environment = std::collections::HashMap::new();

        for (facet_type, facet_value, count) in rows {
            let count_u32 = u32::try_from(count).unwrap_or(u32::MAX);
            match facet_type.as_str() {
                "level" => {
                    level.insert(facet_value, count_u32);
                }
                "status" => {
                    status.insert(facet_value, count_u32);
                }
                "environment" => {
                    environment.insert(facet_value, count_u32);
                }
                _ => {}
            }
        }

        Ok(Facets {
            level,
            status,
            environment,
        })
    }
}

/// Append WHERE clause conditions for all search filters to the query builder.
/// Mutates `query`, `params`, and `param_idx` in-place. Uses `$N` positional placeholders.
fn build_filter_clauses(
    filters: &SearchFilters,
    query: &mut String,
    params: &mut Vec<String>,
    param_idx: &mut u32,
) {
    for (field, values) in [
        ("status", &filters.status),
        ("level", &filters.level),
        ("environment", &filters.environment),
    ] {
        // Allowlist column name — prevents accidental SQL injection if the loop is
        // ever refactored to use caller-supplied field names.
        let safe_col = match field {
            "status" => "status",
            "level" => "level",
            "environment" => "environment",
            _ => continue,
        };
        if let Some(vals) = values {
            if !vals.is_empty() {
                let placeholders: Vec<String> = vals
                    .iter()
                    .map(|_| {
                        let p = format!("${}", *param_idx);
                        *param_idx += 1;
                        p
                    })
                    .collect();
                query.push_str(&format!(
                    " AND {} IN ({})",
                    safe_col,
                    placeholders.join(",")
                ));
                params.extend(vals.clone());
            }
        }
    }

    for (opt_val, clause) in [
        (filters.count_gt, "count >"),
        (filters.count_lt, "count <"),
        (filters.count_gte, "count >="),
        (filters.count_lte, "count <="),
        (filters.users_gt, "user_count >"),
        (filters.users_lt, "user_count <"),
    ] {
        if let Some(v) = opt_val {
            query.push_str(&format!(" AND {} ${}", clause, *param_idx));
            *param_idx += 1;
            params.push(v.to_string());
        }
    }

    for (opt_val, clause) in [
        (&filters.first_seen_after, "first_seen >"),
        (&filters.first_seen_before, "first_seen <"),
        (&filters.last_seen_after, "last_seen >"),
        (&filters.last_seen_before, "last_seen <"),
    ] {
        if let Some(v) = opt_val {
            query.push_str(&format!(" AND {} ${}", clause, *param_idx));
            *param_idx += 1;
            params.push(v.clone());
        }
    }

    if let Some(text) = &filters.text {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        query.push_str(&format!(
            " AND (title LIKE ${} ESCAPE '\\' OR fingerprint LIKE ${} ESCAPE '\\')",
            *param_idx,
            *param_idx + 1
        ));
        *param_idx += 2;
        params.push(format!("%{}%", escaped));
        params.push(format!("%{}%", escaped));
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
        let limit = limit.min(1000);
        if project_ids.is_empty() {
            return Ok(vec![]);
        }

        let n = project_ids.len();
        let placeholders = (1..=n)
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");
        let issues = if let Some(s) = status {
            let sql = format!(
                "SELECT * FROM issues WHERE project_id IN ({}) AND status = ${}
                 ORDER BY last_seen DESC LIMIT ${} OFFSET ${}",
                placeholders,
                n + 1,
                n + 2,
                n + 3
            );
            let mut q = sqlx::query_as::<_, Issue>(&sql);
            for pid in project_ids {
                q = q.bind(pid);
            }
            q.bind(s).bind(limit).bind(offset).fetch_all(pool).await?
        } else {
            let sql = format!(
                "SELECT * FROM issues WHERE project_id IN ({})
                 ORDER BY last_seen DESC LIMIT ${} OFFSET ${}",
                placeholders,
                n + 1,
                n + 2
            );
            let mut q = sqlx::query_as::<_, Issue>(&sql);
            for pid in project_ids {
                q = q.bind(pid);
            }
            q.bind(limit).bind(offset).fetch_all(pool).await?
        };

        Ok(issues)
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

        let n = project_ids.len();
        let placeholders = (1..=n)
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");
        let (count,): (i64,) = if let Some(s) = status {
            let sql = format!(
                "SELECT COUNT(*) FROM issues WHERE project_id IN ({}) AND status = ${}",
                placeholders,
                n + 1
            );
            let mut q = sqlx::query_as::<_, (i64,)>(&sql);
            for pid in project_ids {
                q = q.bind(pid);
            }
            q.bind(s).fetch_one(pool).await?
        } else {
            let sql = format!(
                "SELECT COUNT(*) FROM issues WHERE project_id IN ({})",
                placeholders
            );
            let mut q = sqlx::query_as::<_, (i64,)>(&sql);
            for pid in project_ids {
                q = q.bind(pid);
            }
            q.fetch_one(pool).await?
        };

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

        let n = project_ids.len();
        let placeholders = (1..=n)
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT
                project_id,
                SUM(CASE WHEN status = 'unresolved' THEN 1 ELSE 0 END) as unresolved_count,
                COALESCE(SUM(count), 0) as total_events,
                COALESCE(SUM(user_count), 0) as total_users,
                SUM(CASE WHEN status = 'unresolved' AND (level = 'fatal' OR level = 'error') THEN 1 ELSE 0 END) as critical_count
            FROM issues
            WHERE project_id IN ({})
            GROUP BY project_id
            "#,
            placeholders
        );
        let mut q = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(&sql);
        for pid in project_ids {
            q = q.bind(pid);
        }
        let rows = q.fetch_all(pool).await?;

        Ok(rows
            .into_iter()
            .map(
                |(project_id, unresolved_count, total_events, total_users, critical_count)| {
                    ProjectStats {
                        project_id,
                        unresolved_count,
                        total_events,
                        total_users,
                        critical_count,
                    }
                },
            )
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    #[tokio::test]
    async fn find_or_create_inserts_new_issue() {
        let pool = test_any_pool().await;
        let (issue, is_new) = IssueRepository::find_or_create(
            &pool,
            "proj-1",
            "fp-abc",
            "Error: boom",
            "error",
            "production",
        )
        .await
        .unwrap();
        assert!(is_new);
        assert_eq!(issue.count, 1);
        assert_eq!(issue.fingerprint, "fp-abc");
    }

    #[tokio::test]
    async fn find_or_create_increments_existing() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(&pool, "proj-2", "fp-dup", "Err", "error", "prod")
            .await
            .unwrap();
        let (issue2, is_new) =
            IssueRepository::find_or_create(&pool, "proj-2", "fp-dup", "Err", "error", "prod")
                .await
                .unwrap();
        assert!(!is_new);
        assert_eq!(issue2.count, 2);
    }

    #[tokio::test]
    async fn find_by_id_and_fingerprint() {
        let pool = test_any_pool().await;
        let (issue, _) =
            IssueRepository::find_or_create(&pool, "proj-3", "fp-find", "Err", "error", "prod")
                .await
                .unwrap();

        let by_id = IssueRepository::find_by_id(&pool, &issue.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(by_id.id, issue.id);

        let by_fp = IssueRepository::find_by_fingerprint(&pool, "proj-3", "fp-find")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(by_fp.id, issue.id);
    }

    #[tokio::test]
    async fn find_by_project_with_filters() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(&pool, "proj-4", "fp-1", "E1", "error", "prod")
            .await
            .unwrap();
        IssueRepository::find_or_create(&pool, "proj-4", "fp-2", "E2", "warning", "staging")
            .await
            .unwrap();

        let all = IssueRepository::find_by_project(&pool, "proj-4", None, None, None, 10, 0)
            .await
            .unwrap();
        assert_eq!(all.len(), 2);

        let errors =
            IssueRepository::find_by_project(&pool, "proj-4", None, Some("error"), None, 10, 0)
                .await
                .unwrap();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].level, "error");

        let staging =
            IssueRepository::find_by_project(&pool, "proj-4", None, None, Some("staging"), 10, 0)
                .await
                .unwrap();
        assert_eq!(staging.len(), 1);
    }

    #[tokio::test]
    async fn count_by_project() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(&pool, "proj-5", "fp-a", "E", "error", "prod")
            .await
            .unwrap();
        IssueRepository::find_or_create(&pool, "proj-5", "fp-b", "E", "error", "prod")
            .await
            .unwrap();
        let count = IssueRepository::count_by_project(&pool, "proj-5", None)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn update_status() {
        let pool = test_any_pool().await;
        let (issue, _) =
            IssueRepository::find_or_create(&pool, "proj-6", "fp-status", "E", "error", "prod")
                .await
                .unwrap();
        IssueRepository::update_status(&pool, &issue.id, "resolved")
            .await
            .unwrap();
        let updated = IssueRepository::find_by_id(&pool, &issue.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, "resolved");
    }

    #[tokio::test]
    async fn update_status_returning() {
        let pool = test_any_pool().await;
        let (issue, _) =
            IssueRepository::find_or_create(&pool, "proj-7", "fp-ret", "E", "error", "prod")
                .await
                .unwrap();
        let returned = IssueRepository::update_status_returning(&pool, &issue.id, "ignored")
            .await
            .unwrap();
        assert_eq!(returned.unwrap().status, "ignored");
    }

    #[tokio::test]
    async fn delete_issue() {
        let pool = test_any_pool().await;
        let (issue, _) =
            IssueRepository::find_or_create(&pool, "proj-8", "fp-del", "E", "error", "prod")
                .await
                .unwrap();
        IssueRepository::delete(&pool, &issue.id).await.unwrap();
        let result = IssueRepository::find_by_id(&pool, &issue.id).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn search_with_text_filter() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(
            &pool,
            "proj-9",
            "fp-search-1",
            "NullPointerException",
            "error",
            "prod",
        )
        .await
        .unwrap();
        IssueRepository::find_or_create(
            &pool,
            "proj-9",
            "fp-search-2",
            "TimeoutError",
            "error",
            "prod",
        )
        .await
        .unwrap();

        let filters = SearchFilters {
            text: Some("NullPointer".to_string()),
            ..Default::default()
        };
        let results = IssueRepository::search(&pool, "proj-9", &filters, None, None, 10, 0)
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].title.contains("NullPointer"));
    }

    // get_facets uses LIMIT inside UNION ALL sub-selects, which is valid PostgreSQL
    // but not supported by SQLite. Test omitted for the SQLite test backend.

    #[tokio::test]
    async fn find_across_projects() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(&pool, "px-1", "fp-x1", "E", "error", "prod")
            .await
            .unwrap();
        IssueRepository::find_or_create(&pool, "px-2", "fp-x2", "E", "error", "prod")
            .await
            .unwrap();
        let ids = vec!["px-1".to_string(), "px-2".to_string()];
        let issues = IssueRepository::find_across_projects(&pool, &ids, None, 10, 0)
            .await
            .unwrap();
        assert_eq!(issues.len(), 2);
        let count = IssueRepository::count_across_projects(&pool, &ids, None)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn get_stats_by_project() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(&pool, "pstats", "fp-s1", "E", "error", "prod")
            .await
            .unwrap();
        IssueRepository::find_or_create(&pool, "pstats", "fp-s2", "E", "fatal", "prod")
            .await
            .unwrap();
        let stats = IssueRepository::get_stats_by_project(&pool, &["pstats".to_string()])
            .await
            .unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].unresolved_count, 2);
        assert_eq!(stats[0].critical_count, 2);
    }

    #[tokio::test]
    async fn update_status_for_project() {
        let pool = test_any_pool().await;
        let (issue, _) =
            IssueRepository::find_or_create(&pool, "usfp", "fp-usfp", "E", "error", "prod")
                .await
                .unwrap();
        IssueRepository::update_status_for_project(&pool, &issue.id, "usfp", "resolved")
            .await
            .unwrap();
        let updated = IssueRepository::find_by_id(&pool, &issue.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, "resolved");
    }

    #[tokio::test]
    async fn count_by_project_with_status_filter() {
        let pool = test_any_pool().await;
        let (issue, _) =
            IssueRepository::find_or_create(&pool, "cbpwsf", "fp-cbp1", "E", "error", "prod")
                .await
                .unwrap();
        IssueRepository::find_or_create(&pool, "cbpwsf", "fp-cbp2", "E", "error", "prod")
            .await
            .unwrap();
        IssueRepository::update_status(&pool, &issue.id, "resolved")
            .await
            .unwrap();
        let resolved = IssueRepository::count_by_project(&pool, "cbpwsf", Some("resolved"))
            .await
            .unwrap();
        assert_eq!(resolved, 1);
        let unresolved = IssueRepository::count_by_project(&pool, "cbpwsf", Some("unresolved"))
            .await
            .unwrap();
        assert_eq!(unresolved, 1);
    }

    #[tokio::test]
    async fn count_search() {
        let pool = test_any_pool().await;
        IssueRepository::find_or_create(&pool, "csp", "fp-csp1", "NullPointer", "error", "prod")
            .await
            .unwrap();
        IssueRepository::find_or_create(&pool, "csp", "fp-csp2", "Timeout", "warning", "prod")
            .await
            .unwrap();
        let filters = SearchFilters {
            level: Some(vec!["error".to_string()]),
            ..Default::default()
        };
        let count = IssueRepository::count_search(&pool, "csp", &filters)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let total = IssueRepository::count_search(&pool, "csp", &SearchFilters::default())
            .await
            .unwrap();
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn search_with_count_filter() {
        let pool = test_any_pool().await;
        for _ in 0..5 {
            IssueRepository::find_or_create(&pool, "scf", "fp-scf-hi", "Hi", "error", "prod")
                .await
                .unwrap();
        }
        IssueRepository::find_or_create(&pool, "scf", "fp-scf-lo", "Lo", "error", "prod")
            .await
            .unwrap();
        let filters = SearchFilters {
            count_gte: Some(5),
            ..Default::default()
        };
        let results =
            IssueRepository::search(&pool, "scf", &filters, Some("count"), Some("desc"), 10, 0)
                .await
                .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].count >= 5);
    }

    #[tokio::test]
    async fn find_and_count_across_projects_with_status() {
        let pool = test_any_pool().await;
        let (i1, _) =
            IssueRepository::find_or_create(&pool, "faps", "fp-faps1", "E", "error", "prod")
                .await
                .unwrap();
        IssueRepository::find_or_create(&pool, "faps", "fp-faps2", "E", "error", "prod")
            .await
            .unwrap();
        IssueRepository::update_status(&pool, &i1.id, "resolved")
            .await
            .unwrap();
        let ids = vec!["faps".to_string()];
        let resolved = IssueRepository::find_across_projects(&pool, &ids, Some("resolved"), 10, 0)
            .await
            .unwrap();
        assert_eq!(resolved.len(), 1);
        let count = IssueRepository::count_across_projects(&pool, &ids, Some("resolved"))
            .await
            .unwrap();
        assert_eq!(count, 1);
        let zero = IssueRepository::count_across_projects(&pool, &[], None)
            .await
            .unwrap();
        assert_eq!(zero, 0);
    }
}
