use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::{AppError, AppResult};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user ID)
    pub sub: String,
    /// Expiration time (Unix timestamp)
    pub exp: i64,
    /// Issued at (Unix timestamp)
    pub iat: i64,
    /// Token type: "access" or "refresh"
    #[serde(rename = "type")]
    pub token_type: String,
    /// Session ID (for refresh tokens only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jti: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
}

/// Generate access and refresh tokens for a user
pub fn generate_tokens(
    user_id: &str,
    session_id: &str,
    secret: &str,
    access_expiration: i64,
    refresh_expiration: i64,
) -> AppResult<TokenPair> {
    let now = Utc::now();

    // Access token (short-lived)
    let access_claims = Claims {
        sub: user_id.to_string(),
        exp: (now + Duration::seconds(access_expiration)).timestamp(),
        iat: now.timestamp(),
        token_type: "access".to_string(),
        jti: None,
    };

    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to generate access token: {}", e)))?;

    // Refresh token (long-lived)
    let refresh_claims = Claims {
        sub: user_id.to_string(),
        exp: (now + Duration::seconds(refresh_expiration)).timestamp(),
        iat: now.timestamp(),
        token_type: "refresh".to_string(),
        jti: Some(session_id.to_string()),
    };

    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to generate refresh token: {}", e)))?;

    Ok(TokenPair {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: access_expiration,
    })
}

/// Validate and decode a JWT token
pub fn validate_token(token: &str, secret: &str) -> AppResult<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| match e.kind() {
        jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
            AppError::Unauthorized("Token has expired".to_string())
        }
        jsonwebtoken::errors::ErrorKind::InvalidToken => {
            AppError::Unauthorized("Invalid token".to_string())
        }
        _ => AppError::Unauthorized(format!("Token validation failed: {}", e)),
    })?;

    Ok(token_data.claims)
}

/// Validate that a token is an access token
pub fn validate_access_token(token: &str, secret: &str) -> AppResult<Claims> {
    let claims = validate_token(token, secret)?;

    if claims.token_type != "access" {
        return Err(AppError::Unauthorized("Invalid token type".to_string()));
    }

    Ok(claims)
}

/// Validate that a token is a refresh token
pub fn validate_refresh_token(token: &str, secret: &str) -> AppResult<Claims> {
    let claims = validate_token(token, secret)?;

    if claims.token_type != "refresh" {
        return Err(AppError::Unauthorized("Invalid token type".to_string()));
    }

    Ok(claims)
}
