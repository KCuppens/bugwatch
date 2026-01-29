use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

// BugWatch self-monitoring: capture internal errors
use bugwatch::{capture_message, Level};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Payment required: {0}")]
    PaymentRequired(String),

    #[error("Rate limit exceeded")]
    RateLimitExceeded {
        retry_after_secs: u32,
        limit: u32,
        remaining: u32,
    },

    #[error("Internal server error: {0}")]
    Internal(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Anyhow(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorResponse {
    error: ErrorBody,
}

#[derive(Serialize)]
struct ErrorBody {
    code: String,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, rate_limit_info) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone(), None),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone(), None),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "unauthorized", msg.clone(), None),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "forbidden", msg.clone(), None),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "conflict", msg.clone(), None),
            AppError::PaymentRequired(msg) => (StatusCode::PAYMENT_REQUIRED, "payment_required", msg.clone(), None),
            AppError::RateLimitExceeded { retry_after_secs, limit, remaining } => (
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limit_exceeded",
                format!("Rate limit exceeded. Try again in {} seconds.", retry_after_secs),
                Some((*retry_after_secs, *limit, *remaining)),
            ),
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {}", msg);
                // Capture to BugWatch for self-monitoring
                capture_message(
                    &format!("Internal error: {}", msg),
                    Level::Error,
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                    None,
                )
            }
            AppError::Database(e) => {
                tracing::error!("Database error: {}", e);
                // Capture to BugWatch for self-monitoring
                capture_message(
                    &format!("Database error: {}", e),
                    Level::Error,
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "database_error",
                    "A database error occurred".to_string(),
                    None,
                )
            }
            AppError::Validation(msg) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "validation_error", msg.clone(), None)
            }
            AppError::Anyhow(e) => {
                tracing::error!("Anyhow error: {}", e);
                // Capture to BugWatch for self-monitoring
                capture_message(
                    &format!("Anyhow error: {}", e),
                    Level::Error,
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                    None,
                )
            }
        };

        let body = ErrorResponse {
            error: ErrorBody {
                code: code.to_string(),
                message,
            },
        };

        let mut response = (status, Json(body)).into_response();

        // Add rate limit headers if this is a rate limit error
        if let Some((retry_after, limit, remaining)) = rate_limit_info {
            let headers = response.headers_mut();
            headers.insert(
                header::RETRY_AFTER,
                retry_after.to_string().parse().unwrap(),
            );
            headers.insert(
                "X-RateLimit-Limit",
                limit.to_string().parse().unwrap(),
            );
            headers.insert(
                "X-RateLimit-Remaining",
                remaining.to_string().parse().unwrap(),
            );
        }

        response
    }
}
