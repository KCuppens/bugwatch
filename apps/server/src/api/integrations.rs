use axum::{
    body::Bytes,
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{error, info};

use super::ApiResponse;
use crate::{
    auth::AuthUser,
    db::repositories::{
        IntegrationRepository, IssueLinkRepository, IssueRepository, OrganizationRepository,
        ProjectRepository,
    },
    middleware::tier_guard::{features, TierGuard},
    services::integrations::{format_issue_body, GitHubService, JiraService, LinearService},
    AppError, AppResult, AppState,
};

// ============================================================================
// Response types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct IntegrationResponse {
    pub id: String,
    pub organization_id: String,
    pub provider: String,
    pub external_username: Option<String>,
    pub config: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct IssueLinkResponse {
    pub id: String,
    pub issue_id: String,
    pub integration_id: String,
    pub provider: String,
    pub external_issue_id: String,
    pub external_issue_key: String,
    pub external_issue_url: String,
    pub external_status: Option<String>,
    pub sync_enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct OAuthUrlResponse {
    pub url: String,
}

// ============================================================================
// Request types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateIssueLinkRequest {
    pub provider: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackParams {
    pub code: String,
    pub state: Option<String>,
}

// ============================================================================
// List integrations
// ============================================================================

/// GET /api/v1/integrations
pub async fn list_integrations(
    State(state): State<AppState>,
    auth_user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
) -> AppResult<Json<ApiResponse<Vec<IntegrationResponse>>>> {
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let guard = TierGuard::for_user(&auth_user, &state)
            .await
            .map_err(|(_status, msg)| AppError::Forbidden(msg))?;
        if !guard.has_feature(features::GITHUB_INTEGRATION) {
            return Err(crate::payments::x402_feature_response(
                &state,
                features::GITHUB_INTEGRATION,
                "/api/v1/integrations",
                &guard.organization_id,
                None,
                &format!(
                    "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                    features::GITHUB_INTEGRATION, guard.tier
                ),
            ).await);
        }
    }

    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    let integrations = IntegrationRepository::list_by_organization(&state.db, &org.id).await?;

    let response: Vec<IntegrationResponse> = integrations
        .into_iter()
        .map(|i| IntegrationResponse {
            id: i.id,
            organization_id: i.organization_id,
            provider: i.provider,
            external_username: i.external_username,
            config: serde_json::from_str(&i.config).unwrap_or(serde_json::json!({})),
            created_at: i.created_at.to_rfc3339(),
            updated_at: i.updated_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(ApiResponse { data: response }))
}

// ============================================================================
// OAuth authorize
// ============================================================================

/// GET /api/v1/integrations/oauth/:provider/authorize
pub async fn oauth_authorize(
    State(state): State<AppState>,
    auth_user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path(provider): Path<String>,
) -> AppResult<Json<ApiResponse<OAuthUrlResponse>>> {
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let guard = TierGuard::for_user(&auth_user, &state)
            .await
            .map_err(|(_status, msg)| AppError::Forbidden(msg))?;
        if !guard.has_feature(features::GITHUB_INTEGRATION) {
            return Err(crate::payments::x402_feature_response(
                &state,
                features::GITHUB_INTEGRATION,
                &format!("/api/v1/integrations/oauth/{}/authorize", provider),
                &guard.organization_id,
                None,
                &format!(
                    "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                    features::GITHUB_INTEGRATION, guard.tier
                ),
            ).await);
        }
    }

    let redirect_uri = format!(
        "{}/api/v1/integrations/oauth/{}/callback",
        state.config.app_url, provider
    );

    // Generate CSRF-safe state: HMAC-sign the user_id with a dedicated OAuth secret.
    // Falls back to JWT secret if OAUTH_STATE_SECRET is not configured.
    let oauth_secret = state.config.oauth_state_secret.clone();
    let state_data = format!("{}:{}", auth_user.id, chrono::Utc::now().timestamp());
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac =
        HmacSha256::new_from_slice(oauth_secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(state_data.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());
    let state_param = format!("{}:{}", state_data, signature);

    let url = match provider.as_str() {
        "github" => {
            let client_id = state.config.github_client_id.as_ref().ok_or_else(|| {
                AppError::BadRequest("GitHub OAuth is not configured".to_string())
            })?;
            format!(
                "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=repo&state={}",
                client_id,
                urlencoding::encode(&redirect_uri),
                urlencoding::encode(&state_param)
            )
        }
        "jira" => {
            let client_id =
                state.config.jira_client_id.as_ref().ok_or_else(|| {
                    AppError::BadRequest("Jira OAuth is not configured".to_string())
                })?;
            format!(
                "https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id={}&scope=read%3Ajira-work%20write%3Ajira-work%20read%3Ajira-user&redirect_uri={}&state={}&response_type=code&prompt=consent",
                client_id,
                urlencoding::encode(&redirect_uri),
                urlencoding::encode(&state_param)
            )
        }
        "linear" => {
            let client_id = state.config.linear_client_id.as_ref().ok_or_else(|| {
                AppError::BadRequest("Linear OAuth is not configured".to_string())
            })?;
            format!(
                "https://linear.app/oauth/authorize?client_id={}&redirect_uri={}&scope=read,write,issues:create&state={}&response_type=code&prompt=consent",
                client_id,
                urlencoding::encode(&redirect_uri),
                urlencoding::encode(&state_param)
            )
        }
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unknown provider: {}",
                provider
            )))
        }
    };

    Ok(Json(ApiResponse {
        data: OAuthUrlResponse { url },
    }))
}

