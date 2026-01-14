use serde::{Deserialize, Serialize};

/// Supported pricing tiers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Free,
    Pro,
    Team,
    Enterprise,
}

impl Tier {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "pro" => Tier::Pro,
            "team" => Tier::Team,
            "enterprise" => Tier::Enterprise,
            _ => Tier::Free,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Tier::Free => "free",
            Tier::Pro => "pro",
            Tier::Team => "team",
            Tier::Enterprise => "enterprise",
        }
    }

    /// Tier hierarchy level for comparisons
    pub fn level(&self) -> u8 {
        match self {
            Tier::Free => 0,
            Tier::Pro => 1,
            Tier::Team => 2,
            Tier::Enterprise => 3,
        }
    }
}

/// Features available per tier
#[derive(Debug, Clone, Serialize)]
pub struct TierFeatures {
    pub webhooks: bool,
    pub pagerduty: bool,
    pub opsgenie: bool,
    pub session_replay: bool,
    pub performance_monitoring: bool,
    pub jira: bool,
    pub linear: bool,
    pub github_issues: bool,
    pub sso: bool,
    pub audit_logs: bool,
    pub custom_domain: bool,
}

/// Limits for each tier
#[derive(Debug, Clone, Serialize)]
pub struct TierLimits {
    pub tier: Tier,
    pub retention_days: i32,
    pub project_limit: Option<i32>,      // None = unlimited
    pub monitors_per_seat: i32,
    pub ai_fixes_per_seat: i32,
    pub session_replays_per_seat: i32,
    pub rate_limit_per_minute: u32,
    pub max_seats: Option<i32>,          // None = unlimited
    pub email_cooldown_minutes: i32,     // Minutes between emails per issue (0 = real-time)
    pub features: TierFeatures,
}

/// Get limits for a tier
pub fn get_tier_limits(tier: Tier) -> TierLimits {
    match tier {
        Tier::Free => TierLimits {
            tier: Tier::Free,
            retention_days: 7,
            project_limit: Some(1),
            monitors_per_seat: 3,
            ai_fixes_per_seat: 0,
            session_replays_per_seat: 0,
            rate_limit_per_minute: 100,
            max_seats: Some(1),
            email_cooldown_minutes: 60,  // 1 email per hour
            features: TierFeatures {
                webhooks: false,
                pagerduty: false,
                opsgenie: false,
                session_replay: false,
                performance_monitoring: false,
                jira: false,
                linear: false,
                github_issues: false,
                sso: false,
                audit_logs: false,
                custom_domain: false,
            },
        },
        Tier::Pro => TierLimits {
            tier: Tier::Pro,
            retention_days: 90,
            project_limit: None,
            monitors_per_seat: 10,
            ai_fixes_per_seat: 5,
            session_replays_per_seat: 0,
            rate_limit_per_minute: 1000,
            max_seats: None,
            email_cooldown_minutes: 15,  // 1 email per 15 min
            features: TierFeatures {
                webhooks: true,
                pagerduty: true,
                opsgenie: false,
                session_replay: false,
                performance_monitoring: false,
                jira: false,
                linear: false,
                github_issues: false,
                sso: false,
                audit_logs: false,
                custom_domain: false,
            },
        },
        Tier::Team => TierLimits {
            tier: Tier::Team,
            retention_days: 365,
            project_limit: None,
            monitors_per_seat: 20,
            ai_fixes_per_seat: 15,
            session_replays_per_seat: 100,
            rate_limit_per_minute: 5000,
            max_seats: None,
            email_cooldown_minutes: 5,  // 1 email per 5 min
            features: TierFeatures {
                webhooks: true,
                pagerduty: true,
                opsgenie: true,
                session_replay: true,
                performance_monitoring: true,
                jira: true,
                linear: true,
                github_issues: true,
                sso: false,
                audit_logs: false,
                custom_domain: false,
            },
        },
        Tier::Enterprise => TierLimits {
            tier: Tier::Enterprise,
            retention_days: -1, // unlimited / custom
            project_limit: None,
            monitors_per_seat: -1, // unlimited
            ai_fixes_per_seat: -1, // unlimited
            session_replays_per_seat: -1, // unlimited
            rate_limit_per_minute: 10000,
            max_seats: None,
            email_cooldown_minutes: 0,  // real-time
            features: TierFeatures {
                webhooks: true,
                pagerduty: true,
                opsgenie: true,
                session_replay: true,
                performance_monitoring: true,
                jira: true,
                linear: true,
                github_issues: true,
                sso: true,
                audit_logs: true,
                custom_domain: true,
            },
        },
    }
}

