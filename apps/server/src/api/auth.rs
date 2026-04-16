use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid;

use crate::{
    auth::{
        jwt::{generate_tokens, validate_refresh_token},
        middleware::AuthUser,
        password::{hash_password, validate_email, validate_password, verify_password},
    },
    db::repositories::{OrganizationRepository, SessionRepository, UserRepository},
    AppError, AppResult, AppState,
};

/// Extract the User-Agent string from request headers.
fn extract_user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// Build Set-Cookie headers for httpOnly token cookies.
/// SameSite=Strict prevents CSRF. The refresh cookie is scoped to `/api/v1/auth`
/// so it's never sent on normal API calls.
fn build_auth_cookies(
    access_token: &str,
    refresh_token: &str,
    access_max_age: i64,
    refresh_max_age: i64,
    secure: bool,
) -> Vec<HeaderValue> {
    let secure_flag = if secure { "; Secure" } else { "" };
    vec![
        HeaderValue::from_str(&format!(
            "access_token={access_token}; HttpOnly; SameSite=Strict; Path=/{secure_flag}; Max-Age={access_max_age}"
        ))
        .unwrap_or_else(|_| HeaderValue::from_static("")),
        HeaderValue::from_str(&format!(
            "refresh_token={refresh_token}; HttpOnly; SameSite=Strict; Path=/api/v1/auth{secure_flag}; Max-Age={refresh_max_age}"
        ))
        .unwrap_or_else(|_| HeaderValue::from_static("")),
    ]
}

/// Build Set-Cookie headers that clear auth cookies (for logout).
fn build_clear_cookies(secure: bool) -> Vec<HeaderValue> {
    let secure_flag = if secure { "; Secure" } else { "" };
    vec![
        HeaderValue::from_str(&format!(
            "access_token=; HttpOnly; SameSite=Strict; Path=/{secure_flag}; Max-Age=0"
        ))
        .unwrap_or_else(|_| HeaderValue::from_static("")),
        HeaderValue::from_str(&format!(
            "refresh_token=; HttpOnly; SameSite=Strict; Path=/api/v1/auth{secure_flag}; Max-Age=0"
        ))
        .unwrap_or_else(|_| HeaderValue::from_static("")),
    ]
}

