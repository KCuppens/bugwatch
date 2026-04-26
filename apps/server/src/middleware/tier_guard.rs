use axum::http::StatusCode;

use crate::{
    auth::AuthUser,
    billing::tiers::{can_access_feature, tier_includes, Tier},
    db::repositories::OrganizationRepository,
    payments::X402PaymentVerified,
    AppState,
};

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

        // G4: Block access for canceled/unpaid subscriptions before any tier check.
        // Self-hosted mode bypasses this so local instances are never locked out.
        if !state.config.deployment_mode.is_self_hosted() {
            if matches!(org.subscription_status.as_str(), "canceled" | "unpaid") {
                return Err((
                    StatusCode::PAYMENT_REQUIRED,
                    "Your subscription is not active. Please renew to continue using this feature."
                        .to_string(),
                ));
            }
        }

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

    #[allow(dead_code)]
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

    #[allow(dead_code)]
    pub fn has_tier(&self, required: &str) -> bool {
        self.x402_bypass || tier_includes(&self.tier, required)
    }

    /// Check if user has access to a feature
    pub fn has_feature(&self, feature: &str) -> bool {
        self.x402_bypass || can_access_feature(&self.tier, feature)
    }

    #[allow(dead_code)]
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

    #[allow(dead_code)]
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

    #[allow(dead_code)]
    pub fn tier_enum(&self) -> Tier {
        Tier::from_str(&self.tier)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_guard(tier: &str, x402: bool) -> TierGuard {
        TierGuard {
            tier: tier.to_string(),
            organization_id: "org-1".to_string(),
            x402_bypass: x402,
        }
    }

    // ── has_tier ─────────────────────────────────────────────────────────────

    #[test]
    fn has_tier_pro_satisfies_free_requirement() {
        assert!(make_guard("pro", false).has_tier("free"));
    }

    #[test]
    fn has_tier_free_does_not_satisfy_pro() {
        assert!(!make_guard("free", false).has_tier("pro"));
    }

    #[test]
    fn has_tier_x402_bypass_always_true() {
        assert!(make_guard("free", true).has_tier("enterprise"));
    }

    // ── has_feature ──────────────────────────────────────────────────────────

    #[test]
    fn has_feature_pro_includes_webhooks() {
        assert!(make_guard("pro", false).has_feature("webhooks"));
    }

    #[test]
    fn has_feature_free_excludes_webhooks() {
        assert!(!make_guard("free", false).has_feature("webhooks"));
    }

    #[test]
    fn has_feature_x402_bypass_always_true() {
        assert!(make_guard("free", true).has_feature("sso"));
    }

    // ── require_tier ─────────────────────────────────────────────────────────

    #[test]
    fn require_tier_passes_when_sufficient() {
        assert!(make_guard("team", false).require_tier("pro").is_ok());
    }

    #[test]
    fn require_tier_fails_when_insufficient() {
        let result = make_guard("free", false).require_tier("pro");
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, axum::http::StatusCode::PAYMENT_REQUIRED);
        assert!(msg.contains("pro"));
    }

    #[test]
    fn require_tier_x402_bypass_always_ok() {
        assert!(make_guard("free", true).require_tier("enterprise").is_ok());
    }

    // ── require_feature ──────────────────────────────────────────────────────

    #[test]
    fn require_feature_passes_for_available_feature() {
        assert!(make_guard("team", false)
            .require_feature("session_replay")
            .is_ok());
    }

    #[test]
    fn require_feature_fails_for_unavailable_feature() {
        let result = make_guard("free", false).require_feature("session_replay");
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, axum::http::StatusCode::PAYMENT_REQUIRED);
        assert!(msg.contains("session_replay"));
    }

    #[test]
    fn require_feature_x402_bypass_always_ok() {
        assert!(make_guard("free", true).require_feature("sso").is_ok());
    }

    // ── tier_enum ────────────────────────────────────────────────────────────

    #[test]
    fn tier_enum_parses_correctly() {
        use crate::billing::tiers::Tier;
        assert_eq!(make_guard("pro", false).tier_enum(), Tier::Pro);
        assert_eq!(make_guard("team", false).tier_enum(), Tier::Team);
        assert_eq!(
            make_guard("enterprise", false).tier_enum(),
            Tier::Enterprise
        );
        assert_eq!(make_guard("free", false).tier_enum(), Tier::Free);
        assert_eq!(make_guard("unknown", false).tier_enum(), Tier::Free);
    }
}
