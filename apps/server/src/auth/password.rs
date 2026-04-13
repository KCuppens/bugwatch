use bcrypt::{hash, verify, DEFAULT_COST};

use crate::{AppError, AppResult};

/// Hash a password using bcrypt
pub fn hash_password(password: &str) -> AppResult<String> {
    hash(password, DEFAULT_COST)
        .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))
}

/// Verify a password against a hash
pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    verify(password, hash)
        .map_err(|e| AppError::Internal(format!("Failed to verify password: {}", e)))
}

/// Validate password requirements
pub fn validate_password(password: &str) -> AppResult<()> {
    if password.len() > 128 {
        return Err(AppError::Validation(
            "Password must be at most 128 characters".to_string(),
        ));
    }
    if password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".to_string(),
        ));
    }

    let has_uppercase = password.chars().any(|c| c.is_uppercase());
    let has_lowercase = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());

    if !has_uppercase {
        return Err(AppError::Validation(
            "Password must contain at least one uppercase letter".to_string(),
        ));
    }

    if !has_lowercase {
        return Err(AppError::Validation(
            "Password must contain at least one lowercase letter".to_string(),
        ));
    }

    if !has_digit {
        return Err(AppError::Validation(
            "Password must contain at least one number".to_string(),
        ));
    }

    Ok(())
}

/// Validate email format using a proper regex pattern
pub fn validate_email(email: &str) -> AppResult<()> {
    use regex::Regex;
    use std::sync::LazyLock;

    // HTML5 email pattern - good enough for practical use
    static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$").unwrap()
    });

    if email.len() > 254 {
        return Err(AppError::Validation(
            "Email address too long (max 254 characters)".to_string(),
        ));
    }

    if !EMAIL_RE.is_match(email) {
        return Err(AppError::Validation("Invalid email format".to_string()));
    }

    Ok(())
}
