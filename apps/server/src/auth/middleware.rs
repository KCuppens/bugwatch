use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};

use crate::{
    auth::jwt::validate_access_token,
    db::{models::User, repositories::UserRepository},
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

        // Extract Authorization header
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?
            .to_str()
            .map_err(|_| AppError::Unauthorized("Invalid Authorization header".to_string()))?;

        // Extract Bearer token
        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".to_string()))?;

        // Validate token
        let claims = validate_access_token(token, &app_state.config.jwt_secret)?;

        // Fetch user from database
        let user = UserRepository::find_by_id(&app_state.db, &claims.sub)
            .await?
            .ok_or_else(|| AppError::Unauthorized("User not found".to_string()))?;

        Ok(AuthUser(user))
    }
}
