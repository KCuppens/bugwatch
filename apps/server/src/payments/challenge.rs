use serde::{Deserialize, Serialize};

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
