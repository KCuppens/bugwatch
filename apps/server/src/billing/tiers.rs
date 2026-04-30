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

#[allow(dead_code)]
impl Tier {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "pro" => Tier::Pro,
            "team" => Tier::Team,
            "enterprise" => Tier::Enterprise,
            _ => Tier::Free,
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
    pub server_monitoring: bool,
    pub log_monitoring: bool,
    pub email_notifications: bool,
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
    pub project_limit: Option<i32>, // None = unlimited
    pub monitor_limit: i32,         // Flat limit per org (-1 = unlimited)
    pub rate_limit_per_minute: u32,
    pub max_seats: Option<i32>,      // None = unlimited
    pub email_cooldown_minutes: i32, // Minutes between emails per issue (0 = real-time)
    pub replay_storage_bytes: i64,   // Max replay storage per project in bytes (0 = disabled)
    pub features: TierFeatures,
}

/// Get limits for a tier
pub fn get_tier_limits(tier: Tier) -> TierLimits {
    match tier {
        Tier::Free => TierLimits {
            tier: Tier::Free,
            retention_days: 7,
            project_limit: Some(1),
            monitor_limit: 1,
            rate_limit_per_minute: 100,
            max_seats: Some(1),
            email_cooldown_minutes: 60, // 1 email per hour
            replay_storage_bytes: 0,    // No replay for free tier
            features: TierFeatures {
                webhooks: false,
                pagerduty: false,
                opsgenie: false,
                session_replay: false,
                performance_monitoring: false,
                server_monitoring: false,
                log_monitoring: false,
                email_notifications: false,
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
            monitor_limit: 10,
            rate_limit_per_minute: 1000,
            max_seats: None,
            email_cooldown_minutes: 15,          // 1 email per 15 min
            replay_storage_bytes: 1_073_741_824, // 1GB
            features: TierFeatures {
                webhooks: true,
                pagerduty: true,
                opsgenie: false,
                session_replay: false,
                performance_monitoring: true,
                server_monitoring: true,
                log_monitoring: true,
                email_notifications: true,
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
            monitor_limit: 25,
            rate_limit_per_minute: 5000,
            max_seats: None,
            email_cooldown_minutes: 5,            // 1 email per 5 min
            replay_storage_bytes: 10_737_418_240, // 10GB
            features: TierFeatures {
                webhooks: true,
                pagerduty: true,
                opsgenie: true,
                session_replay: true,
                performance_monitoring: true,
                server_monitoring: true,
                log_monitoring: true,
                email_notifications: true,
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
            monitor_limit: -1, // unlimited
            rate_limit_per_minute: 10000,
            max_seats: None,
            email_cooldown_minutes: 0,             // real-time
            replay_storage_bytes: 107_374_182_400, // 100GB
            features: TierFeatures {
                webhooks: true,
                pagerduty: true,
                opsgenie: true,
                session_replay: true,
                performance_monitoring: true,
                server_monitoring: true,
                log_monitoring: true,
                email_notifications: true,
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
        "server_monitoring" => limits.features.server_monitoring,
        "log_monitoring" => limits.features.log_monitoring,
        "email_notifications" => limits.features.email_notifications,
        "jira" => limits.features.jira,
        "linear" => limits.features.linear,
        // Cross-project issue aggregation — requires Pro+ (same gate as server_monitoring)
        "cross_project_issues" => limits.features.server_monitoring,
        "github_issues" | "github" => limits.features.github_issues,
        "sso" => limits.features.sso,
        "audit_logs" => limits.features.audit_logs,
        "custom_domain" => limits.features.custom_domain,
        // API access (agent keys, MCP, OpenAPI) — requires Pro+ (same gate as server_monitoring)
        "api_access" => limits.features.server_monitoring,
        // Advanced alerting (multi-condition rules, escalation chains) — requires Team+ (same gate as opsgenie)
        "advanced_alerting" => limits.features.opsgenie,
        _ => false,
    }
}

#[allow(dead_code)]
pub fn tier_includes(tier_a: &str, tier_b: &str) -> bool {
    let a = Tier::from_str(tier_a);
    let b = Tier::from_str(tier_b);
    a.level() >= b.level()
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
        assert!(!can_access_feature("free", "server_monitoring"));
        assert!(!can_access_feature("free", "email_notifications"));
        assert!(can_access_feature("pro", "webhooks"));
        assert!(can_access_feature("pro", "pagerduty"));
        assert!(can_access_feature("pro", "server_monitoring"));
        assert!(can_access_feature("pro", "email_notifications"));
        assert!(!can_access_feature("pro", "session_replay"));
        assert!(can_access_feature("team", "session_replay"));
        assert!(can_access_feature("enterprise", "sso"));
    }

    #[test]
    fn test_tier_limits() {
        // Free tier limits
        let free = get_tier_limits(Tier::Free);
        assert_eq!(free.project_limit, Some(1));
        assert_eq!(free.monitor_limit, 1);
        assert_eq!(free.email_cooldown_minutes, 60);
        assert_eq!(free.max_seats, Some(1));
        assert!(!free.features.server_monitoring);
        assert!(!free.features.email_notifications);

        // Pro tier limits
        let pro = get_tier_limits(Tier::Pro);
        assert_eq!(pro.project_limit, None);
        assert_eq!(pro.monitor_limit, 10);
        assert_eq!(pro.email_cooldown_minutes, 15);
        assert!(pro.features.server_monitoring);
        assert!(pro.features.email_notifications);

        // Team tier limits
        let team = get_tier_limits(Tier::Team);
        assert_eq!(team.monitor_limit, 25);
        assert_eq!(team.email_cooldown_minutes, 5);

        // Enterprise tier limits
        let enterprise = get_tier_limits(Tier::Enterprise);
        assert_eq!(enterprise.monitor_limit, -1); // Unlimited
        assert_eq!(enterprise.email_cooldown_minutes, 0);
    }

    #[test]
    fn tier_level_ordering() {
        assert!(Tier::Free.level() < Tier::Pro.level());
        assert!(Tier::Pro.level() < Tier::Team.level());
        assert!(Tier::Team.level() < Tier::Enterprise.level());
    }

    #[test]
    fn can_access_feature_advanced_alerting_requires_team() {
        assert!(!can_access_feature("free", "advanced_alerting"));
        assert!(!can_access_feature("pro", "advanced_alerting"));
        assert!(can_access_feature("team", "advanced_alerting"));
    }

    #[test]
    fn can_access_feature_api_access_requires_pro() {
        assert!(!can_access_feature("free", "api_access"));
        assert!(can_access_feature("pro", "api_access"));
    }

    #[test]
    fn can_access_feature_unknown_returns_false() {
        assert!(!can_access_feature("enterprise", "nonexistent_feature"));
    }
}
