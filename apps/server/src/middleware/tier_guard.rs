use axum::{
    extract::State,
    http::StatusCode,
};

use crate::{
    auth::AuthUser,
    billing::tiers::{can_access_feature, tier_includes, Tier},
    db::repositories::OrganizationRepository,
    AppState,
};

/// Check if user has the required tier or higher
/// Returns the tier name if access is granted, or an error if not
pub async fn require_tier(
    required_tier: &str,
    user: &AuthUser,
    state: &AppState,
) -> Result<String, (StatusCode, String)> {
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

/// Check if user has access to a specific feature
pub async fn require_feature(
    feature: &str,
    user: &AuthUser,
    state: &AppState,
) -> Result<String, (StatusCode, String)> {
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
}

impl TierGuard {
    /// Create a tier guard for a user, fetching their organization
    pub async fn for_user(
        user: &AuthUser,
        state: &AppState,
    ) -> Result<Self, (StatusCode, String)> {
        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((
                StatusCode::FORBIDDEN,
                "No organization found. Please set up your account.".to_string(),
            ))?;

        Ok(Self {
            tier: org.tier,
            organization_id: org.id,
        })
    }

    /// Check if user has access to the required tier
    pub fn has_tier(&self, required: &str) -> bool {
        tier_includes(&self.tier, required)
    }

    /// Check if user has access to a feature
    pub fn has_feature(&self, feature: &str) -> bool {
        can_access_feature(&self.tier, feature)
    }

    /// Require a specific tier, returning error if not met
    pub fn require_tier(&self, required: &str) -> Result<(), (StatusCode, String)> {
        if !self.has_tier(required) {
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
        if !self.has_feature(feature) {
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
    pub const JIRA_INTEGRATION: &str = "jira";
    pub const LINEAR_INTEGRATION: &str = "linear";
    pub const GITHUB_INTEGRATION: &str = "github";
    pub const SSO: &str = "sso";
    pub const ADVANCED_ALERTING: &str = "advanced_alerting";
    pub const API_ACCESS: &str = "api_access";
}