// ============================================================================
// OAuth callback
// ============================================================================

/// GET /api/v1/integrations/oauth/:provider/callback
pub async fn oauth_callback(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(provider): Path<String>,
    Query(params): Query<OAuthCallbackParams>,
) -> AppResult<axum::response::Redirect> {
    // Rate-limit OAuth callbacks to prevent code enumeration (10 req/min per IP).
    {
        let ip = crate::api::auth::extract_client_ip(
            &headers,
            state.config.trust_proxy,
            Some(peer_addr),
        );
        let key = format!("oauth:{}", ip);
        let result = state.rate_limiter.check(&key, 10);
        if !result.allowed {
            return Err(AppError::RateLimitExceeded {
                retry_after_secs: result.retry_after_secs.unwrap_or(60),
                limit: result.limit,
                remaining: result.remaining,
            });
        }
    }

    let state_str = params.state.as_deref().unwrap_or("");
    let redirect_uri = format!(
        "{}/api/v1/integrations/oauth/{}/callback",
        state.config.app_url, provider
    );
    let redirect_url = format!(
        "{}/dashboard/settings?tab=integrations",
        state.config.app_url
    );

    // Parse and verify HMAC-signed state parameter (splitn(3) caps at 3 parts, safe against colons in user_id)
    let parts: Vec<&str> = state_str.splitn(3, ':').collect();
    if parts.len() != 3 {
        return Err(AppError::BadRequest("Invalid OAuth state".to_string()));
    }
    let user_id = parts[0];
    let timestamp = parts[1];
    let signature = parts[2];

    // Verify HMAC
    let state_data = format!("{}:{}", user_id, timestamp);
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let oauth_secret = state.config.oauth_state_secret.clone();
    let mut mac =
        HmacSha256::new_from_slice(oauth_secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(state_data.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    if signature != expected {
        return Err(AppError::BadRequest(
            "Invalid OAuth state signature".to_string(),
        ));
    }

    // Check timestamp is not too old (max 10 minutes)
    let ts: i64 = timestamp
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid state".to_string()))?;
    // Reject states older than 10 minutes OR with a timestamp in the future (clock skew > 5 min).
    let now = chrono::Utc::now().timestamp();
    if (now - ts).abs() > 600 || ts > now + 300 {
        return Err(AppError::BadRequest("OAuth state expired".to_string()));
    }

    // Verify the user from the HMAC-signed state still exists (may have been deleted since flow started)
    let user_exists = crate::db::repositories::UserRepository::find_by_id(&state.db, user_id)
        .await
        .map_err(|e| AppError::Internal(format!("DB error checking user: {}", e)))?
        .is_some();
    if !user_exists {
        return Err(AppError::BadRequest(
            "OAuth state invalid: user not found".to_string(),
        ));
    }

    let result: Result<
        (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ),
        AppError,
    > = match provider.as_str() {
        "github" => {
            let client_id =
                state.config.github_client_id.as_ref().ok_or_else(|| {
                    AppError::BadRequest("GitHub OAuth not configured".to_string())
                })?;
            let client_secret =
                state.config.github_client_secret.as_ref().ok_or_else(|| {
                    AppError::BadRequest("GitHub OAuth not configured".to_string())
                })?;

            let (access_token, refresh_token) =
                GitHubService::exchange_code(client_id, client_secret, &params.code)
                    .await
                    .map_err(|e| AppError::Internal(format!("GitHub OAuth failed: {}", e)))?;

            let (ext_user_id, ext_username) = GitHubService::get_user(&access_token)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to get GitHub user: {}", e)))?;

            Ok((
                access_token,
                refresh_token,
                Some(ext_user_id),
                Some(ext_username),
                "{}".to_string(),
            ))
        }
        "jira" => {
            let client_id = state
                .config
                .jira_client_id
                .as_ref()
                .ok_or_else(|| AppError::BadRequest("Jira OAuth not configured".to_string()))?;
            let client_secret = state
                .config
                .jira_client_secret
                .as_ref()
                .ok_or_else(|| AppError::BadRequest("Jira OAuth not configured".to_string()))?;

            let (access_token, refresh_token, cloud_id) =
                JiraService::exchange_code(client_id, client_secret, &params.code, &redirect_uri)
                    .await
                    .map_err(|e| AppError::Internal(format!("Jira OAuth failed: {}", e)))?;

            let (ext_user_id, ext_username) = JiraService::get_user(&access_token)
                .await
                .inspect_err(|e| tracing::warn!("Failed to fetch Jira user info: {}", e))
                .unwrap_or(("unknown".to_string(), "Jira User".to_string()));

            // Store cloud_id in config JSON for later API calls
            let config = serde_json::json!({ "cloud_id": cloud_id });

            Ok((
                access_token,
                refresh_token,
                Some(ext_user_id),
                Some(ext_username),
                config.to_string(),
            ))
        }
        "linear" => {
            let client_id =
                state.config.linear_client_id.as_ref().ok_or_else(|| {
                    AppError::BadRequest("Linear OAuth not configured".to_string())
                })?;
            let client_secret =
                state.config.linear_client_secret.as_ref().ok_or_else(|| {
                    AppError::BadRequest("Linear OAuth not configured".to_string())
                })?;

            let access_token =
                LinearService::exchange_code(client_id, client_secret, &params.code, &redirect_uri)
                    .await
                    .map_err(|e| AppError::Internal(format!("Linear OAuth failed: {}", e)))?;

            let (ext_user_id, ext_username) = LinearService::get_user(&access_token)
                .await
                .inspect_err(|e| tracing::warn!("Failed to fetch Linear user info: {}", e))
                .unwrap_or(("unknown".to_string(), "Linear User".to_string()));

            Ok((
                access_token,
                None,
                Some(ext_user_id),
                Some(ext_username),
                "{}".to_string(),
            ))
        }
        _ => Err(AppError::BadRequest(format!(
            "Unknown provider: {}",
            provider
        ))),
    };

    match result {
        Ok((access_token, refresh_token, ext_user_id, ext_username, config)) => {
            // Look up user's organization
            match OrganizationRepository::find_by_user(&state.db, user_id).await {
                Ok(Some(org)) => {
                    if let Err(e) = IntegrationRepository::create(
                        &state.db,
                        &org.id,
                        &provider,
                        &access_token,
                        refresh_token.as_deref(),
                        None,
                        ext_user_id.as_deref(),
                        ext_username.as_deref(),
                        &config,
                        user_id,
                    )
                    .await
                    {
                        error!("Failed to save integration: {}", e);
                        let redirect = format!("{}?error=save_failed", redirect_url);
                        return Ok(axum::response::Redirect::temporary(&redirect));
                    }
                    info!("Integration {} connected for org {}", provider, org.id);
                }
                Ok(None) => {
                    error!(
                        user_id,
                        "No organization found for user during OAuth callback"
                    );
                    return Ok(axum::response::Redirect::temporary(&format!(
                        "{}/dashboard/settings?tab=integrations&error=no_org",
                        state.config.app_url
                    )));
                }
                Err(e) => {
                    error!(
                        user_id,
                        "DB error looking up org during OAuth callback: {}", e
                    );
                    return Ok(axum::response::Redirect::temporary(&format!(
                        "{}/dashboard/settings?tab=integrations&error=server_error",
                        state.config.app_url
                    )));
                }
            }
            Ok(axum::response::Redirect::temporary(&format!(
                "{}/dashboard/settings?tab=integrations&connected={}",
                state.config.app_url, provider
            )))
        }
        Err(e) => {
            error!("OAuth callback error: {}", e);
            Ok(axum::response::Redirect::temporary(&format!(
                "{}/dashboard/settings?tab=integrations&error={}",
                state.config.app_url,
                urlencoding::encode(&format!("Failed to connect {}", provider))
            )))
        }
    }
}

// ============================================================================
// Delete integration
// ============================================================================

/// DELETE /api/v1/integrations/:integration_id
pub async fn delete_integration(
    State(state): State<AppState>,
    auth_user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path(integration_id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let guard = TierGuard::for_user(&auth_user, &state)
            .await
            .map_err(|(_status, msg)| AppError::Forbidden(msg))?;
        if !guard.has_feature(features::GITHUB_INTEGRATION) {
            return Err(crate::payments::x402_feature_response(
                &state,
                features::GITHUB_INTEGRATION,
                &format!("/api/v1/integrations/{}", integration_id),
                &guard.organization_id,
                None,
                &format!(
                    "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                    features::GITHUB_INTEGRATION, guard.tier
                ),
            ).await);
        }
    }

    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    let integration = IntegrationRepository::find_by_id(&state.db, &integration_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Integration not found".to_string()))?;

    if integration.organization_id != org.id {
        return Err(AppError::Forbidden("Integration not found".to_string()));
    }

    IntegrationRepository::delete(&state.db, &integration_id).await?;
    info!(
        "Integration {} disconnected by user {}",
        integration.provider, auth_user.id
    );

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Integration disconnected successfully" }),
    }))
}

