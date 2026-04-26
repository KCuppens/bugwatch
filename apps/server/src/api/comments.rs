use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use super::{ApiResponse, PaginationParams};
use crate::{
    auth::{AuthIdentity, EitherAuth},
    db::repositories::{CommentRepository, IssueRepository, ProjectRepository, UserRepository},
    AppError, AppResult, AppState,
};

#[derive(Debug, Serialize)]
pub struct CommentResponse {
    pub id: String,
    pub issue_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub user_email: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCommentRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCommentRequest {
    pub content: String,
}

/// GET /api/v1/projects/:project_id/issues/:issue_id/comments
pub async fn list(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
    Query(params): Query<PaginationParams>,
) -> AppResult<Json<ApiResponse<Vec<CommentResponse>>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    // Verify issue exists and belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!(
            "Issue {} not found in project",
            issue_id
        )));
    }

    let page = params.page.max(1);
    let per_page = params.per_page.min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    let comments =
        CommentRepository::find_by_issue(&state.db, &issue_id, per_page as i64, offset).await?;

    // Batch-load all comment authors in a single query instead of N+1
    let user_ids: Vec<String> = comments.iter().map(|c| c.user_id.clone()).collect();
    let users = UserRepository::find_by_ids(&state.db, &user_ids).await?;
    let user_map: std::collections::HashMap<String, _> =
        users.into_iter().map(|u| (u.id.clone(), u)).collect();

    let response_comments: Vec<CommentResponse> = comments
        .into_iter()
        .map(|comment| {
            let user = user_map.get(&comment.user_id);
            CommentResponse {
                id: comment.id,
                issue_id: comment.issue_id,
                user_id: comment.user_id,
                user_name: user.and_then(|u| u.name.clone()),
                user_email: user.map(|u| u.email.clone()).unwrap_or_default(),
                content: comment.content,
                created_at: comment.created_at.to_rfc3339(),
                updated_at: comment.updated_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(ApiResponse {
        data: response_comments,
    }))
}

/// POST /api/v1/projects/:project_id/issues/:issue_id/comments
pub async fn create(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id)): Path<(String, String)>,
    Json(req): Json<CreateCommentRequest>,
) -> AppResult<Json<ApiResponse<CommentResponse>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    // Verify issue exists and belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!(
            "Issue {} not found in project",
            issue_id
        )));
    }

    // Validate content
    if req.content.trim().is_empty() {
        return Err(AppError::Validation(
            "Comment content cannot be empty".to_string(),
        ));
    }

    if req.content.len() > 10000 {
        return Err(AppError::Validation(
            "Comment content is too long (max 10000 characters)".to_string(),
        ));
    }

    // For agents, use the agent key creator as the commenter; for users, use their ID
    let commenter_id = match &*auth {
        AuthIdentity::User(user) => user.id.clone(),
        AuthIdentity::Agent(agent) => agent.agent_key.created_by.clone(),
    };

    // Create comment
    let comment =
        CommentRepository::create(&state.db, &issue_id, &commenter_id, &req.content).await?;

    // Get user info
    let user = UserRepository::find_by_id(&state.db, &commenter_id).await?;

    Ok(Json(ApiResponse {
        data: CommentResponse {
            id: comment.id,
            issue_id: comment.issue_id,
            user_id: comment.user_id,
            user_name: user.as_ref().and_then(|u| u.name.clone()),
            user_email: user.map(|u| u.email).unwrap_or_default(),
            content: comment.content,
            created_at: comment.created_at.to_rfc3339(),
            updated_at: comment.updated_at.to_rfc3339(),
        },
    }))
}

