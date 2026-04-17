use axum::http::StatusCode;

use crate::{
    auth::AuthUser,
    billing::tiers::{can_access_feature, tier_includes, Tier},
    db::repositories::OrganizationRepository,
    payments::X402PaymentVerified,
    AppState,
};

/// Check if user has the required tier or higher.
/// Returns the tier name if access is granted, or an error if not.
/// In self-hosted mode, all tier checks are bypassed.
/// Note: does not check for x402 payment bypass — use inline `x402_verified` checks in handlers.
pub async fn require_tier(
    required_tier: &str,
    user: &AuthUser,
    state: &AppState,
) -> Result<String, (StatusCode, String)> {
    // Self-hosted mode: all tiers are unlocked
    if state.config.deployment_mode.is_self_hosted() {
        return Ok("team".to_string());
    }

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            StatusCode::FORBIDDEN,
            "No organization found. Please set up your account.".to_string(),
        ))?;

    if !tier_includes(&org.tier, required_tier) {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            format!(
                "This feature requires {} tier or higher. You are currently on {} tier.",
                required_tier, org.tier
            ),
        ));
    }

    Ok(org.tier)
}

/// Check if user has access to a specific feature.
/// In self-hosted mode, all features are unlocked.
/// Note: does not check for x402 payment bypass — use inline `x402_verified` checks in handlers.
pub async fn require_feature(
    feature: &str,
    user: &AuthUser,
    state: &AppState,
) -> Result<String, (StatusCode, String)> {
    // Self-hosted mode: all features are unlocked
    if state.config.deployment_mode.is_self_hosted() {
        return Ok("team".to_string());
    }

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            StatusCode::FORBIDDEN,
            "No organization found. Please set up your account.".to_string(),
        ))?;

    if !can_access_feature(&org.tier, feature) {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            format!(
                "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                feature, org.tier
            ),
        ));
    }

    Ok(org.tier)
}

/// Guard struct for easy tier checks in handlers
pub struct TierGuard {
    pub tier: String,
    pub organization_id: String,
    /// Set to true when a valid x402 feature_access payment was verified for this request.
    /// When true, all tier/feature checks are bypassed.
    pub x402_bypass: bool,
}

impl TierGuard {
    /// Create a tier guard for a user, fetching their organization.
    /// In self-hosted mode, returns unlimited access.
    pub async fn for_user(user: &AuthUser, state: &AppState) -> Result<Self, (StatusCode, String)> {
        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((
                StatusCode::FORBIDDEN,
                "No organization found. Please set up your account.".to_string(),
            ))?;

        let tier = if state.config.deployment_mode.is_self_hosted() {
            "team".to_string()
        } else {
            org.tier
        };

        Ok(Self {
            tier,
            organization_id: org.id,
            x402_bypass: false,
        })
    }

    /// Create a tier guard for a user with request extensions, detecting x402 payment bypass.
    /// Checks for `X402PaymentVerified` in request extensions and sets `x402_bypass` accordingly.
    pub async fn for_user_with_parts(
        user: &AuthUser,
        state: &AppState,
        parts: &axum::http::request::Parts,
    ) -> Result<Self, (StatusCode, String)> {
        let x402_bypass = parts.extensions.get::<X402PaymentVerified>().is_some();
        let mut guard = Self::for_user(user, state).await?;
        guard.x402_bypass = x402_bypass;
        Ok(guard)
    }

    /// Check if user has access to the required tier
    pub fn has_tier(&self, required: &str) -> bool {
        self.x402_bypass || tier_includes(&self.tier, required)
    }

    /// Check if user has access to a feature
    pub fn has_feature(&self, feature: &str) -> bool {
        self.x402_bypass || can_access_feature(&self.tier, feature)
    }

    /// Require a specific tier, returning error if not met
    pub fn require_tier(&self, required: &str) -> Result<(), (StatusCode, String)> {
        // If a valid x402 feature_access payment was already verified by middleware, bypass this check
        if self.x402_bypass {
            return Ok(());
        }
        if !tier_includes(&self.tier, required) {
            return Err((
                StatusCode::PAYMENT_REQUIRED,
                format!(
                    "This feature requires {} tier or higher. You are currently on {} tier.",
                    required, self.tier
                ),
            ));
        }
        Ok(())
    }

    /// Require a specific feature, returning error if not available
    pub fn require_feature(&self, feature: &str) -> Result<(), (StatusCode, String)> {
        // If a valid x402 feature_access payment was already verified by middleware, bypass this check
        if self.x402_bypass {
            return Ok(());
        }
        if !can_access_feature(&self.tier, feature) {
            return Err((
                StatusCode::PAYMENT_REQUIRED,
                format!(
                    "The '{}' feature is not available on your current plan ({}). Please upgrade to access this feature.",
                    feature, self.tier
                ),
            ));
        }
        Ok(())
    }

    /// Get the tier enum
    pub fn tier_enum(&self) -> Tier {
        Tier::from_str(&self.tier)
    }
}

/// Feature names that can be gated
pub mod features {
    pub const WEBHOOKS: &str = "webhooks";
    pub const PAGERDUTY: &str = "pagerduty";
    pub const OPSGENIE: &str = "opsgenie";
    pub const SESSION_REPLAY: &str = "session_replay";
    pub const PERFORMANCE_MONITORING: &str = "performance_monitoring";
    pub const SERVER_MONITORING: &str = "server_monitoring";
    pub const EMAIL_NOTIFICATIONS: &str = "email_notifications";
    pub const JIRA_INTEGRATION: &str = "jira";
    pub const LINEAR_INTEGRATION: &str = "linear";
    pub const GITHUB_INTEGRATION: &str = "github";
    pub const SSO: &str = "sso";
    pub const ADVANCED_ALERTING: &str = "advanced_alerting";
    pub const API_ACCESS: &str = "api_access";
}