// ============================================================================
// Create issue link
// ============================================================================

/// POST /api/v1/projects/:project_id/issues/:issue_id/links
pub async fn create_issue_link(
    State(state): State<AppState>,
    auth_user: AuthUser,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path((project_id, issue_id)): Path<(String, String)>,
    Json(req): Json<CreateIssueLinkRequest>,
) -> AppResult<Json<ApiResponse<IssueLinkResponse>>> {
    if !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let guard = TierGuard::for_user(&auth_user, &state)
            .await
            .map_err(|(_status, msg)| AppError::Forbidden(msg))?;
        if !guard.has_feature(features::GITHUB_INTEGRATION) {
            return Err(crate::payments::x402_feature_response(
                &state,
                features::GITHUB_INTEGRATION,
                &format!("/api/v1/projects/{}/issues/{}/links", project_id, issue_id),
                &guard.organization_id,
                None,
                &format!(
                    "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                    features::GITHUB_INTEGRATION, guard.tier
                ),
            ).await);
        }
    }

    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    // Verify the project belongs to the user's org
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.organization_id != Some(org.id.clone()) && project.owner_id != auth_user.id {
        return Err(AppError::Forbidden(
            "You do not have access to this project".to_string(),
        ));
    }

    // Verify the issue exists
    let issue = IssueRepository::find_by_id(&state.db, &issue_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Issue not found".to_string()))?;

    if issue.project_id != project_id {
        return Err(AppError::NotFound(
            "Issue not found in this project".to_string(),
        ));
    }

    // Get the integration for this provider
    let integration =
        IntegrationRepository::find_by_org_and_provider(&state.db, &org.id, &req.provider)
            .await?
            .ok_or_else(|| AppError::BadRequest(format!("{} is not connected", req.provider)))?;

    let title = req
        .config
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(&issue.title);
    let description = req
        .config
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let event_url = format!(
        "{}/dashboard/issues/{}?project={}",
        state.config.app_url, issue_id, project_id
    );
    let body = format_issue_body(
        title,
        &issue_id,
        &event_url,
        if description.is_empty() {
            None
        } else {
            Some(description)
        },
    );

    // Create the issue on the external provider
    let external_issue = match req.provider.as_str() {
        "github" => {
            let owner = req
                .config
                .get("owner")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("owner is required for GitHub".to_string()))?;
            let repo = req
                .config
                .get("repo")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("repo is required for GitHub".to_string()))?;
            if owner.is_empty()
                || !owner
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
            {
                return Err(AppError::Validation(
                    "owner contains invalid characters".to_string(),
                ));
            }
            if owner.len() > 39 {
                return Err(AppError::Validation(
                    "owner must be 39 characters or fewer".to_string(),
                ));
            }
            if repo.is_empty()
                || !repo
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
            {
                return Err(AppError::Validation(
                    "repo contains invalid characters".to_string(),
                ));
            }
            if repo.len() > 100 {
                return Err(AppError::Validation(
                    "repo must be 100 characters or fewer".to_string(),
                ));
            }
            GitHubService::create_issue(&integration.access_token, owner, repo, title, &body)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to create GitHub issue: {}", e)))?
        }
        "jira" => {
            let integration_config: serde_json::Value =
                serde_json::from_str(&integration.config).unwrap_or(serde_json::json!({}));
            let cloud_id = integration_config
                .get("cloud_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::BadRequest(
                        "Jira cloud_id not found in integration config. Please reconnect Jira."
                            .to_string(),
                    )
                })?;
            let project_key = req
                .config
                .get("project_key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::Validation("project_key is required for Jira".to_string())
                })?;
            if project_key.len() < 2
                || project_key.len() > 10
                || !project_key
                    .chars()
                    .next()
                    .map_or(false, |c| c.is_ascii_uppercase())
                || !project_key
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
            {
                return Err(AppError::Validation(
                    "project_key must be 2–10 uppercase letters/digits starting with a letter"
                        .to_string(),
                ));
            }
            JiraService::create_issue(
                &integration.access_token,
                cloud_id,
                project_key,
                title,
                &body,
            )
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create Jira issue: {}", e)))?
        }
        "linear" => {
            let team_id = req
                .config
                .get("team_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::Validation("team_id is required for Linear".to_string())
                })?;
            LinearService::create_issue(&integration.access_token, team_id, title, &body)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to create Linear issue: {}", e)))?
        }
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unknown provider: {}",
                req.provider
            )))
        }
    };

    // Store the link
    let link = IssueLinkRepository::create(
        &state.db,
        &issue_id,
        &integration.id,
        &req.provider,
        &external_issue.id,
        &external_issue.key,
        &external_issue.url,
        external_issue.status.as_deref(),
    )
    .await?;

    info!(
        "Created {} issue link {} for issue {}",
        req.provider, external_issue.key, issue_id
    );

    Ok(Json(ApiResponse {
        data: IssueLinkResponse {
            id: link.id,
            issue_id: link.issue_id,
            integration_id: link.integration_id,
            provider: link.provider,
            external_issue_id: link.external_issue_id,
            external_issue_key: link.external_issue_key,
            external_issue_url: link.external_issue_url,
            external_status: link.external_status,
            sync_enabled: link.sync_enabled,
            created_at: link.created_at.to_rfc3339(),
        },
    }))
}

