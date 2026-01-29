use axum::{extract::State, Json};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{
        jwt::{generate_tokens, validate_refresh_token, TokenPair},
        middleware::AuthUser,
        password::{hash_password, validate_email, validate_password, verify_password},
    },
    db::repositories::{OrganizationRepository, SessionRepository, UserRepository},
    AppError, AppResult, AppState,
};

#[derive(Debug, Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

impl From<TokenPair> for TokenResponse {
    fn from(pair: TokenPair) -> Self {
        Self {
            access_token: pair.access_token,
            refresh_token: pair.refresh_token,
            expires_in: pair.expires_in,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AuthData {
    pub user: UserResponse,
    pub tokens: TokenResponse,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub data: AuthData,
}

#[derive(Debug, Serialize)]
pub struct RefreshData {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub data: RefreshData,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub created_at: String,
    pub credits: i32,
}

/// POST /api/v1/auth/signup
pub async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> AppResult<Json<AuthResponse>> {
    // Validate email
    validate_email(&req.email)?;

    // Validate password
    validate_password(&req.password)?;

    // Check if email already exists
    if UserRepository::find_by_email(&state.db, &req.email)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("Email already registered".to_string()));
    }

    // Hash password
    let password_hash = hash_password(&req.password)?;

    // Create user
    let user = UserRepository::create(&state.db, &req.email, &password_hash, req.name.as_deref())
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create user: {}", e)))?;

    // Create session
    let session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let session = SessionRepository::create(
        &state.db,
        &user.id,
        &user.id, // Temporary token placeholder
        session_expires,
        None,
        None,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create session: {}", e)))?;

    // Generate tokens
    let tokens = generate_tokens(
        &user.id,
        &session.id,
        &state.config.jwt_secret,
        state.config.jwt_access_expiration,
        state.config.jwt_refresh_expiration,
    )?;

    tracing::info!("New user registered: {}", user.email);

    Ok(Json(AuthResponse {
        data: AuthData {
            user: UserResponse {
                id: user.id,
                email: user.email,
                name: user.name,
                created_at: user.created_at.to_rfc3339(),
                credits: user.credits,
            },
            tokens: tokens.into(),
        },
    }))
}

/// POST /api/v1/auth/login
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    // Find user by email
    let user = UserRepository::find_by_email(&state.db, &req.email)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid email or password".to_string()))?;

    // Check if account is locked
    if let Some(locked_until) = &user.locked_until {
        if *locked_until > Utc::now() {
            return Err(AppError::Unauthorized(
                "Account is temporarily locked. Try again later.".to_string(),
            ));
        }
    }

    // Verify password
    let is_valid = verify_password(&req.password, &user.password_hash)?;

    if !is_valid {
        // Increment failed attempts
        UserRepository::increment_failed_attempts(&state.db, &user.id).await?;
        return Err(AppError::Unauthorized("Invalid email or password".to_string()));
    }

    // Reset failed attempts on successful login
    UserRepository::reset_failed_attempts(&state.db, &user.id).await?;

    // Create session
    let session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let session = SessionRepository::create(
        &state.db,
        &user.id,
        &user.id,
        session_expires,
        None,
        None,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create session: {}", e)))?;

    // Generate tokens
    let tokens = generate_tokens(
        &user.id,
        &session.id,
        &state.config.jwt_secret,
        state.config.jwt_access_expiration,
        state.config.jwt_refresh_expiration,
    )?;

    tracing::info!("User logged in: {}", user.email);

    Ok(Json(AuthResponse {
        data: AuthData {
            user: UserResponse {
                id: user.id,
                email: user.email,
                name: user.name,
                created_at: user.created_at.to_rfc3339(),
                credits: user.credits,
            },
            tokens: tokens.into(),
        },
    }))
}

/// POST /api/v1/auth/logout
pub async fn logout(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    // Delete all sessions for user (logout from all devices)
    SessionRepository::delete_by_user(&state.db, &user.id).await?;

    tracing::info!("User logged out: {}", user.email);

    Ok(Json(serde_json::json!({ "data": { "message": "Logged out successfully" } })))
}

/// POST /api/v1/auth/refresh
pub async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> AppResult<Json<RefreshResponse>> {
    // Validate refresh token
    let claims = validate_refresh_token(&req.refresh_token, &state.config.jwt_secret)?;

    // Get session ID from token
    let session_id = claims
        .jti
        .ok_or_else(|| AppError::Unauthorized("Invalid refresh token".to_string()))?;

    // Verify session exists
    let session = SessionRepository::find_by_id(&state.db, &session_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Session not found".to_string()))?;

    // Check if session is expired
    if session.expires_at < Utc::now() {
        SessionRepository::delete(&state.db, &session_id).await?;
        return Err(AppError::Unauthorized("Session expired".to_string()));
    }

    // Delete old session
    SessionRepository::delete(&state.db, &session_id).await?;

    // Create new session
    let new_session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let new_session = SessionRepository::create(
        &state.db,
        &claims.sub,
        &claims.sub,
        new_session_expires,
        None,
        None,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create session: {}", e)))?;

    // Generate new tokens
    let tokens = generate_tokens(
        &claims.sub,
        &new_session.id,
        &state.config.jwt_secret,
        state.config.jwt_access_expiration,
        state.config.jwt_refresh_expiration,
    )?;

    Ok(Json(RefreshResponse {
        data: RefreshData {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
        },
    }))
}

#[derive(Debug, Serialize)]
pub struct OrganizationInfo {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub tier: String,
    pub seats: i32,
    pub subscription_status: String,
    pub current_period_end: Option<chrono::DateTime<chrono::Utc>>,
    pub cancel_at_period_end: bool,
}

#[derive(Debug, Serialize)]
pub struct MeData {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub created_at: String,
    pub credits: i32,
    pub organization: Option<OrganizationInfo>,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub data: MeData,
}

/// GET /api/v1/auth/me
pub async fn me(
    user: AuthUser,
    State(state): State<AppState>,
) -> AppResult<Json<MeResponse>> {
    // Fetch organization for user
    let organization = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .ok()
        .flatten()
        .map(|org| OrganizationInfo {
            id: org.id,
            name: org.name,
            slug: org.slug,
            tier: org.tier,
            seats: org.seats,
            subscription_status: org.subscription_status,
            current_period_end: org.current_period_end,
            cancel_at_period_end: org.cancel_at_period_end,
        });

    Ok(Json(MeResponse {
        data: MeData {
            id: user.id.clone(),
            email: user.email.clone(),
            name: user.name.clone(),
            created_at: user.created_at.to_rfc3339(),
            credits: user.credits,
            organization,
        },
    }))
}