/// Check if a tier can access a specific feature
pub fn can_access_feature(tier: &str, feature: &str) -> bool {
    let tier = Tier::from_str(tier);
    let limits = get_tier_limits(tier);

    match feature {
        "webhooks" => limits.features.webhooks,
        "pagerduty" => limits.features.pagerduty,
        "opsgenie" => limits.features.opsgenie,
        "session_replay" => limits.features.session_replay,
        "performance_monitoring" => limits.features.performance_monitoring,
        "jira" => limits.features.jira,
        "linear" => limits.features.linear,
        "github_issues" => limits.features.github_issues,
        "sso" => limits.features.sso,
        "audit_logs" => limits.features.audit_logs,
        "custom_domain" => limits.features.custom_domain,
        _ => false,
    }
}

/// Check if tier A includes all features of tier B (A >= B)
pub fn tier_includes(tier_a: &str, tier_b: &str) -> bool {
    let a = Tier::from_str(tier_a);
    let b = Tier::from_str(tier_b);
    a.level() >= b.level()
}

/// Get price per seat in cents (monthly)
pub fn get_price_per_seat(tier: Tier) -> i32 {
    match tier {
        Tier::Free => 0,
        Tier::Pro => 1200,      // $12.00
        Tier::Team => 2500,     // $25.00
        Tier::Enterprise => 0,  // custom pricing
    }
}

/// Get minimum seats required for a tier
pub fn get_min_seats(tier: Tier) -> i32 {
    match tier {
        Tier::Free => 1,
        Tier::Pro => 2,
        Tier::Team => 5,
        Tier::Enterprise => 1,
    }
}

/// Calculate total price for a subscription
pub fn calculate_price(tier: Tier, seats: i32, annual: bool) -> i32 {
    let price_per_seat = get_price_per_seat(tier);
    let effective_seats = seats.max(get_min_seats(tier));
    let monthly_total = price_per_seat * effective_seats;

    if annual {
        // 30% discount for annual billing
        let annual_total = monthly_total * 12;
        (annual_total as f64 * 0.70) as i32
    } else {
        monthly_total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_from_str() {
        assert_eq!(Tier::from_str("free"), Tier::Free);
        assert_eq!(Tier::from_str("Free"), Tier::Free);
        assert_eq!(Tier::from_str("PRO"), Tier::Pro);
        assert_eq!(Tier::from_str("team"), Tier::Team);
        assert_eq!(Tier::from_str("enterprise"), Tier::Enterprise);
        assert_eq!(Tier::from_str("unknown"), Tier::Free);
    }

    #[test]
    fn test_tier_includes() {
        assert!(tier_includes("pro", "free"));
        assert!(tier_includes("team", "pro"));
        assert!(tier_includes("enterprise", "team"));
        assert!(!tier_includes("free", "pro"));
        assert!(!tier_includes("pro", "team"));
    }

    #[test]
    fn test_feature_access() {
        assert!(!can_access_feature("free", "webhooks"));
        assert!(can_access_feature("pro", "webhooks"));
        assert!(can_access_feature("pro", "pagerduty"));
        assert!(!can_access_feature("pro", "session_replay"));
        assert!(can_access_feature("team", "session_replay"));
        assert!(can_access_feature("enterprise", "sso"));
    }

    #[test]
    fn test_pricing() {
        // Free tier
        assert_eq!(calculate_price(Tier::Free, 1, false), 0);

        // Pro tier monthly - 5 seats
        assert_eq!(calculate_price(Tier::Pro, 5, false), 6000); // $60

        // Pro tier annual - 5 seats (30% off)
        assert_eq!(calculate_price(Tier::Pro, 5, true), 50400); // $504/year = $42/mo

        // Team tier monthly - 10 seats
        assert_eq!(calculate_price(Tier::Team, 10, false), 25000); // $250

        // Minimum seats enforced
        assert_eq!(calculate_price(Tier::Pro, 1, false), 2400); // 2 seats min = $24
    }

    #[test]
    fn test_tier_limits() {
        // Free tier limits
        let free = get_tier_limits(Tier::Free);
        assert_eq!(free.project_limit, Some(1)); // Free tier has 1 project
        assert_eq!(free.email_cooldown_minutes, 60); // 1 hour cooldown
        assert_eq!(free.max_seats, Some(1));

        // Pro tier limits
        let pro = get_tier_limits(Tier::Pro);
        assert_eq!(pro.project_limit, None); // Unlimited projects
        assert_eq!(pro.email_cooldown_minutes, 15); // 15 min cooldown

        // Team tier limits
        let team = get_tier_limits(Tier::Team);
        assert_eq!(team.email_cooldown_minutes, 5); // 5 min cooldown

        // Enterprise tier limits
        let enterprise = get_tier_limits(Tier::Enterprise);
        assert_eq!(enterprise.email_cooldown_minutes, 0); // Real-time (no cooldown)
    }
}