/// Extract client IP from request headers.
///
/// Only trusts X-Forwarded-For / X-Real-IP when `trust_proxy` is true.
/// When false, returns "unknown" so rate limiting still applies per connection
/// class without allowing bypass via crafted headers.
fn extract_client_ip(headers: &HeaderMap, trust_proxy: bool) -> String {
    if !trust_proxy {
        return "unknown".to_string();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Check auth rate limit (10 attempts/minute per IP)
fn check_auth_rate_limit(state: &AppState, headers: &HeaderMap) -> AppResult<()> {
    let ip = extract_client_ip(headers, state.config.trust_proxy);
    let key = format!("auth:{}", ip);
    let result = state.rate_limiter.check(&key, 10);
    if !result.allowed {
        return Err(AppError::RateLimitExceeded {
            retry_after_secs: result.retry_after_secs.unwrap_or(60),
            limit: result.limit,
            remaining: result.remaining,
        });
    }
    Ok(())
}

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

#[derive(Debug, Serialize)]
pub struct AuthData {
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub data: AuthData,
}

#[derive(Debug, Serialize)]
pub struct RefreshData {
    /// Seconds until the new access token expires — useful for scheduling
    /// the next refresh. The tokens themselves arrive via httpOnly cookies.
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
}

/// Create a session, generate tokens, update the session's token hash, and
/// build the Set-Cookie response headers. This block is identical in signup,
/// login, and refresh — extracting it here keeps those handlers DRY.
async fn issue_tokens_for_session(
    db: &crate::db::DbPool,
    config: &crate::config::Config,
    user_id: &str,
    session_expires: chrono::DateTime<Utc>,
    client_ip: &str,
    user_agent: Option<&str>,
) -> AppResult<(HeaderMap, crate::auth::jwt::TokenPair)> {
    let session = SessionRepository::create(
        db,
        user_id,
        "", // Placeholder; replaced with real token hash below
        session_expires,
        Some(client_ip),
        user_agent,
        &config.jwt_secret,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create session: {}", e)))?;

    let tokens = generate_tokens(
        user_id,
        &session.id,
        &config.jwt_secret,
        config.jwt_access_expiration,
        config.jwt_refresh_expiration,
    )?;

    SessionRepository::update_token_hash(
        db,
        &session.id,
        &tokens.refresh_token,
        &config.jwt_secret,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to update session token: {}", e)))?;

    let secure = config.app_url.starts_with("https");
    let mut response_headers = HeaderMap::new();
    for cookie in build_auth_cookies(
        &tokens.access_token,
        &tokens.refresh_token,
        config.jwt_access_expiration,
        config.jwt_refresh_expiration,
        secure,
    ) {
        response_headers.append(header::SET_COOKIE, cookie);
    }

    Ok((response_headers, tokens))
}

/// POST /api/v1/auth/signup
pub async fn signup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SignupRequest>,
) -> AppResult<(HeaderMap, Json<AuthResponse>)> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers)?;

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

    // Create session, generate tokens, set cookies
    let session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let client_ip = extract_client_ip(&headers, state.config.trust_proxy);
    let user_agent = extract_user_agent(&headers);
    let (response_headers, _tokens) = issue_tokens_for_session(
        &state.db,
        &state.config,
        &user.id,
        session_expires,
        &client_ip,
        user_agent.as_deref(),
    )
    .await?;

    tracing::info!("New user registered: {}", user.email);

    Ok((
        response_headers,
        Json(AuthResponse {
            data: AuthData {
                user: UserResponse {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    created_at: user.created_at.to_rfc3339(),
                },
            },
        }),
    ))
}

/// POST /api/v1/auth/login
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> AppResult<(HeaderMap, Json<AuthResponse>)> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers)?;

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
        let client_ip = extract_client_ip(&headers, state.config.trust_proxy);
        tracing::warn!(
            user_id = %user.id,
            email = %user.email,
            client_ip = %client_ip,
            outcome = "login_failed",
            "Failed login attempt"
        );
        return Err(AppError::Unauthorized(
            "Invalid email or password".to_string(),
        ));
    }

    // Reset failed attempts on successful login
    UserRepository::reset_failed_attempts(&state.db, &user.id).await?;

    // Create session, generate tokens, set cookies
    let session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let client_ip = extract_client_ip(&headers, state.config.trust_proxy);
    let user_agent = extract_user_agent(&headers);
    let (response_headers, _tokens) = issue_tokens_for_session(
        &state.db,
        &state.config,
        &user.id,
        session_expires,
        &client_ip,
        user_agent.as_deref(),
    )
    .await?;

    tracing::info!("User logged in: {}", user.email);

    Ok((
        response_headers,
        Json(AuthResponse {
            data: AuthData {
                user: UserResponse {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    created_at: user.created_at.to_rfc3339(),
                },
            },
        }),
    ))
}

/// POST /api/v1/auth/logout
///
/// Deletes only the current session (identified via the refresh token cookie's
/// jti claim) so the user stays logged in on other devices. Falls back to
/// deleting all sessions if the cookie is absent or invalid.
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    user: AuthUser,
) -> AppResult<(HeaderMap, Json<serde_json::Value>)> {
    // Attempt single-session logout: extract session ID from the refresh token.
    let session_id = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|c| c.trim().strip_prefix("refresh_token="))
                .map(|s| s.to_string())
        })
        .and_then(|token| {
            crate::auth::jwt::validate_refresh_token(&token, &state.config.jwt_secret)
                .ok()
                .and_then(|claims| claims.jti)
        });

    if let Some(sid) = session_id {
        SessionRepository::delete(&state.db, &sid).await?;
    } else {
        // No valid refresh cookie — delete all sessions for this user.
        SessionRepository::delete_by_user(&state.db, &user.id).await?;
    }

    tracing::info!("User logged out: {}", user.email);

    let secure = state.config.app_url.starts_with("https");
    let mut response_headers = HeaderMap::new();
    for cookie in build_clear_cookies(secure) {
        response_headers.append(header::SET_COOKIE, cookie);
    }

    Ok((
        response_headers,
        Json(serde_json::json!({ "data": { "message": "Logged out successfully" } })),
    ))
}