// ============================================================================
// List issue links
// ============================================================================

/// GET /api/v1/projects/:project_id/issues/:issue_id/links
pub async fn list_issue_links(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, issue_id)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<Vec<IssueLinkResponse>>>> {
    // Basic auth check - no tier gate for reading links
    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    // Verify the project belongs to the user's org
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.organization_id != Some(org.id.clone()) && project.owner_id != auth_user.id {
        return Err(AppError::Forbidden(
            "You do not have access to this project".to_string(),
        ));
    }

    let links = IssueLinkRepository::list_by_issue(&state.db, &issue_id).await?;

    let response: Vec<IssueLinkResponse> = links
        .into_iter()
        .map(|l| IssueLinkResponse {
            id: l.id,
            issue_id: l.issue_id,
            integration_id: l.integration_id,
            provider: l.provider,
            external_issue_id: l.external_issue_id,
            external_issue_key: l.external_issue_key,
            external_issue_url: l.external_issue_url,
            external_status: l.external_status,
            sync_enabled: l.sync_enabled,
            created_at: l.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(ApiResponse { data: response }))
}

// ============================================================================
// Delete issue link
// ============================================================================

/// DELETE /api/v1/projects/:project_id/issues/:issue_id/links/:link_id
pub async fn delete_issue_link(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, _issue_id, link_id)): Path<(String, String, String)>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let org = OrganizationRepository::find_by_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| AppError::BadRequest("No organization found".to_string()))?;

    // Verify the project belongs to the user's org
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.organization_id != Some(org.id.clone()) && project.owner_id != auth_user.id {
        return Err(AppError::Forbidden(
            "You do not have access to this project".to_string(),
        ));
    }

    let link = IssueLinkRepository::find_by_id(&state.db, &link_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Issue link not found".to_string()))?;

    IssueLinkRepository::delete(&state.db, &link.id).await?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({ "message": "Issue link removed" }),
    }))
}

