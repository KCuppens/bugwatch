use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    db::repositories::UserRepository,
    services::ai::{AiFix, ErrorContext, StackFrame},
    AppError, AppResult, AppState,
};

/// Request to generate an AI fix
#[derive(Debug, Deserialize)]
pub struct GenerateFixRequest {
    /// Error type (e.g., "TypeError")
    pub error_type: String,
    /// Error message
    pub error_message: String,
    /// Stack frames
    pub stack_trace: Vec<StackFrameInput>,
    /// Optional environment info
    pub environment: Option<String>,
    /// Optional runtime info
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StackFrameInput {
    pub filename: String,
    pub function: String,
    pub lineno: u32,
    pub colno: u32,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    #[serde(default)]
    pub in_app: bool,
}

/// Response for AI fix generation
#[derive(Debug, Serialize)]
pub struct GenerateFixResponse {
    pub fix: AiFixResponse,
    pub credits_used: i32,
    pub credits_remaining: i32,
}

#[derive(Debug, Serialize)]
pub struct AiFixResponse {
    pub explanation: String,
    pub fix_code: String,
    pub recommendations: Vec<String>,
    pub confidence: f32,
}

impl From<AiFix> for AiFixResponse {
    fn from(fix: AiFix) -> Self {
        Self {
            explanation: fix.explanation,
            fix_code: fix.fix_code,
            recommendations: fix.recommendations,
            confidence: fix.confidence,
        }
    }
}

/// POST /api/v1/projects/:project_id/issues/:issue_id/ai-fix
/// Generate an AI fix suggestion for an issue
pub async fn generate_fix(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((_project_id, _issue_id)): Path<(String, String)>,
    Json(request): Json<GenerateFixRequest>,
) -> AppResult<Json<GenerateFixResponse>> {
    // Check if AI service is available
    let ai_service = state
        .ai_service
        .as_ref()
        .ok_or_else(|| AppError::Internal("AI service not configured".to_string()))?;

    let credit_cost = state.config.ai_fix_credit_cost;

    // Check user has sufficient credits
    if auth_user.credits < credit_cost {
        return Err(AppError::BadRequest(format!(
            "Insufficient credits. You have {}, but need {}",
            auth_user.credits, credit_cost
        )));
    }

    // Convert request to ErrorContext
    let context = ErrorContext {
        error_type: request.error_type,
        error_message: request.error_message,
        stack_trace: request
            .stack_trace
            .into_iter()
            .map(|f| StackFrame {
                filename: f.filename,
                function: f.function,
                lineno: f.lineno,
                colno: f.colno,
                context_line: f.context_line,
                pre_context: f.pre_context,
                post_context: f.post_context,
                in_app: f.in_app,
            })
            .collect(),
        environment: request.environment,
        runtime: request.runtime,
    };

    // Generate fix
    let fix = ai_service
        .generate_fix(context)
        .await
        .map_err(|e| AppError::Internal(format!("AI fix generation failed: {}", e)))?;

    // Deduct credits from user account
    let credits_remaining = UserRepository::deduct_credits(&state.db, &auth_user.id, credit_cost)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to deduct credits: {}", e)))?;

    // TODO: Store the fix in the database for future reference

    Ok(Json(GenerateFixResponse {
        fix: fix.into(),
        credits_used: credit_cost,
        credits_remaining,
    }))
}

/// POST /api/v1/ai/generate-fix
/// Generate an AI fix without associating with a specific issue
pub async fn generate_fix_standalone(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(request): Json<GenerateFixRequest>,
) -> AppResult<Json<GenerateFixResponse>> {
    // Check if AI service is available
    let ai_service = state
        .ai_service
        .as_ref()
        .ok_or_else(|| AppError::Internal("AI service not configured".to_string()))?;

    let credit_cost = state.config.ai_fix_credit_cost;

    // Check user has sufficient credits
    if auth_user.credits < credit_cost {
        return Err(AppError::BadRequest(format!(
            "Insufficient credits. You have {}, but need {}",
            auth_user.credits, credit_cost
        )));
    }

    // Convert request to ErrorContext
    let context = ErrorContext {
        error_type: request.error_type,
        error_message: request.error_message,
        stack_trace: request
            .stack_trace
            .into_iter()
            .map(|f| StackFrame {
                filename: f.filename,
                function: f.function,
                lineno: f.lineno,
                colno: f.colno,
                context_line: f.context_line,
                pre_context: f.pre_context,
                post_context: f.post_context,
                in_app: f.in_app,
            })
            .collect(),
        environment: request.environment,
        runtime: request.runtime,
    };

    // Generate fix
    let fix = ai_service
        .generate_fix(context)
        .await
        .map_err(|e| AppError::Internal(format!("AI fix generation failed: {}", e)))?;

    // Deduct credits from user account
    let credits_remaining = UserRepository::deduct_credits(&state.db, &auth_user.id, credit_cost)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to deduct credits: {}", e)))?;

    Ok(Json(GenerateFixResponse {
        fix: fix.into(),
        credits_used: credit_cost,
        credits_remaining,
    }))
}