/// POST /api/v1/auth/refresh
///
/// Reads the refresh token exclusively from the httpOnly cookie.
/// The request body is intentionally ignored to prevent token leakage via JS.
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<(HeaderMap, Json<RefreshResponse>)> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers)?;

    // Read refresh token exclusively from httpOnly cookie — never from the body.
    let refresh_token = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|c| c.trim().strip_prefix("refresh_token="))
                .map(|s| s.to_string())
        })
        .ok_or_else(|| AppError::Unauthorized("Missing refresh token".to_string()))?;

    // Validate refresh token
    let claims = validate_refresh_token(&refresh_token, &state.config.jwt_secret)?;

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
        // Best-effort cleanup — don't fail the request if delete fails
        if let Err(e) = SessionRepository::delete(&state.db, &session_id).await {
            tracing::warn!(session_id = %session_id, "Failed to delete expired session: {}", e);
        }
        return Err(AppError::Unauthorized("Session expired".to_string()));
    }

    // Create new session FIRST — if this fails the old session remains valid (no lockout)
    let new_session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let refresh_ip = extract_client_ip(&headers, state.config.trust_proxy);
    let refresh_ua = extract_user_agent(&headers);
    let (response_headers, tokens) = issue_tokens_for_session(
        &state.db,
        &state.config,
        &claims.sub,
        new_session_expires,
        &refresh_ip,
        refresh_ua.as_deref(),
    )
    .await?;

    // Delete old session AFTER new one is created — soft failure to avoid leaving user logged out
    if let Err(e) = SessionRepository::delete(&state.db, &session_id).await {
        tracing::warn!(session_id = %session_id, "Failed to delete old session during rotation (it will expire naturally): {}", e);
    }

    Ok((
        response_headers,
        Json(RefreshResponse {
            data: RefreshData {
                expires_in: tokens.expires_in,
            },
        }),
    ))
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
    pub organization: Option<OrganizationInfo>,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub data: MeData,
}

/// GET /api/v1/auth/me
pub async fn me(user: AuthUser, State(state): State<AppState>) -> AppResult<Json<MeResponse>> {
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
            organization,
        },
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub name: Option<String>,
}

/// PATCH /api/v1/auth/me
pub async fn update_profile(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateProfileRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if let Some(ref name) = req.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Name cannot be empty".to_string()));
        }
        if name.len() > 100 {
            return Err(AppError::Validation(
                "Name too long (max 100 characters)".to_string(),
            ));
        }
        UserRepository::update_name(&state.db, &user.id, name.trim())
            .await
            .map_err(|e| AppError::Internal(format!("Failed to update profile: {}", e)))?;
    }

    tracing::info!("User profile updated: {}", user.email);

    Ok(Json(
        serde_json::json!({ "data": { "message": "Profile updated successfully" } }),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

/// POST /api/v1/auth/change-password
pub async fn change_password(
    user: AuthUser,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChangePasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers)?;

    // Get user with password hash
    let db_user = UserRepository::find_by_id(&state.db, &user.id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Verify current password
    let is_valid = verify_password(&req.current_password, &db_user.password_hash)?;
    if !is_valid {
        return Err(AppError::Unauthorized(
            "Current password is incorrect".to_string(),
        ));
    }

    // Validate new password
    validate_password(&req.new_password)?;

    // Hash and update
    let new_hash = hash_password(&req.new_password)?;
    UserRepository::update_password(&state.db, &user.id, &new_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to update password: {}", e)))?;

    tracing::info!("User password changed: {}", user.email);

    Ok(Json(
        serde_json::json!({ "data": { "message": "Password changed successfully" } }),
    ))
}

// ============================================================================
// Password Reset
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

/// POST /api/v1/auth/forgot-password
///
/// Generates a password reset token and, if SMTP is configured, emails it to
/// the user.  Always returns 200 (even for unknown emails) to prevent user
/// enumeration attacks.
pub async fn forgot_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ForgotPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Rate limit per IP (same bucket as other auth endpoints)
    check_auth_rate_limit(&state, &headers)?;

    // Per-email rate limit: max 3 reset requests per hour per address.
    // Keyed on a hash of the email to avoid storing PII in the rate-limit store.
    // Checked before the user lookup so we don't reveal whether the address is registered.
    {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(req.email.to_lowercase().as_bytes());
        let email_hash = hex::encode(h.finalize());
        let reset_key = format!("reset_email:{}", email_hash);
        let result = state.rate_limiter.check_hourly(&reset_key, 1);
        if !result.allowed {
            // Return the same generic OK to avoid user enumeration, but log for monitoring
            tracing::warn!(
                outcome = "reset_rate_limited",
                "Password reset rate limit exceeded for hashed email"
            );
            return Ok(Json(
                serde_json::json!({ "data": { "message": "If that email exists, a reset link has been sent." } }),
            ));
        }
    }

    let ok_response = || {
        Json(
            serde_json::json!({ "data": { "message": "If that email exists, a reset link has been sent." } }),
        )
    };

    let user = match UserRepository::find_by_email(&state.db, &req.email).await? {
        Some(u) => u,
        None => return Ok(ok_response()), // don't reveal whether the email is registered
    };

    // Generate a 32-byte random token, hash it for storage
    let plain_token = generate_reset_token();
    let token_hash = hash_reset_token(&plain_token);
    let expires_at = Utc::now() + Duration::hours(1);
    let id = uuid::Uuid::new_v4().to_string();

    // Upsert: one pending token per user at a time (conflict on user_id, not token_hash).
    // Replaces any existing pending token so old links are invalidated when a new one is requested.
    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE
            SET id = EXCLUDED.id,
                token_hash = EXCLUDED.token_hash,
                expires_at = EXCLUDED.expires_at,
                used_at = NULL
        "#,
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create reset token: {}", e)))?;

    // Send email if SMTP is configured
    if state.config.is_smtp_configured() {
        // Strip any trailing API path segments to get the web app base URL.
        // Handles both "https://app.example.com" and "https://app.example.com/api".
        let web_base = state
            .config
            .app_url
            .trim_end_matches('/')
            .trim_end_matches("/api")
            .trim_end_matches('/');
        let reset_url = format!("{}/reset-password?token={}", web_base, plain_token);
        if let Err(e) = send_reset_email(&state.config, &user.email, &reset_url).await {
            tracing::warn!(
                "Failed to send password reset email to {}: {}",
                user.email,
                e
            );
        } else {
            tracing::info!(user_id = %user.id, outcome = "reset_email_sent", "Password reset email sent to {}", user.email);
        }
    } else {
        tracing::info!(
            user_id = %user.id,
            outcome = "token_created",
            "SMTP not configured — password reset token created (expires {}). Configure SMTP to deliver reset links.",
            expires_at
        );
    }

    Ok(ok_response())
}

/// POST /api/v1/auth/reset-password
///
/// Validates the reset token and updates the user's password.
pub async fn reset_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ResetPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    check_auth_rate_limit(&state, &headers)?;

    let token_hash = hash_reset_token(&req.token);

    validate_password(&req.new_password)?;

    // Atomic CAS: mark the token used in a single UPDATE that also validates it.
    // This eliminates the TOCTOU race where two concurrent requests could both pass
    // the used_at check before either marks the token consumed.
    let row: Option<(String,)> = sqlx::query_as(
        r#"
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("Failed to consume reset token: {}", e)))?;

    let (user_id,) = row.ok_or_else(|| {
        tracing::warn!(
            outcome = "token_invalid_or_expired",
            "Password reset token validation failed"
        );
        AppError::BadRequest("Invalid, expired, or already-used reset token".to_string())
    })?;

    let new_hash = hash_password(&req.new_password)?;
    UserRepository::update_password(&state.db, &user_id, &new_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to update password: {}", e)))?;

    // Invalidate all existing sessions for this user (force re-login with new password)
    SessionRepository::delete_by_user(&state.db, &user_id).await?;

    tracing::info!("Password reset successful for user {}", user_id);

    Ok(Json(
        serde_json::json!({ "data": { "message": "Password reset successfully. Please log in with your new password." } }),
    ))
}

// ---- helpers ----------------------------------------------------------------

/// Generate a cryptographically secure 32-byte random token encoded as a 64-char hex string.
/// Uses the OS CSPRNG (via rand::rngs::OsRng backed by getrandom) — NOT a seeded PRNG.
fn generate_reset_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn hash_reset_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex::encode(h.finalize())
}

