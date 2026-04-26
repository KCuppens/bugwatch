use serde::{Deserialize, Serialize};

#[allow(dead_code)]
pub const USDC_BASE_ADDRESS: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct X402Challenge {
    pub version: String,
    pub scheme: String,
    pub network: String,
    #[serde(rename = "maxAmountRequired")]
    pub max_amount_required: String,
    pub asset: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    pub resource: String,
    pub description: String,
    #[serde(rename = "maxTimeoutSeconds")]
    pub max_timeout_seconds: u64,
    pub extra: X402Extra,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct X402Extra {
    pub nonce: String,
    pub payment_type: String, // "feature_access" | "capacity_grant"
    pub feature: Option<String>,
    pub grant: Option<CapacityGrantDetail>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CapacityGrantDetail {
    pub grant_type: String, // "project" | "monitor" | "storage_bytes" | "retention_days"
    pub quantity: i64,
}

pub struct PaymentPricing;

impl PaymentPricing {
    /// Returns price in micro-USDC (1_000_000 = $1.00)
    pub fn for_feature(feature: &str) -> u64 {
        match feature {
            "server_monitoring" | "performance_monitoring" => 10_000,
            "email_notifications" | "webhooks" | "pagerduty" => 25_000,
            "session_replay" => 25_000,
            "opsgenie" | "github" | "jira" | "linear" => 50_000,
            "cross_project_issues" => 10_000,
            "rate_limit_burst" => 2_000,
            _ => 25_000,
        }
    }

    pub fn for_capacity_grant(grant_type: &str, current_tier: &str, quantity: i64) -> u64 {
        match grant_type {
            "project" => 2_000_000,
            "monitor" => match current_tier {
                "free" => 1_000_000,
                _ => 500_000,
            },
            "storage_bytes" => {
                let mb = ((quantity as f64) / 1_048_576.0).ceil() as u64;
                mb * 10_000
            }
            "retention_days" => match quantity {
                d if d <= 30 => 500_000,
                _ => 1_000_000,
            },
            _ => 25_000,
        }
    }
}

pub fn build_feature_challenge(
    wallet_address: &str,
    usdc_address: &str,
    resource: &str,
    feature: &str,
    nonce: &str,
) -> X402Challenge {
    let amount = PaymentPricing::for_feature(feature);
    X402Challenge {
        version: "1".to_string(),
        scheme: "exact".to_string(),
        network: "base-mainnet".to_string(),
        max_amount_required: amount.to_string(),
        asset: usdc_address.to_string(),
        pay_to: wallet_address.to_string(),
        resource: resource.to_string(),
        description: format!(
            "Pay ${:.4} USDC to access {}",
            amount as f64 / 1_000_000.0,
            feature
        ),
        max_timeout_seconds: 300,
        extra: X402Extra {
            nonce: nonce.to_string(),
            payment_type: "feature_access".to_string(),
            feature: Some(feature.to_string()),
            grant: None,
        },
    }
}

pub fn build_capacity_challenge(
    wallet_address: &str,
    usdc_address: &str,
    resource: &str,
    grant_type: &str,
    quantity: i64,
    current_tier: &str,
    nonce: &str,
) -> X402Challenge {
    let amount = PaymentPricing::for_capacity_grant(grant_type, current_tier, quantity);
    let description = match grant_type {
        "project" => format!(
            "Pay ${:.2} USDC to permanently add 1 extra project slot",
            amount as f64 / 1_000_000.0
        ),
        "monitor" => format!(
            "Pay ${:.2} USDC to permanently add 1 extra monitor slot",
            amount as f64 / 1_000_000.0
        ),
        "storage_bytes" => {
            let mb = ((quantity as f64) / 1_048_576.0).ceil() as i64;
            format!(
                "Pay ${:.2} USDC to permanently add {}MB of replay storage",
                amount as f64 / 1_000_000.0,
                mb
            )
        }
        "retention_days" => format!(
            "Pay ${:.2} USDC to extend data retention by {} days",
            amount as f64 / 1_000_000.0,
            quantity
        ),
        _ => format!(
            "Pay ${:.2} USDC for capacity grant",
            amount as f64 / 1_000_000.0
        ),
    };
    X402Challenge {
        version: "1".to_string(),
        scheme: "exact".to_string(),
        network: "base-mainnet".to_string(),
        max_amount_required: amount.to_string(),
        asset: usdc_address.to_string(),
        pay_to: wallet_address.to_string(),
        resource: resource.to_string(),
        description,
        max_timeout_seconds: 300,
        extra: X402Extra {
            nonce: nonce.to_string(),
            payment_type: "capacity_grant".to_string(),
            feature: None,
            grant: Some(CapacityGrantDetail {
                grant_type: grant_type.to_string(),
                quantity,
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PaymentPricing::for_feature ──────────────────────────────────────────

    #[test]
    fn server_monitoring_costs_10k() {
        assert_eq!(PaymentPricing::for_feature("server_monitoring"), 10_000);
        assert_eq!(
            PaymentPricing::for_feature("performance_monitoring"),
            10_000
        );
        assert_eq!(PaymentPricing::for_feature("cross_project_issues"), 10_000);
    }

    #[test]
    fn email_webhooks_pagerduty_cost_25k() {
        assert_eq!(PaymentPricing::for_feature("email_notifications"), 25_000);
        assert_eq!(PaymentPricing::for_feature("webhooks"), 25_000);
        assert_eq!(PaymentPricing::for_feature("pagerduty"), 25_000);
        assert_eq!(PaymentPricing::for_feature("session_replay"), 25_000);
    }

    #[test]
    fn integrations_cost_50k() {
        assert_eq!(PaymentPricing::for_feature("opsgenie"), 50_000);
        assert_eq!(PaymentPricing::for_feature("github"), 50_000);
        assert_eq!(PaymentPricing::for_feature("jira"), 50_000);
        assert_eq!(PaymentPricing::for_feature("linear"), 50_000);
    }

    #[test]
    fn rate_limit_burst_costs_2k() {
        assert_eq!(PaymentPricing::for_feature("rate_limit_burst"), 2_000);
    }

    #[test]
    fn unknown_feature_defaults_to_25k() {
        assert_eq!(PaymentPricing::for_feature("nonexistent_feature"), 25_000);
        assert_eq!(PaymentPricing::for_feature(""), 25_000);
    }

    // ── PaymentPricing::for_capacity_grant ───────────────────────────────────

    #[test]
    fn project_grant_costs_2m() {
        assert_eq!(
            PaymentPricing::for_capacity_grant("project", "free", 1),
            2_000_000
        );
        assert_eq!(
            PaymentPricing::for_capacity_grant("project", "pro", 1),
            2_000_000
        );
    }

    #[test]
    fn monitor_grant_free_costs_1m() {
        assert_eq!(
            PaymentPricing::for_capacity_grant("monitor", "free", 1),
            1_000_000
        );
    }

    #[test]
    fn monitor_grant_pro_costs_500k() {
        assert_eq!(
            PaymentPricing::for_capacity_grant("monitor", "pro", 1),
            500_000
        );
        assert_eq!(
            PaymentPricing::for_capacity_grant("monitor", "team", 1),
            500_000
        );
    }

    #[test]
    fn storage_bytes_charged_per_mb() {
        // 1 MiB = 1_048_576 bytes → ceil = 1 MB → 10_000 per MB
        let price = PaymentPricing::for_capacity_grant("storage_bytes", "pro", 1_048_576);
        assert_eq!(price, 10_000);
        // 2 MiB → 20_000
        let price2 = PaymentPricing::for_capacity_grant("storage_bytes", "pro", 2_097_152);
        assert_eq!(price2, 20_000);
    }

    #[test]
    fn retention_days_lte_30_costs_500k() {
        assert_eq!(
            PaymentPricing::for_capacity_grant("retention_days", "pro", 30),
            500_000
        );
        assert_eq!(
            PaymentPricing::for_capacity_grant("retention_days", "pro", 1),
            500_000
        );
    }

    #[test]
    fn retention_days_gt_30_costs_1m() {
        assert_eq!(
            PaymentPricing::for_capacity_grant("retention_days", "pro", 31),
            1_000_000
        );
        assert_eq!(
            PaymentPricing::for_capacity_grant("retention_days", "pro", 365),
            1_000_000
        );
    }

    #[test]
    fn unknown_capacity_grant_defaults_25k() {
        assert_eq!(
            PaymentPricing::for_capacity_grant("seats", "pro", 1),
            25_000
        );
    }

    // ── build_feature_challenge ──────────────────────────────────────────────

    #[test]
    fn feature_challenge_has_correct_fields() {
        let c = build_feature_challenge(
            "0x1234567890123456789012345678901234567890",
            USDC_BASE_ADDRESS,
            "/api/v1/events",
            "server_monitoring",
            "nonce-abc",
        );
        assert_eq!(c.version, "1");
        assert_eq!(c.scheme, "exact");
        assert_eq!(c.network, "base-mainnet");
        assert_eq!(c.max_amount_required, "10000");
        assert_eq!(c.asset, USDC_BASE_ADDRESS);
        assert_eq!(c.resource, "/api/v1/events");
        assert_eq!(c.max_timeout_seconds, 300);
        assert_eq!(c.extra.nonce, "nonce-abc");
        assert_eq!(c.extra.payment_type, "feature_access");
        assert_eq!(c.extra.feature.as_deref(), Some("server_monitoring"));
        assert!(c.extra.grant.is_none());
    }

    #[test]
    fn feature_challenge_description_contains_feature_name() {
        let c = build_feature_challenge("0xaddr", "0xusdc", "/res", "webhooks", "n");
        assert!(
            c.description.contains("webhooks"),
            "description should name the feature"
        );
    }

    // ── build_capacity_challenge ─────────────────────────────────────────────

    #[test]
    fn capacity_challenge_project_has_correct_fields() {
        let c = build_capacity_challenge(
            "0xwallet",
            "0xusdc",
            "/api/v1/projects",
            "project",
            1,
            "free",
            "nonce-xyz",
        );
        assert_eq!(c.extra.payment_type, "capacity_grant");
        assert!(c.extra.feature.is_none());
        let grant = c.extra.grant.as_ref().unwrap();
        assert_eq!(grant.grant_type, "project");
        assert_eq!(grant.quantity, 1);
        assert_eq!(c.max_amount_required, "2000000");
    }

    #[test]
    fn capacity_challenge_storage_description_mentions_mb() {
        let c =
            build_capacity_challenge("0xw", "0xu", "/r", "storage_bytes", 1_048_576, "pro", "n");
        assert!(
            c.description.to_lowercase().contains("mb") || c.description.contains("MB"),
            "description should mention MB: {}",
            c.description
        );
    }

    #[test]
    fn capacity_challenge_retention_description_mentions_days() {
        let c = build_capacity_challenge("0xw", "0xu", "/r", "retention_days", 30, "pro", "n");
        assert!(
            c.description.contains("day") || c.description.contains("days"),
            "description should mention days: {}",
            c.description
        );
    }
}
