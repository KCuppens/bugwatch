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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    #[test]
    fn not_found_is_404() {
        let r = AppError::NotFound("item".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn bad_request_is_400() {
        let r = AppError::BadRequest("bad".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn unauthorized_is_401() {
        let r = AppError::Unauthorized("unauth".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn forbidden_is_403() {
        let r = AppError::Forbidden("forbidden".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn conflict_is_409() {
        let r = AppError::Conflict("dup".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn payment_required_is_402() {
        let r = AppError::PaymentRequired("pay".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::PAYMENT_REQUIRED);
    }

    #[test]
    fn internal_is_500() {
        let r = AppError::Internal("oops".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn validation_is_422() {
        let r = AppError::Validation("invalid field".to_string()).into_response();
        assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn anyhow_is_500() {
        let r = AppError::Anyhow(anyhow::anyhow!("internal")).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn database_error_is_500() {
        let r = AppError::Database(sqlx::Error::RowNotFound).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn rate_limit_exceeded_is_429_with_retry_after_header() {
        let r = AppError::RateLimitExceeded {
            retry_after_secs: 30,
            limit: 100,
            remaining: 0,
        }
        .into_response();
        assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            r.headers().contains_key("retry-after"),
            "must have Retry-After header"
        );
        assert!(
            r.headers().contains_key("x-ratelimit-limit"),
            "must have X-RateLimit-Limit header"
        );
        assert!(
            r.headers().contains_key("x-ratelimit-remaining"),
            "must have X-RateLimit-Remaining header"
        );
    }

    #[test]
    fn payment_required_with_challenge_is_402() {
        let r = AppError::PaymentRequiredWithChallenge {
            message: "pay".to_string(),
            challenge: serde_json::json!({"amount": "1.00"}),
        }
        .into_response();
        assert_eq!(r.status(), StatusCode::PAYMENT_REQUIRED);
    }

    #[test]
    fn app_error_display_messages() {
        assert!(AppError::NotFound("x".to_string())
            .to_string()
            .contains("Not found"));
        assert!(AppError::BadRequest("x".to_string())
            .to_string()
            .contains("Bad request"));
        assert!(AppError::Unauthorized("x".to_string())
            .to_string()
            .contains("Unauthorized"));
        assert!(AppError::Forbidden("x".to_string())
            .to_string()
            .contains("Forbidden"));
        assert!(AppError::Conflict("x".to_string())
            .to_string()
            .contains("Conflict"));
        assert!(AppError::PaymentRequired("x".to_string())
            .to_string()
            .contains("Payment required"));
        assert!(AppError::Internal("x".to_string())
            .to_string()
            .contains("Internal"));
        assert!(AppError::Validation("x".to_string())
            .to_string()
            .contains("Validation"));
    }
}