async fn send_reset_email(
    config: &crate::config::Config,
    to_email: &str,
    reset_url: &str,
) -> anyhow::Result<()> {
    use lettre::message::header::ContentType;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{AsyncSmtpTransport, AsyncTransport, Message as LettreMessage, Tokio1Executor};

    let smtp_host = config.smtp_host.as_deref().unwrap_or("");
    let smtp_port = config.smtp_port.unwrap_or(587);
    let from_addr = config
        .smtp_from
        .as_deref()
        .unwrap_or("noreply@bugwatch.dev");

    let body = format!(
        "You requested a password reset for your BugWatch account.\n\n\
        Click the link below to reset your password (valid for 1 hour):\n\n\
        {}\n\n\
        If you didn't request this, you can safely ignore this email.",
        reset_url
    );

    let message = LettreMessage::builder()
        .from(from_addr.parse()?)
        .to(to_email.parse()?)
        .subject("Reset your BugWatch password")
        .header(ContentType::TEXT_PLAIN)
        .body(body)?;

    let transport = if let (Some(user), Some(pass)) =
        (config.smtp_user.as_deref(), config.smtp_password.as_deref())
    {
        AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_host)?
            .port(smtp_port)
            .credentials(Credentials::new(user.to_string(), pass.to_string()))
            .build()
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_host)?
            .port(smtp_port)
            .build()
    };

    transport.send(message).await?;
    Ok(())
}