// ============================================================================
// Webhooks (no auth - verified by provider signatures)
// ============================================================================

/// Verify an HMAC-SHA256 signature against a payload using constant-time comparison.
/// Always computes the HMAC to avoid timing leaks from hex decode failures.
fn verify_webhook_signature(payload: &[u8], signature: &str, secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;

    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(payload);

    // Decode hex signature; on failure, use a dummy value so we still do
    // constant-time comparison (prevents timing oracle on hex validity).
    let sig_bytes = hex::decode(signature.trim()).unwrap_or_else(|_| vec![0u8; 32]);
    mac.verify_slice(&sig_bytes).is_ok()
}

/// Validate that a webhook secret is non-empty.
fn require_non_empty_secret(secret: &str, provider: &str) -> AppResult<()> {
    if secret.is_empty() {
        error!("{} webhook secret is empty - rejecting webhook", provider);
        return Err(AppError::Forbidden(
            "Webhook secret not configured".to_string(),
        ));
    }
    Ok(())
}

/// POST /api/v1/webhooks/github - GitHub webhook for status sync
pub async fn github_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<serde_json::Value>> {
    // Verify X-Hub-Signature-256
    let secret = state
        .config
        .github_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            error!("GITHUB_WEBHOOK_SECRET not configured - rejecting webhook");
            AppError::Forbidden("Webhook secret not configured".to_string())
        })?;
    require_non_empty_secret(secret, "GitHub")?;

    let sig_header = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .ok_or_else(|| AppError::Forbidden("Missing X-Hub-Signature-256 header".to_string()))?;

    // GitHub sends "sha256=<hex>"
    let signature = sig_header
        .strip_prefix("sha256=")
        .ok_or_else(|| AppError::Forbidden("Invalid signature format".to_string()))?;

    if !verify_webhook_signature(&body, signature, secret) {
        return Err(AppError::Forbidden("Invalid webhook signature".to_string()));
    }

    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let action = payload["action"].as_str().unwrap_or("");
    let issue = &payload["issue"];

    if action == "closed" || action == "reopened" {
        let raw_id = match issue["id"].as_i64() {
            Some(id) if id > 0 => id,
            _ => {
                tracing::warn!("GitHub webhook missing or invalid issue id, ignoring");
                return Ok(Json(serde_json::json!({ "ok": true })));
            }
        };
        let issue_id = raw_id.to_string();
        let status = if action == "closed" { "closed" } else { "open" };

        let updated =
            IssueLinkRepository::update_status(&state.db, "github", &issue_id, status).await?;
        if updated > 0 {
            info!("Synced GitHub issue {} status to {}", issue_id, status);
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /api/v1/webhooks/jira - Jira webhook for status sync
pub async fn jira_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<serde_json::Value>> {
    // Verify X-Hub-Signature
    let secret = state.config.jira_webhook_secret.as_deref().ok_or_else(|| {
        error!("JIRA_WEBHOOK_SECRET not configured - rejecting webhook");
        AppError::Forbidden("Webhook secret not configured".to_string())
    })?;
    require_non_empty_secret(secret, "Jira")?;

    let sig_header = headers
        .get("x-hub-signature")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .ok_or_else(|| AppError::Forbidden("Missing X-Hub-Signature header".to_string()))?;

    // Jira may send with or without sha256= prefix
    let signature = sig_header.strip_prefix("sha256=").unwrap_or(sig_header);

    if !verify_webhook_signature(&body, signature, secret) {
        return Err(AppError::Forbidden("Invalid webhook signature".to_string()));
    }

    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let webhook_event = payload["webhookEvent"].as_str().unwrap_or("");

    if webhook_event == "jira:issue_updated" {
        let issue = &payload["issue"];
        let issue_id = issue["id"].as_str().unwrap_or("");
        let status = issue["fields"]["status"]["name"]
            .as_str()
            .unwrap_or("Unknown");

        let updated =
            IssueLinkRepository::update_status(&state.db, "jira", issue_id, status).await?;
        if updated > 0 {
            info!("Synced Jira issue {} status to {}", issue_id, status);
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /api/v1/webhooks/linear - Linear webhook for status sync
pub async fn linear_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<serde_json::Value>> {
    // Verify Linear-Signature
    let secret = state
        .config
        .linear_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            error!("LINEAR_WEBHOOK_SECRET not configured - rejecting webhook");
            AppError::Forbidden("Webhook secret not configured".to_string())
        })?;
    require_non_empty_secret(secret, "Linear")?;

    let signature = headers
        .get("linear-signature")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .ok_or_else(|| AppError::Forbidden("Missing Linear-Signature header".to_string()))?;

    if !verify_webhook_signature(&body, signature, secret) {
        return Err(AppError::Forbidden("Invalid webhook signature".to_string()));
    }

    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let action = payload["action"].as_str().unwrap_or("");
    let data_type = payload["type"].as_str().unwrap_or("");

    if data_type == "Issue" && (action == "update" || action == "create") {
        let data = &payload["data"];
        let issue_id = data["id"].as_str().unwrap_or("");
        let state_label = data["state"]["name"].as_str().unwrap_or("Unknown");

        let updated =
            IssueLinkRepository::update_status(&state.db, "linear", issue_id, state_label).await?;
        if updated > 0 {
            info!("Synced Linear issue {} status to {}", issue_id, state_label);
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
