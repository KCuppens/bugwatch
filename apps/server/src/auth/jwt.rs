use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::{AppError, AppResult};

/// JWT issuer claim — identifies this server as the token source.
const JWT_ISSUER: &str = "bugwatch-server";
/// JWT audience claim — prevents tokens from one deployment being accepted by another.
const JWT_AUDIENCE: &str = "bugwatch";

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
    /// Issuer
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iss: Option<String>,
    /// Audience
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aud: Option<String>,
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
        jti: Some(session_id.to_string()),
        iss: Some(JWT_ISSUER.to_string()),
        aud: Some(JWT_AUDIENCE.to_string()),
    };

    let access_token = encode(
        &Header::new(jsonwebtoken::Algorithm::HS256),
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
        iss: Some(JWT_ISSUER.to_string()),
        aud: Some(JWT_AUDIENCE.to_string()),
    };

    let refresh_token = encode(
        &Header::new(jsonwebtoken::Algorithm::HS256),
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
    let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "iat", "sub", "iss", "aud"]);
    // Validate audience and issuer to prevent cross-deployment token reuse
    validation.set_audience(&[JWT_AUDIENCE]);
    validation.set_issuer(&[JWT_ISSUER]);

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
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

    let claims = token_data.claims;

    // Reject tokens with an iat set in the future — guards against clock-skew
    // abuse and forged tokens with inflated iat values.
    if claims.iat > chrono::Utc::now().timestamp() {
        return Err(AppError::Unauthorized(
            "Token issued in the future".to_string(),
        ));
    }

    // "type" is a custom claim not enforced by set_required_spec_claims; check manually.
    if claims.token_type.is_empty() {
        return Err(AppError::Unauthorized("Missing token type".to_string()));
    }

    Ok(claims)
}

/// Validate that a token is an access token
pub fn validate_access_token(token: &str, secret: &str) -> AppResult<Claims> {
    let claims = validate_token(token, secret)?;

    if !bool::from(claims.token_type.as_bytes().ct_eq(b"access")) {
        return Err(AppError::Unauthorized("Invalid token type".to_string()));
    }

    if claims.jti.is_none() {
        return Err(AppError::Unauthorized(
            "Token missing session identifier".to_string(),
        ));
    }

    Ok(claims)
}

/// Validate that a token is a refresh token
pub fn validate_refresh_token(token: &str, secret: &str) -> AppResult<Claims> {
    let claims = validate_token(token, secret)?;

    if !bool::from(claims.token_type.as_bytes().ct_eq(b"refresh")) {
        return Err(AppError::Unauthorized("Invalid token type".to_string()));
    }

    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};

    const SECRET: &str = "test-secret-key-at-least-32-bytes-long";

    fn make_claims(
        token_type: &str,
        exp_offset_secs: i64,
        iat_offset_secs: i64,
        jti: Option<&str>,
    ) -> Claims {
        let now = chrono::Utc::now();
        Claims {
            sub: "user-1".to_string(),
            exp: (now + chrono::Duration::seconds(exp_offset_secs)).timestamp(),
            iat: (now + chrono::Duration::seconds(iat_offset_secs)).timestamp(),
            token_type: token_type.to_string(),
            jti: jti.map(str::to_string),
            iss: Some("bugwatch-server".to_string()),
            aud: Some("bugwatch".to_string()),
        }
    }

    fn encode_claims(claims: &Claims) -> String {
        encode(
            &Header::new(jsonwebtoken::Algorithm::HS256),
            claims,
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap()
    }

    #[test]
    fn generate_tokens_produces_non_empty_pair() {
        let pair = generate_tokens("user-1", "session-1", SECRET, 900, 604800).unwrap();
        assert!(!pair.access_token.is_empty());
        assert!(!pair.refresh_token.is_empty());
        assert_eq!(pair.token_type, "Bearer");
        assert_eq!(pair.expires_in, 900);
    }

    #[test]
    fn access_token_roundtrip() {
        let pair = generate_tokens("user-42", "sess-abc", SECRET, 900, 604800).unwrap();
        let claims = validate_access_token(&pair.access_token, SECRET).unwrap();
        assert_eq!(claims.sub, "user-42");
        assert_eq!(claims.token_type, "access");
        assert_eq!(claims.jti.as_deref(), Some("sess-abc"));
    }

    #[test]
    fn refresh_token_roundtrip() {
        let pair = generate_tokens("user-7", "sess-xyz", SECRET, 900, 604800).unwrap();
        let claims = validate_refresh_token(&pair.refresh_token, SECRET).unwrap();
        assert_eq!(claims.sub, "user-7");
        assert_eq!(claims.token_type, "refresh");
    }

    #[test]
    fn issuer_and_audience_propagated() {
        let pair = generate_tokens("u", "s", SECRET, 900, 604800).unwrap();
        let claims = validate_token(&pair.access_token, SECRET).unwrap();
        assert_eq!(claims.iss.as_deref(), Some("bugwatch-server"));
        assert_eq!(claims.aud.as_deref(), Some("bugwatch"));
    }

    #[test]
    fn validate_token_rejects_wrong_secret() {
        let pair = generate_tokens("u", "s", SECRET, 900, 604800).unwrap();
        assert!(validate_token(&pair.access_token, "wrong-secret-key-at-least-32").is_err());
    }

    #[test]
    fn validate_token_rejects_garbage() {
        assert!(validate_token("not.a.jwt", SECRET).is_err());
        assert!(validate_token("", SECRET).is_err());
    }

    #[test]
    fn validate_token_rejects_expired() {
        let claims = make_claims("access", -3600, -7200, Some("s"));
        let token = encode_claims(&claims);
        let err = validate_token(&token, SECRET).unwrap_err().to_string();
        assert!(
            err.to_lowercase().contains("expired"),
            "expected 'expired' in: {err}"
        );
    }

    #[test]
    fn validate_token_rejects_future_iat() {
        let claims = make_claims("access", 3600, 3600, Some("s"));
        let token = encode_claims(&claims);
        let err = validate_token(&token, SECRET).unwrap_err().to_string();
        assert!(
            err.to_lowercase().contains("future"),
            "expected 'future' in: {err}"
        );
    }

    #[test]
    fn validate_access_token_rejects_refresh() {
        let pair = generate_tokens("u", "s", SECRET, 900, 604800).unwrap();
        let result = validate_access_token(&pair.refresh_token, SECRET);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.to_lowercase().contains("type"),
            "expected 'type' in: {err}"
        );
    }

    #[test]
    fn validate_refresh_token_rejects_access() {
        let pair = generate_tokens("u", "s", SECRET, 900, 604800).unwrap();
        let result = validate_refresh_token(&pair.access_token, SECRET);
        assert!(result.is_err());
    }

    #[test]
    fn validate_access_token_missing_jti_is_rejected() {
        let claims = make_claims("access", 3600, 0, None);
        let token = encode_claims(&claims);
        let result = validate_access_token(&token, SECRET);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.to_lowercase().contains("session"),
            "expected 'session' in: {err}"
        );
    }

    #[test]
    fn access_and_refresh_tokens_differ() {
        let pair = generate_tokens("u", "s", SECRET, 900, 604800).unwrap();
        assert_ne!(pair.access_token, pair.refresh_token);
    }
}
