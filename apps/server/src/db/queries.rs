use super::models::*;
use super::DbPool;
use anyhow::Result;
use sqlx::Row;

// ============================================================================
// User Queries
// ============================================================================

pub async fn create_user(
    pool: &DbPool,
    id: &str,
    email: &str,
    password_hash: &str,
    name: Option<&str>,
) -> Result<User> {
    sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (id, email, password_hash, name)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(email)
    .bind(password_hash)
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn get_user_by_id(pool: &DbPool, id: &str) -> Result<Option<User>> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn get_user_by_email(pool: &DbPool, email: &str) -> Result<Option<User>> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn update_user_login_attempts(
    pool: &DbPool,
    id: &str,
    attempts: i32,
    locked_until: Option<&str>,
) -> Result<()> {
    sqlx::query("UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3")
        .bind(attempts)
        .bind(locked_until)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// Session Queries
// ============================================================================

pub async fn create_session(
    pool: &DbPool,
    id: &str,
    user_id: &str,
    token_hash: &str,
    expires_at: &str,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
) -> Result<Session> {
    sqlx::query_as::<_, Session>(
        r#"
        INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(ip_address)
    .bind(user_agent)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn get_session_by_token_hash(pool: &DbPool, token_hash: &str) -> Result<Option<Session>> {
    sqlx::query_as::<_, Session>("SELECT * FROM sessions WHERE token_hash = $1")
        .bind(token_hash)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn delete_session(pool: &DbPool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_user_sessions(pool: &DbPool, user_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// Project Queries
// ============================================================================

pub async fn create_project(
    pool: &DbPool,
    id: &str,
    name: &str,
    slug: &str,
    api_key: &str,
    owner_id: &str,
) -> Result<Project> {
    sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (id, name, slug, api_key, owner_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(slug)
    .bind(api_key)
    .bind(owner_id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn get_project_by_id(pool: &DbPool, id: &str) -> Result<Option<Project>> {
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn get_project_by_api_key(pool: &DbPool, api_key: &str) -> Result<Option<Project>> {
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE api_key = $1")
        .bind(api_key)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn get_projects_by_owner(
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

pub async fn count_projects_by_owner(pool: &DbPool, owner_id: &str) -> Result<i64> {
    let row = sqlx::query("SELECT COUNT(*) as count FROM projects WHERE owner_id = $1")
        .bind(owner_id)
        .fetch_one(pool)
        .await?;
    Ok(row.get("count"))
}

pub async fn update_project(pool: &DbPool, id: &str, name: &str) -> Result<Project> {
    sqlx::query_as::<_, Project>(
        "UPDATE projects SET name = $1 WHERE id = $2 RETURNING *",
    )
    .bind(name)
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn update_project_api_key(pool: &DbPool, id: &str, api_key: &str) -> Result<Project> {
    sqlx::query_as::<_, Project>(
        "UPDATE projects SET api_key = $1 WHERE id = $2 RETURNING *",
    )
    .bind(api_key)
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn delete_project(pool: &DbPool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM projects WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// Issue Queries
// ============================================================================

pub async fn create_issue(
    pool: &DbPool,
    id: &str,
    project_id: &str,
    fingerprint: &str,
    title: &str,
    level: &str,
    timestamp: &str,
) -> Result<Issue> {
    sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (id, project_id, fingerprint, title, level, first_seen, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(project_id)
    .bind(fingerprint)
    .bind(title)
    .bind(level)
    .bind(timestamp)
    .bind(timestamp)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn get_issue_by_id(pool: &DbPool, id: &str) -> Result<Option<Issue>> {
    sqlx::query_as::<_, Issue>("SELECT * FROM issues WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn get_issue_by_fingerprint(
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

pub async fn get_issues_by_project(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
    level: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<Issue>> {
    // Build query with proper PostgreSQL placeholders
    let mut param_idx = 2;
    let mut query = String::from("SELECT * FROM issues WHERE project_id = $1");

    if status.is_some() {
        query.push_str(&format!(" AND status = ${}", param_idx));
        param_idx += 1;
    }
    if level.is_some() {
        query.push_str(&format!(" AND level = ${}", param_idx));
        param_idx += 1;
    }

    query.push_str(&format!(" ORDER BY last_seen DESC LIMIT ${} OFFSET ${}", param_idx, param_idx + 1));

    let mut q = sqlx::query_as::<_, Issue>(&query).bind(project_id);

    if let Some(s) = status {
        q = q.bind(s);
    }
    if let Some(l) = level {
        q = q.bind(l);
    }

    q.bind(limit).bind(offset).fetch_all(pool).await.map_err(Into::into)
}

pub async fn count_issues_by_project(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
    level: Option<&str>,
) -> Result<i64> {
    // Build query with proper PostgreSQL placeholders
    let mut param_idx = 2;
    let mut query = String::from("SELECT COUNT(*) as count FROM issues WHERE project_id = $1");

    if status.is_some() {
        query.push_str(&format!(" AND status = ${}", param_idx));
        param_idx += 1;
    }
    if level.is_some() {
        query.push_str(&format!(" AND level = ${}", param_idx));
    }

    let mut q = sqlx::query(&query).bind(project_id);

    if let Some(s) = status {
        q = q.bind(s);
    }
    if let Some(l) = level {
        q = q.bind(l);
    }

    let row = q.fetch_one(pool).await?;
    Ok(row.get("count"))
}

pub async fn update_issue_on_new_event(
    pool: &DbPool,
    id: &str,
    timestamp: &str,
) -> Result<Issue> {
    sqlx::query_as::<_, Issue>(
        "UPDATE issues SET count = count + 1, last_seen = $1 WHERE id = $2 RETURNING *",
    )
    .bind(timestamp)
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn update_issue_status(pool: &DbPool, id: &str, status: &str) -> Result<Issue> {
    sqlx::query_as::<_, Issue>(
        "UPDATE issues SET status = $1 WHERE id = $2 RETURNING *",
    )
    .bind(status)
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn delete_issue(pool: &DbPool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM issues WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// Event Queries
// ============================================================================

pub async fn create_event(
    pool: &DbPool,
    id: &str,
    issue_id: &str,
    event_id: &str,
    timestamp: &str,
    payload: &str,
) -> Result<Event> {
    sqlx::query_as::<_, Event>(
        r#"
        INSERT INTO events (id, issue_id, event_id, timestamp, payload)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(issue_id)
    .bind(event_id)
    .bind(timestamp)
    .bind(payload)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

pub async fn get_event_by_event_id(pool: &DbPool, event_id: &str) -> Result<Option<Event>> {
    sqlx::query_as::<_, Event>("SELECT * FROM events WHERE event_id = $1")
        .bind(event_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

pub async fn get_events_by_issue(
    pool: &DbPool,
    issue_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<Event>> {
    sqlx::query_as::<_, Event>(
        "SELECT * FROM events WHERE issue_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3",
    )
    .bind(issue_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn get_latest_event_for_issue(pool: &DbPool, issue_id: &str) -> Result<Option<Event>> {
    sqlx::query_as::<_, Event>(
        "SELECT * FROM events WHERE issue_id = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}