/// PATCH /api/v1/projects/:project_id/issues/:issue_id/comments/:comment_id
pub async fn update(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id, comment_id)): Path<(String, String, String)>,
    Json(req): Json<UpdateCommentRequest>,
) -> AppResult<Json<ApiResponse<CommentResponse>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    // Get comment
    let comment = CommentRepository::find_by_id(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Comment {} not found", comment_id)))?;

    // Verify comment belongs to issue
    if comment.issue_id != issue_id {
        return Err(AppError::NotFound(format!(
            "Comment {} not found in issue",
            comment_id
        )));
    }

    // For users, verify they own the comment; agents with write access can edit any comment in the project
    if let AuthIdentity::User(user) = &*auth {
        if comment.user_id != user.id {
            return Err(AppError::Forbidden(
                "You can only edit your own comments".to_string(),
            ));
        }
    }

    // Validate content
    if req.content.trim().is_empty() {
        return Err(AppError::Validation(
            "Comment content cannot be empty".to_string(),
        ));
    }

    if req.content.len() > 10000 {
        return Err(AppError::Validation(
            "Comment content is too long (max 10000 characters)".to_string(),
        ));
    }

    // Update comment
    CommentRepository::update(&state.db, &comment_id, &issue_id, &req.content).await?;

    // Get updated comment
    let updated = CommentRepository::find_by_id(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to fetch updated comment".to_string()))?;

    // Get user info for the comment author
    let user = UserRepository::find_by_id(&state.db, &updated.user_id).await?;

    Ok(Json(ApiResponse {
        data: CommentResponse {
            id: updated.id,
            issue_id: updated.issue_id,
            user_id: updated.user_id,
            user_name: user.as_ref().and_then(|u| u.name.clone()),
            user_email: user.map(|u| u.email).unwrap_or_default(),
            content: updated.content,
            created_at: updated.created_at.to_rfc3339(),
            updated_at: updated.updated_at.to_rfc3339(),
        },
    }))
}

/// DELETE /api/v1/projects/:project_id/issues/:issue_id/comments/:comment_id
pub async fn delete(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, issue_id, comment_id)): Path<(String, String, String)>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden(
            "You don't have access to this project".to_string(),
        ));
    }

    // Get comment
    let comment = CommentRepository::find_by_id(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Comment {} not found", comment_id)))?;

    // Verify comment belongs to issue
    if comment.issue_id != issue_id {
        return Err(AppError::NotFound(format!(
            "Comment {} not found in issue",
            comment_id
        )));
    }

    // For users, verify they own the comment or are the project owner; agents with write can delete any
    if let AuthIdentity::User(user) = &*auth {
        if comment.user_id != user.id && project.owner_id != user.id {
            return Err(AppError::Forbidden(
                "You can only delete your own comments".to_string(),
            ));
        }
    }

    // Delete comment
    CommentRepository::delete(&state.db, &comment_id, &issue_id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Comment deleted successfully" }),
    }))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use serde_json::Value;
    use tower::ServiceExt;

    async fn make_app() -> axum::Router {
        let state = crate::db::test_helpers::test_app_state().await;
        axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state)
    }

    fn peer() -> std::net::SocketAddr {
        "127.0.0.1:1234".parse().unwrap()
    }

    async fn signup_and_get_token(app: &axum::Router, email: &str) -> String {
        let body = format!(r#"{{"email":"{}","password":"StrongPass1!"}}"#, email);
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(body))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        for v in resp.headers().get_all("set-cookie") {
            let s = v.to_str().unwrap_or("");
            if let Some(rest) = s.strip_prefix("access_token=") {
                return rest.split(';').next().unwrap_or("").to_string();
            }
        }
        panic!("no access_token cookie in signup response");
    }

    async fn create_project(app: &axum::Router, token: &str) -> (String, String) {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Test Project"}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        (
            json["data"]["id"].as_str().unwrap().to_string(),
            json["data"]["api_key"].as_str().unwrap().to_string(),
        )
    }

    async fn ingest_event(app: &axum::Router, api_key: &str) {
        let event = serde_json::json!({
            "event_id": "aabbccdd11223344aabbccdd11223344",
            "timestamp": "2024-01-01T00:00:00Z",
            "level": "error",
            "exception": {
                "type": "RuntimeError",
                "value": "test error",
                "stacktrace": []
            }
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", api_key)
            .body(Body::from(event.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert!(resp.status().is_success(), "event ingest failed");
    }

    async fn get_first_issue_id(app: &axum::Router, token: &str, project_id: &str) -> String {
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/issues", project_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        json["data"][0]["id"].as_str().unwrap().to_string()
    }

    // ── GET comments ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/issues/issue1/comments")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn list_unknown_project_returns_404() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "clist-404@example.com").await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/nonexistent/issues/issue1/comments")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn list_comments_returns_empty_initially() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "clist-empty@example.com").await;
        let (project_id, api_key) = create_project(&app, &token).await;
        ingest_event(&app, &api_key).await;
        let issue_id = get_first_issue_id(&app, &token, &project_id).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments",
                project_id, issue_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"], Value::Array(vec![]));
    }

    // ── POST comment ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn create_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/proj1/issues/issue1/comments")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"content":"hello"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn create_comment_succeeds() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "ccreate@example.com").await;
        let (project_id, api_key) = create_project(&app, &token).await;
        ingest_event(&app, &api_key).await;
        let issue_id = get_first_issue_id(&app, &token, &project_id).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments",
                project_id, issue_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"content":"This is a test comment"}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["content"], "This is a test comment");
    }

    #[tokio::test]
    async fn create_empty_content_rejected() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "cempty@example.com").await;
        let (project_id, api_key) = create_project(&app, &token).await;
        ingest_event(&app, &api_key).await;
        let issue_id = get_first_issue_id(&app, &token, &project_id).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments",
                project_id, issue_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"content":"   "}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn create_too_long_content_rejected() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "clong@example.com").await;
        let (project_id, api_key) = create_project(&app, &token).await;
        ingest_event(&app, &api_key).await;
        let issue_id = get_first_issue_id(&app, &token, &project_id).await;

        let body = serde_json::json!({"content": "x".repeat(10001)}).to_string();
        let req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments",
                project_id, issue_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(body))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    // ── PATCH comment ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn update_comment_succeeds() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "cupdate@example.com").await;
        let (project_id, api_key) = create_project(&app, &token).await;
        ingest_event(&app, &api_key).await;
        let issue_id = get_first_issue_id(&app, &token, &project_id).await;

        let create_req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments",
                project_id, issue_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"content":"original"}"#))
            .unwrap();
        let create_resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(create_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let comment_id = json["data"]["id"].as_str().unwrap().to_string();

        let update_req = Request::builder()
            .method("PATCH")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments/{}",
                project_id, issue_id, comment_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"content":"updated content"}"#))
            .unwrap();
        let resp = app.oneshot(update_req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["content"], "updated content");
    }

    // ── DELETE comment ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn delete_comment_succeeds() {
        let app = make_app().await;
        let token = signup_and_get_token(&app, "cdelete@example.com").await;
        let (project_id, api_key) = create_project(&app, &token).await;
        ingest_event(&app, &api_key).await;
        let issue_id = get_first_issue_id(&app, &token, &project_id).await;

        let create_req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments",
                project_id, issue_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"content":"to be deleted"}"#))
            .unwrap();
        let create_resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(create_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let comment_id = json["data"]["id"].as_str().unwrap().to_string();

        let delete_req = Request::builder()
            .method("DELETE")
            .uri(format!(
                "/api/v1/projects/{}/issues/{}/comments/{}",
                project_id, issue_id, comment_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(delete_req).await.unwrap().status(),
            StatusCode::OK
        );
    }
}
