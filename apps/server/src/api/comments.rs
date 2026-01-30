use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use super::{ApiResponse, PaginationParams};
use crate::{
    auth::AuthUser,
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
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
    Query(params): Query<PaginationParams>,
) -> AppResult<Json<ApiResponse<Vec<CommentResponse>>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Verify issue exists and belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    let page = params.page.max(1);
    let per_page = params.per_page.min(100).max(1);
    let offset = ((page - 1) * per_page) as i64;

    let comments = CommentRepository::find_by_issue(&state.db, &issue_id, per_page as i64, offset).await?;

    // Fetch user info for each comment
    let mut response_comments = Vec::with_capacity(comments.len());
    for comment in comments {
        let user = UserRepository::find_by_id(&state.db, &comment.user_id).await?;
        response_comments.push(CommentResponse {
            id: comment.id,
            issue_id: comment.issue_id,
            user_id: comment.user_id,
            user_name: user.as_ref().and_then(|u| u.name.clone()),
            user_email: user.map(|u| u.email).unwrap_or_default(),
            content: comment.content,
            created_at: comment.created_at.to_rfc3339(),
            updated_at: comment.updated_at.to_rfc3339(),
        });
    }

    Ok(Json(ApiResponse {
        data: response_comments,
    }))
}

/// POST /api/v1/projects/:project_id/issues/:issue_id/comments
pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
    Json(req): Json<CreateCommentRequest>,
) -> AppResult<Json<ApiResponse<CommentResponse>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Verify issue exists and belongs to project
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Issue {} not found", issue_id)))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(format!("Issue {} not found in project", issue_id)));
    }

    // Validate content
    if req.content.trim().is_empty() {
        return Err(AppError::Validation("Comment content cannot be empty".to_string()));
    }

    if req.content.len() > 10000 {
        return Err(AppError::Validation("Comment content is too long (max 10000 characters)".to_string()));
    }

    // Create comment
    let comment = CommentRepository::create(&state.db, &issue_id, &auth_user.id, &req.content).await?;

    // Get user info
    let user = UserRepository::find_by_id(&state.db, &auth_user.id).await?;

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
    auth_user: AuthUser,
    Path((project_id, issue_id, comment_id)): Path<(String, String, String)>,
    Json(req): Json<UpdateCommentRequest>,
) -> AppResult<Json<ApiResponse<CommentResponse>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get comment
    let comment = CommentRepository::find_by_id(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Comment {} not found", comment_id)))?;

    // Verify comment belongs to issue
    if comment.issue_id != issue_id {
        return Err(AppError::NotFound(format!("Comment {} not found in issue", comment_id)));
    }

    // Verify user owns the comment
    if comment.user_id != auth_user.id {
        return Err(AppError::Forbidden("You can only edit your own comments".to_string()));
    }

    // Validate content
    if req.content.trim().is_empty() {
        return Err(AppError::Validation("Comment content cannot be empty".to_string()));
    }

    if req.content.len() > 10000 {
        return Err(AppError::Validation("Comment content is too long (max 10000 characters)".to_string()));
    }

    // Update comment
    CommentRepository::update(&state.db, &comment_id, &req.content).await?;

    // Get updated comment
    let updated = CommentRepository::find_by_id(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to fetch updated comment".to_string()))?;

    // Get user info
    let user = UserRepository::find_by_id(&state.db, &auth_user.id).await?;

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
    auth_user: AuthUser,
    Path((project_id, issue_id, comment_id)): Path<(String, String, String)>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You don't have access to this project".to_string()));
    }

    // Get comment
    let comment = CommentRepository::find_by_id(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Comment {} not found", comment_id)))?;

    // Verify comment belongs to issue
    if comment.issue_id != issue_id {
        return Err(AppError::NotFound(format!("Comment {} not found in issue", comment_id)));
    }

    // Verify user owns the comment (or is project owner)
    if comment.user_id != auth_user.id && project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("You can only delete your own comments".to_string()));
    }

    // Delete comment
    CommentRepository::delete(&state.db, &comment_id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Comment deleted successfully" }),
    }))
}
