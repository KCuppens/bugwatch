use axum::{
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid;

use crate::{
    auth::{
        cookie::extract_cookie,
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
) -> AppResult<Vec<HeaderValue>> {
    let secure_flag = if secure { "; Secure" } else { "" };
    Ok(vec![
        HeaderValue::from_str(&format!(
            "access_token={access_token}; HttpOnly; SameSite=Strict; Path=/{secure_flag}; Max-Age={access_max_age}"
        ))
        .map_err(|e| AppError::Internal(format!("Failed to build access_token cookie: {e}")))?,
        HeaderValue::from_str(&format!(
            "refresh_token={refresh_token}; HttpOnly; SameSite=Strict; Path=/api/v1/auth{secure_flag}; Max-Age={refresh_max_age}"
        ))
        .map_err(|e| AppError::Internal(format!("Failed to build refresh_token cookie: {e}")))?,
    ])
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

/// Extract client IP from request headers or the socket peer address.
///
/// When `trust_proxy` is true, X-Forwarded-For / X-Real-IP are trusted (server is behind a
/// reverse proxy). When false, the TCP peer address is used so no header spoofing is possible
/// and each connection gets its own rate-limit bucket instead of sharing "unknown".
pub(crate) fn extract_client_ip(
    headers: &HeaderMap,
    trust_proxy: bool,
    peer_addr: Option<SocketAddr>,
) -> String {
    if trust_proxy {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .map(|s| s.trim().to_string())
            .filter(|s| s.parse::<std::net::IpAddr>().is_ok())
        {
            return ip;
        }
        if let Some(ip) = headers
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_string())
            .filter(|s| s.parse::<std::net::IpAddr>().is_ok())
        {
            return ip;
        }
    }
    peer_addr
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Check auth rate limit per endpoint per IP.
/// Each endpoint gets its own bucket so refresh (called automatically) cannot
/// exhaust the login budget and vice-versa.
fn check_auth_rate_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer_addr: Option<SocketAddr>,
    endpoint: &str,
    limit: u32,
) -> AppResult<()> {
    let ip = extract_client_ip(headers, state.config.trust_proxy, peer_addr);
    let key = format!("auth:{}:{}", endpoint, ip);
    let result = state.rate_limiter.check(&key, limit);
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
    // Generate session ID before creating the DB row so we can include the
    // real token hash in the INSERT (no placeholder → no two-step write window).
    let session_id = uuid::Uuid::new_v4().to_string();

    let tokens = generate_tokens(
        user_id,
        &session_id,
        &config.jwt_secret,
        config.jwt_access_expiration,
        config.jwt_refresh_expiration,
    )?;

    SessionRepository::create_with_id(
        db,
        &session_id,
        user_id,
        &tokens.refresh_token,
        session_expires,
        Some(client_ip),
        user_agent,
        &config.jwt_secret,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create session: {}", e)))?;

    let secure = config.cookie_secure;
    let mut response_headers = HeaderMap::new();
    for cookie in build_auth_cookies(
        &tokens.access_token,
        &tokens.refresh_token,
        config.jwt_access_expiration,
        config.jwt_refresh_expiration,
        secure,
    )? {
        response_headers.append(header::SET_COOKIE, cookie);
    }

    Ok((response_headers, tokens))
}

/// POST /api/v1/auth/signup
pub async fn signup(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<SignupRequest>,
) -> AppResult<(HeaderMap, Json<AuthResponse>)> {
    // Rate limit per IP (tight budget — signup is rarely called legitimately at high frequency)
    check_auth_rate_limit(&state, &headers, Some(peer_addr), "signup", 5)?;

    // Normalize email to lowercase before any lookup or storage
    let email = req.email.to_lowercase();

    // Validate email
    validate_email(&email)?;

    // Validate password
    validate_password(&req.password)?;

    // Per-email rate limit: max 3 signup attempts per hour per address.
    // Keyed on a SHA-256 hash of the lowercased email to avoid storing PII.
    let email_key = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(email.as_bytes());
        format!("signup_email:{}", hex::encode(hasher.finalize()))
    };
    let rl = state.rate_limiter.check(&email_key, 3);
    if !rl.allowed {
        return Err(AppError::RateLimitExceeded {
            retry_after_secs: rl.retry_after_secs.unwrap_or(60),
            limit: rl.limit,
            remaining: rl.remaining,
        });
    }

    // Hash password before the uniqueness check so both code paths take the same
    // amount of time, preventing email enumeration via response-time oracle.
    let password_hash = hash_password(&req.password)?;

    // Check if email already exists
    if UserRepository::find_by_email(&state.db, &email)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("Email already registered".to_string()));
    }

    // Create user
    let user = UserRepository::create(&state.db, &email, &password_hash, req.name.as_deref())
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create user: {}", e)))?;

    // Create session, generate tokens, set cookies
    let session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let client_ip = extract_client_ip(&headers, state.config.trust_proxy, Some(peer_addr));
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

    tracing::info!(user_id = %user.id, outcome = "signup", "New user registered");

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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> AppResult<(HeaderMap, Json<AuthResponse>)> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers, Some(peer_addr), "login", 5)?;

    // Normalize email to lowercase before lookup
    let email = req.email.to_lowercase();

    // Find user by email
    let user = UserRepository::find_by_email(&state.db, &email)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid email or password".to_string()))?;

    // Verify password first (always, for constant-time behaviour — prevents
    // lockout status from leaking via response-time oracle).
    let is_valid = verify_password(&req.password, &user.password_hash)?;

    if !is_valid {
        // Increment failed attempts and potentially lock the account
        UserRepository::increment_failed_attempts(&state.db, &user.id).await?;
        let client_ip = extract_client_ip(&headers, state.config.trust_proxy, Some(peer_addr));
        tracing::warn!(
            user_id = %user.id,
            client_ip = %client_ip,
            outcome = "login_failed",
            "Failed login attempt"
        );
        return Err(AppError::Unauthorized(
            "Invalid email or password".to_string(),
        ));
    }

    // Password is correct — now check lockout so the lock status is not
    // observable via timing when the password is wrong.
    // Intentional: lock after MAX_FAILED_ATTEMPTS consecutive failures; threshold is 5.
    if let Some(locked_until) = &user.locked_until {
        if locked_until.0 > Utc::now() {
            return Err(AppError::Unauthorized(
                "Account is temporarily locked. Try again later.".to_string(),
            ));
        }
    }

    // Reset failed attempts on successful login
    UserRepository::reset_failed_attempts(&state.db, &user.id).await?;

    // Revoke prior sessions to enforce single active session per user.
    if let Err(e) = SessionRepository::delete_by_user(&state.db, &user.id).await {
        tracing::warn!(user_id = %user.id, error = %e, "Failed to clear prior sessions on login");
    }

    // Create session, generate tokens, set cookies
    let session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let client_ip = extract_client_ip(&headers, state.config.trust_proxy, Some(peer_addr));
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

    tracing::info!(user_id = %user.id, outcome = "login", "User logged in");

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
/// Deletes only the current session (identified via the jti claim already
/// validated in the access token) so the user stays logged in on other devices.
/// Using the access token's jti avoids re-parsing and re-validating the refresh
/// cookie, and is always available because AuthUser requires a valid jti.
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    user: AuthUser,
) -> AppResult<(HeaderMap, Json<serde_json::Value>)> {
    // Use the jti from the already-validated access token to identify the session.
    // This avoids re-parsing the refresh cookie and is always consistent with the
    // session that AuthUser verified. The access token is read from the cookie (or
    // Authorization header fallback) and re-validated cheaply — the signature was
    // already checked by AuthUser, so this is just claim extraction.
    // H1: Read the access token exclusively from the httpOnly cookie.
    // We deliberately do NOT fall back to the Authorization Bearer header —
    // a logout triggered by a raw Bearer token could be forged by an XSS
    // payload that reads the header from a JS-reachable context.  The
    // httpOnly cookie is never accessible to JS, so it is the only
    // trustworthy source for this sensitive operation.
    let cookie_token = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| extract_cookie(cookies, "access_token").map(|s| s.to_string()));

    let cookie_token = cookie_token.ok_or_else(|| {
        AppError::Unauthorized("Logout requires an active session cookie".to_string())
    })?;

    let session_id =
        crate::auth::jwt::validate_access_token(&cookie_token, &state.config.jwt_secret)
            .ok()
            .and_then(|claims| claims.jti);

    if let Some(sid) = session_id {
        SessionRepository::delete(&state.db, &sid).await?;
    } else {
        // Cookie present but jti missing — clear all sessions as a safe fallback.
        tracing::warn!(user_id = %user.id, "logout: could not extract jti from cookie access token — clearing all sessions for user");
        SessionRepository::delete_by_user(&state.db, &user.id).await?;
    }

    tracing::info!(user_id = %user.id, outcome = "logout", "User logged out");

    let secure = state.config.cookie_secure;
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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> AppResult<(HeaderMap, Json<RefreshResponse>)> {
    // Rate limit per IP — refresh is called automatically every ~13 minutes by the
    // frontend, so a higher limit is needed to avoid locking out legitimate users.
    check_auth_rate_limit(&state, &headers, Some(peer_addr), "refresh", 30)?;

    // Read refresh token exclusively from httpOnly cookie — never from the body.
    let refresh_token = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| extract_cookie(cookies, "refresh_token").map(|s| s.to_string()))
        .ok_or_else(|| AppError::Unauthorized("Missing refresh token".to_string()))?;

    // Validate refresh token
    let claims = validate_refresh_token(&refresh_token, &state.config.jwt_secret)?;

    // Get session ID from token
    let session_id = claims
        .jti
        .ok_or_else(|| AppError::Unauthorized("Invalid refresh token".to_string()))?;

    // Atomically rotate: delete old session + create new session in one transaction.
    // The rotate call also validates expiry inside the transaction (TOCTOU-safe).
    let new_session_id = uuid::Uuid::new_v4().to_string();
    let new_session_expires = Utc::now() + Duration::seconds(state.config.jwt_refresh_expiration);
    let refresh_ip = extract_client_ip(&headers, state.config.trust_proxy, Some(peer_addr));
    let refresh_ua = extract_user_agent(&headers);

    let tokens = generate_tokens(
        &claims.sub,
        &new_session_id,
        &state.config.jwt_secret,
        state.config.jwt_access_expiration,
        state.config.jwt_refresh_expiration,
    )?;

    let rotated = SessionRepository::rotate(
        &state.db,
        &session_id,
        &new_session_id,
        &claims.sub,
        &tokens.refresh_token,
        new_session_expires,
        Some(&refresh_ip),
        refresh_ua.as_deref(),
        &state.config.jwt_secret,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to rotate session: {}", e)))?;

    if !rotated {
        return Err(AppError::Unauthorized("Session expired".to_string()));
    }

    let secure = state.config.cookie_secure;
    let mut response_headers = HeaderMap::new();
    for cookie in build_auth_cookies(
        &tokens.access_token,
        &tokens.refresh_token,
        state.config.jwt_access_expiration,
        state.config.jwt_refresh_expiration,
        secure,
    )? {
        response_headers.append(header::SET_COOKIE, cookie);
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
    // Fetch organization for user — soft failure: a DB error returns null org
    // rather than a 500, since the user profile itself is still valid.
    let organization = match OrganizationRepository::find_by_user(&state.db, &user.id).await {
        Ok(opt) => opt,
        Err(e) => {
            tracing::warn!(user_id = %user.id, "Failed to fetch organization for /me: {}", e);
            None
        }
    }
    .map(|org| OrganizationInfo {
        id: org.id,
        name: org.name,
        slug: org.slug,
        tier: org.tier,
        seats: org.seats,
        subscription_status: org.subscription_status,
        current_period_end: org.current_period_end.map(|t| t.0),
        cancel_at_period_end: *org.cancel_at_period_end,
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

    tracing::info!(user_id = %user.id, outcome = "profile_updated", "User profile updated");

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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<ChangePasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers, Some(peer_addr), "change_password", 10)?;

    // Reject oversized inputs before bcrypt to prevent hash-cost amplification
    if req.current_password.len() > 1024 || req.new_password.len() > 1024 {
        return Err(AppError::Validation(
            "Password too long (max 1024 bytes)".to_string(),
        ));
    }

    // Per-user rate limit: 5 attempts per minute (bcrypt is expensive)
    let rl = state
        .rate_limiter
        .check(&format!("change_password_user:{}", user.id), 5);
    if !rl.allowed {
        return Err(AppError::RateLimitExceeded {
            retry_after_secs: rl.retry_after_secs.unwrap_or(60),
            limit: rl.limit,
            remaining: rl.remaining,
        });
    }

    // Get user with password hash
    let db_user = UserRepository::find_by_id(&state.db, &user.id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Verify current password
    let is_valid = verify_password(&req.current_password, &db_user.password_hash)?;
    if !is_valid {
        // Mirror login behaviour: increment failed attempts so brute-force of the
        // current password via change_password also triggers account lockout.
        UserRepository::increment_failed_attempts(&state.db, &user.id).await?;
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

    // Invalidate all sessions so hijacked sessions cannot survive a password change.
    // The current request's session is already authenticated — the user must re-login.
    SessionRepository::delete_by_user(&state.db, &user.id).await?;

    tracing::info!(user_id = %user.id, outcome = "password_changed", "User password changed");

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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<ForgotPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Rate limit per IP
    check_auth_rate_limit(&state, &headers, Some(peer_addr), "forgot_password", 5)?;

    // Per-email rate limit: max 3 reset requests per hour per address.
    // Keyed on a hash of the email to avoid storing PII in the rate-limit store.
    // Checked before the user lookup so we don't reveal whether the address is registered.
    {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(req.email.to_lowercase().as_bytes());
        let email_hash = hex::encode(h.finalize());
        let reset_key = format!("reset_email:{}", email_hash);
        let result = state.rate_limiter.check_hourly(&reset_key, 3);
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

    // Normalize email to lowercase before lookup
    let email = req.email.to_lowercase();

    let user = match UserRepository::find_by_email(&state.db, &email).await? {
        Some(u) => u,
        None => return Ok(ok_response()), // don't reveal whether the email is registered
    };

    // Generate a 32-byte random token, hash it for storage
    let plain_token = generate_reset_token();
    let token_hash = hash_reset_token(&plain_token, state.config.password_reset_secret.as_bytes());
    let expires_at = Utc::now() + Duration::hours(1);
    let id = uuid::Uuid::new_v4().to_string();

    // Upsert: one pending token per user at a time (conflict on user_id, not token_hash).
    // Replaces any existing pending token so old links are invalidated when a new one is requested.
    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
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
    .bind(expires_at.to_rfc3339())
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
        // plain_token is hex-encoded (only [0-9a-f] characters) so it is already
        // URL-safe and does not require percent-encoding.
        let reset_url = format!("{}/reset-password?token={}", web_base, plain_token);
        if let Err(e) = send_reset_email(&state.config, &user.email, &reset_url).await {
            tracing::warn!(user_id = %user.id, outcome = "smtp_failed", "Failed to send password reset email: {}", e);
        } else {
            tracing::info!(user_id = %user.id, outcome = "reset_email_sent", "Password reset email sent");
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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<ResetPasswordRequest>,
) -> AppResult<(HeaderMap, Json<serde_json::Value>)> {
    check_auth_rate_limit(&state, &headers, Some(peer_addr), "reset_password", 5)?;

    // Reject oversized inputs before HMAC/bcrypt
    if req.token.len() > 1024 || req.new_password.len() > 1024 {
        return Err(AppError::Validation("Input too long".to_string()));
    }

    // Validate exact token length: generate_reset_token produces 32 bytes → 64 hex chars
    if req.token.len() != 64 {
        return Err(AppError::BadRequest(
            "Invalid reset token format".to_string(),
        ));
    }

    let token_hash = hash_reset_token(&req.token, state.config.password_reset_secret.as_bytes());

    validate_password(&req.new_password)?;

    // Atomic CAS: mark the token used in a single UPDATE that also validates it.
    // This eliminates the TOCTOU race where two concurrent requests could both pass
    // the used_at check before either marks the token consumed.
    let row: Option<(String,)> = sqlx::query_as(
        r#"
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
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

    tracing::info!(user_id = %user_id, outcome = "password_reset", "Password reset successful");

    // Clear auth cookies so any active browser session is also invalidated
    let secure = state.config.cookie_secure;
    let mut response_headers = HeaderMap::new();
    for cookie in build_clear_cookies(secure) {
        response_headers.append(header::SET_COOKIE, cookie);
    }

    Ok((
        response_headers,
        Json(
            serde_json::json!({ "data": { "message": "Password reset successfully. Please log in with your new password." } }),
        ),
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

fn hash_reset_token(token: &str, secret: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts keys of any length");
    mac.update(token.as_bytes());
    hex::encode(mac.finalize().into_bytes())
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

    tokio::time::timeout(std::time::Duration::from_secs(15), transport.send(message))
        .await
        .map_err(|_| anyhow::anyhow!("SMTP send timed out after 15s"))?
        .map_err(Into::into)
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    // ── extract_client_ip ────────────────────────────────────────────────────

    #[test]
    fn trust_proxy_uses_x_forwarded_for() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.1, 10.0.0.1"),
        );
        let ip = extract_client_ip(&headers, true, None);
        assert_eq!(ip, "203.0.113.1");
    }

    #[test]
    fn trust_proxy_falls_back_to_x_real_ip() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("203.0.113.42"));
        let ip = extract_client_ip(&headers, true, None);
        assert_eq!(ip, "203.0.113.42");
    }

    #[test]
    fn no_trust_proxy_uses_peer_addr() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("1.2.3.4"));
        let peer = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 99)), 12345);
        let ip = extract_client_ip(&headers, false, Some(peer));
        assert_eq!(ip, "10.0.0.99");
    }

    #[test]
    fn no_peer_addr_and_no_headers_returns_unknown() {
        let headers = HeaderMap::new();
        let ip = extract_client_ip(&headers, false, None);
        assert_eq!(ip, "unknown");
    }

    #[test]
    fn invalid_x_forwarded_for_falls_back_to_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("not-an-ip"));
        let peer = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(5, 6, 7, 8)), 8080);
        let ip = extract_client_ip(&headers, true, Some(peer));
        assert_eq!(ip, "5.6.7.8");
    }

    // ── build_auth_cookies ───────────────────────────────────────────────────

    #[test]
    fn build_auth_cookies_returns_two_headers() {
        let cookies = build_auth_cookies("access-tok", "refresh-tok", 900, 604800, false).unwrap();
        assert_eq!(cookies.len(), 2);
        let access_str = cookies[0].to_str().unwrap();
        let refresh_str = cookies[1].to_str().unwrap();
        assert!(access_str.contains("access_token=access-tok"));
        assert!(access_str.contains("HttpOnly"));
        assert!(access_str.contains("SameSite=Strict"));
        assert!(access_str.contains("Max-Age=900"));
        assert!(refresh_str.contains("refresh_token=refresh-tok"));
        assert!(refresh_str.contains("Max-Age=604800"));
    }

    #[test]
    fn build_auth_cookies_includes_secure_flag_when_enabled() {
        let cookies = build_auth_cookies("a", "r", 900, 604800, true).unwrap();
        assert!(cookies[0].to_str().unwrap().contains("Secure"));
        assert!(cookies[1].to_str().unwrap().contains("Secure"));
    }

    #[test]
    fn build_auth_cookies_omits_secure_flag_when_disabled() {
        let cookies = build_auth_cookies("a", "r", 900, 604800, false).unwrap();
        assert!(!cookies[0].to_str().unwrap().contains("Secure"));
        assert!(!cookies[1].to_str().unwrap().contains("Secure"));
    }

    // ── build_clear_cookies ──────────────────────────────────────────────────

    #[test]
    fn build_clear_cookies_returns_two_expired_headers() {
        let cookies = build_clear_cookies(false);
        assert_eq!(cookies.len(), 2);
        let access_str = cookies[0].to_str().unwrap();
        let refresh_str = cookies[1].to_str().unwrap();
        assert!(access_str.contains("access_token="));
        assert!(access_str.contains("Max-Age=0"));
        assert!(refresh_str.contains("refresh_token="));
        assert!(refresh_str.contains("Max-Age=0"));
    }

    #[test]
    fn build_clear_cookies_includes_secure_flag() {
        let cookies = build_clear_cookies(true);
        assert!(cookies[0].to_str().unwrap().contains("Secure"));
    }

    // ── extract_user_agent ───────────────────────────────────────────────────

    #[test]
    fn extract_user_agent_present() {
        let mut headers = HeaderMap::new();
        headers.insert("user-agent", HeaderValue::from_static("Mozilla/5.0"));
        assert_eq!(extract_user_agent(&headers).as_deref(), Some("Mozilla/5.0"));
    }

    #[test]
    fn extract_user_agent_absent() {
        assert!(extract_user_agent(&HeaderMap::new()).is_none());
    }

    // ── hash_reset_token / generate_reset_token ──────────────────────────────

    #[test]
    fn hash_reset_token_deterministic() {
        let h1 = hash_reset_token("tok", b"secret");
        let h2 = hash_reset_token("tok", b"secret");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_reset_token_different_inputs_differ() {
        let h1 = hash_reset_token("tok1", b"secret");
        let h2 = hash_reset_token("tok2", b"secret");
        assert_ne!(h1, h2);
    }

    #[test]
    fn generate_reset_token_is_64_hex_chars() {
        let token = generate_reset_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_reset_token_produces_unique_values() {
        assert_ne!(generate_reset_token(), generate_reset_token());
    }

    // ── handler integration tests ────────────────────────────────────────────

    async fn make_test_app() -> axum::Router {
        let state = crate::db::test_helpers::test_app_state().await;
        axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state)
    }

    #[tokio::test]
    async fn signup_valid_request_returns_200() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let app = make_test_app().await;
        let addr: std::net::SocketAddr = "127.0.0.1:1234".parse().unwrap();
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"new@example.com","password":"StrongPass1!"}"#,
            ))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn signup_invalid_email_returns_422() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let app = make_test_app().await;
        let addr: std::net::SocketAddr = "127.0.0.1:1234".parse().unwrap();
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"not-an-email","password":"StrongPass1!"}"#,
            ))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn signup_weak_password_returns_422() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let app = make_test_app().await;
        let addr: std::net::SocketAddr = "127.0.0.1:1234".parse().unwrap();
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"user@example.com","password":"weak"}"#,
            ))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn signup_duplicate_email_returns_409() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let state = crate::db::test_helpers::test_app_state().await;
        let app = axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state);
        let addr: std::net::SocketAddr = "127.0.0.1:1234".parse().unwrap();
        let body = r#"{"email":"dup@example.com","password":"StrongPass1!"}"#;

        let r1 = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(body))
            .unwrap();
        let _ = app.clone().oneshot(r1).await.unwrap();

        let r2 = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(body))
            .unwrap();
        let response = app.oneshot(r2).await.unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn login_after_signup_returns_200() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let state = crate::db::test_helpers::test_app_state().await;
        let app = axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state);
        let addr: std::net::SocketAddr = "127.0.0.1:1234".parse().unwrap();

        let signup_req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"login@example.com","password":"StrongPass1!"}"#,
            ))
            .unwrap();
        let _ = app.clone().oneshot(signup_req).await.unwrap();

        let login_req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/login")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"login@example.com","password":"StrongPass1!"}"#,
            ))
            .unwrap();
        let response = app.oneshot(login_req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn login_wrong_password_returns_401() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let state = crate::db::test_helpers::test_app_state().await;
        let app = axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state);
        let addr: std::net::SocketAddr = "127.0.0.1:1234".parse().unwrap();

        let signup_req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"wrongpw@example.com","password":"StrongPass1!"}"#,
            ))
            .unwrap();
        let _ = app.clone().oneshot(signup_req).await.unwrap();

        let login_req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/login")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(addr))
            .body(Body::from(
                r#"{"email":"wrongpw@example.com","password":"BadPass1!"}"#,
            ))
            .unwrap();
        let response = app.oneshot(login_req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn me_without_auth_returns_401() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let app = make_test_app().await;
        let request = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    // ── helpers for multi-endpoint tests ────────────────────────────────────

    fn peer() -> std::net::SocketAddr {
        "127.0.0.1:1234".parse().unwrap()
    }

    /// Sign up and return (access_token, refresh_token) from Set-Cookie headers.
    async fn signup_and_get_tokens(app: &axum::Router, email: &str) -> (String, String) {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(format!(
                r#"{{"email":"{}","password":"StrongPass1!"}}"#,
                email
            )))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let mut access = String::new();
        let mut refresh = String::new();
        for v in resp.headers().get_all("set-cookie") {
            let s = v.to_str().unwrap_or("");
            if let Some(rest) = s.strip_prefix("access_token=") {
                access = rest.split(';').next().unwrap_or("").to_string();
            } else if let Some(rest) = s.strip_prefix("refresh_token=") {
                refresh = rest.split(';').next().unwrap_or("").to_string();
            }
        }
        assert!(!access.is_empty(), "no access_token in signup response");
        (access, refresh)
    }

    // ── GET /auth/me (authenticated) ─────────────────────────────────────────

    #[tokio::test]
    async fn me_authenticated_returns_user_data() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "me_authed@example.com").await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(json["data"]["email"]
            .as_str()
            .unwrap()
            .contains("me_authed"));
    }

    // ── PATCH /auth/me ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn update_profile_sets_name() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "profile_upd@example.com").await;
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/v1/auth/me")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"Alice"}"#))
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn update_profile_empty_name_returns_422() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "profile_empty@example.com").await;
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/v1/auth/me")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"   "}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    // ── POST /auth/logout ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn logout_returns_200_and_clears_cookies() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "logout_ok@example.com").await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/logout")
            .header("authorization", format!("Bearer {}", token))
            .header("cookie", format!("access_token={}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let has_max_age_0 = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .any(|v| v.to_str().unwrap_or("").contains("Max-Age=0"));
        assert!(has_max_age_0, "logout should clear cookies");
    }

    #[tokio::test]
    async fn logout_without_cookie_returns_401() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "logout_nocookie@example.com").await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/logout")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── POST /auth/refresh ────────────────────────────────────────────────────

    #[tokio::test]
    async fn refresh_without_cookie_returns_401() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/refresh")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn refresh_with_valid_token_returns_200() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (_, refresh) = signup_and_get_tokens(&app, "refresh_ok@example.com").await;
        assert!(!refresh.is_empty(), "no refresh_token cookie");
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/refresh")
            .header("cookie", format!("refresh_token={}", refresh))
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    // ── POST /auth/change-password ────────────────────────────────────────────

    #[tokio::test]
    async fn change_password_succeeds() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "changepw@example.com").await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/change-password")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(
                r#"{"current_password":"StrongPass1!","new_password":"NewPass2@"}"#,
            ))
            .unwrap();
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn change_password_wrong_current_returns_401() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let (token, _) = signup_and_get_tokens(&app, "changepw_wrong@example.com").await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/change-password")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(
                r#"{"current_password":"WrongPass1!","new_password":"NewPass2@"}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── POST /auth/forgot-password ────────────────────────────────────────────

    #[tokio::test]
    async fn forgot_password_unknown_email_returns_200() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        let app = make_test_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/forgot-password")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(r#"{"email":"nobody@example.com"}"#))
            .unwrap();
        // Always 200 regardless of whether email exists (prevents enumeration)
        assert_eq!(app.oneshot(req).await.unwrap().status(), StatusCode::OK);
    }
}
