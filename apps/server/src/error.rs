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

    #[error("Payment required: {message}")]
    PaymentRequiredWithChallenge {
        message: String,
        challenge: serde_json::Value,
    },

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
        // PaymentRequiredWithChallenge has a different response shape — handle via full match
        match self {
            AppError::PaymentRequiredWithChallenge { message, challenge } => {
                return (
                    StatusCode::PAYMENT_REQUIRED,
                    Json(serde_json::json!({
                        "error": {
                            "code": "payment_required",
                            "message": message,
                        },
                        "x402": challenge,
                    })),
                )
                    .into_response();
            }
            AppError::RateLimitExceeded {
                retry_after_secs,
                limit,
                remaining,
            } => {
                let body = ErrorResponse {
                    error: ErrorBody {
                        code: "rate_limit_exceeded".to_string(),
                        message: format!(
                            "Rate limit exceeded. Try again in {} seconds.",
                            retry_after_secs
                        ),
                    },
                };
                let mut response = (StatusCode::TOO_MANY_REQUESTS, Json(body)).into_response();
                let headers = response.headers_mut();
                if let Ok(val) = retry_after_secs.to_string().parse() {
                    headers.insert(header::RETRY_AFTER, val);
                }
                if let Ok(val) = limit.to_string().parse() {
                    headers.insert("X-RateLimit-Limit", val);
                }
                if let Ok(val) = remaining.to_string().parse() {
                    headers.insert("X-RateLimit-Remaining", val);
                }
                return response;
            }
            AppError::Internal(ref msg) => {
                tracing::error!("Internal error: {}", msg);
                capture_message(&format!("Internal error: {}", msg), Level::Error);
            }
            AppError::Database(ref e) => {
                tracing::error!("Database error: {}", e);
                capture_message(&format!("Database error: {}", e), Level::Error);
            }
            AppError::Anyhow(ref e) => {
                tracing::error!("Anyhow error: {}", e);
                capture_message(&format!("Anyhow error: {}", e), Level::Error);
            }
            AppError::Validation(ref msg) => {
                tracing::warn!("Validation error (422): {}", msg);
            }
            _ => {}
        }

        let (status, code, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "unauthorized", msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "forbidden", msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "conflict", msg.clone()),
            AppError::PaymentRequired(msg) => (
                StatusCode::PAYMENT_REQUIRED,
                "payment_required",
                msg.clone(),
            ),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "An internal error occurred".to_string(),
            ),
            AppError::Database(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "database_error",
                "A database error occurred".to_string(),
            ),
            AppError::Validation(msg) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_error",
                msg.clone(),
            ),
            AppError::Anyhow(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "An internal error occurred".to_string(),
            ),
            // Already handled above via early return:
            AppError::PaymentRequiredWithChallenge { .. } | AppError::RateLimitExceeded { .. } => {
                unreachable!()
            }
        };

        let body = ErrorResponse {
            error: ErrorBody {
                code: code.to_string(),
                message,
            },
        };

        (status, Json(body)).into_response()
    }
}
