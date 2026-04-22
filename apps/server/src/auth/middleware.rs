use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};

use crate::{
    auth::jwt::validate_access_token,
    db::{
        models::User,
        repositories::{SessionRepository, UserRepository},
    },
    AppError, AppState,
};

/// Authenticated user extracted from JWT token
#[derive(Debug, Clone)]
pub struct AuthUser(pub User);

impl std::ops::Deref for AuthUser {
    type Target = User;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Use state directly since we have AppState
        let app_state = state;

        // Extract token: prefer Authorization header, fall back to httpOnly cookie.
        let token_from_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "));

        let token_from_cookie = || -> Option<&str> {
            parts
                .headers
                .get(axum::http::header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|cookies| {
                    cookies
                        .split(';')
                        .find_map(|c| c.trim().strip_prefix("access_token="))
                })
        };

        let token = token_from_header
            .or_else(token_from_cookie)
            .ok_or_else(|| AppError::Unauthorized("Missing authentication".to_string()))?;

        // Validate token
        let claims = validate_access_token(token, &app_state.config.jwt_secret)?;

        // Every access token must carry a session ID (jti). Hard-reject tokens
        // without one — they cannot be validated against the session store and
        // would bypass session revocation checks entirely.
        let session_id = claims.jti.as_deref().ok_or_else(|| {
            AppError::Unauthorized("Token missing session identifier".to_string())
        })?;

        // Verify the session still exists in the DB.
        // This ensures revoked sessions (logout, password change) cannot continue authenticating.
        let session_alive = SessionRepository::find_by_id(&app_state.db, session_id)
            .await
            .map(|s| s.is_some())
            .unwrap_or(false);
        if !session_alive {
            return Err(AppError::Unauthorized(
                "Session has been revoked".to_string(),
            ));
        }

        // Fetch user from database
        let user = UserRepository::find_by_id(&app_state.db, &claims.sub)
            .await?
            .ok_or_else(|| AppError::Unauthorized("User not found".to_string()))?;

        Ok(AuthUser(user))
    }
}
