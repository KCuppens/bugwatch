use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::env;

/// Deployment mode determines whether the server runs as a self-hosted instance
/// (all features unlocked, no billing) or as the SaaS platform (with Stripe billing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeploymentMode {
    SelfHosted,
    Saas,
}

impl DeploymentMode {
    pub fn from_env() -> Self {
        match env::var("BUGWATCH_MODE").as_deref() {
            Ok("saas") => DeploymentMode::Saas,
            _ => DeploymentMode::SelfHosted,
        }
    }

    pub fn is_self_hosted(&self) -> bool {
        matches!(self, DeploymentMode::SelfHosted)
    }

    pub fn is_saas(&self) -> bool {
        matches!(self, DeploymentMode::Saas)
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    /// Server address to bind to
    pub server_addr: String,

    /// Database URL (SQLite path or PostgreSQL connection string)
    pub database_url: String,

    /// JWT secret for signing tokens
    pub jwt_secret: String,

    /// JWT access token expiration in seconds (default: 15 minutes)
    pub jwt_access_expiration: i64,

    /// JWT refresh token expiration in seconds (default: 7 days)
    pub jwt_refresh_expiration: i64,

    /// Deployment mode (self-hosted or saas)
    pub deployment_mode: DeploymentMode,

    /// Environment (development, staging, production)
    pub environment: String,

    /// Application URL (for links in notifications)
    pub app_url: String,

    /// Allowed origins for CORS (comma-separated). Required in production.
    pub allowed_origins: Vec<String>,

    // =========================================================================
    // Self-Hosted Configuration
    // =========================================================================
    /// Data retention period in days (default: 90, -1 = unlimited)
    pub retention_days: i32,

    /// Rate limit per minute (default: 10000 for self-hosted)
    pub rate_limit_per_minute: u32,

    // =========================================================================
    // SMTP Configuration (self-hosted email)
    // =========================================================================
    /// SMTP host for sending emails
    pub smtp_host: Option<String>,

    /// SMTP port (default: 587)
    pub smtp_port: Option<u16>,

    /// SMTP username
    pub smtp_user: Option<String>,

    /// SMTP password
    pub smtp_password: Option<String>,

    /// SMTP from address
    pub smtp_from: Option<String>,

    // =========================================================================
    // Stripe Configuration (SaaS only)
    // =========================================================================
    /// Stripe secret key for API calls
    pub stripe_secret_key: Option<String>,

    /// Stripe webhook signing secret for verifying webhook payloads
    pub stripe_webhook_secret: Option<String>,

    /// Stripe price ID for Pro monthly subscription
    pub stripe_price_id_pro_monthly: Option<String>,

    /// Stripe price ID for Pro annual subscription
    pub stripe_price_id_pro_annual: Option<String>,

    /// Stripe price ID for Team monthly subscription
    pub stripe_price_id_team_monthly: Option<String>,

    /// Stripe price ID for Team annual subscription
    pub stripe_price_id_team_annual: Option<String>,

    // =========================================================================
    // BugWatch Self-Monitoring Configuration
    // =========================================================================
    /// BugWatch API key for self-monitoring
    pub bugwatch_api_key: Option<String>,

    /// BugWatch endpoint (defaults to https://api.bugwatch.dev)
    pub bugwatch_endpoint: Option<String>,

    /// Enable BugWatch self-monitoring
    pub bugwatch_enabled: bool,

    // =========================================================================
    // Integration OAuth Configuration (optional)
    // =========================================================================
    /// GitHub OAuth client ID
    pub github_client_id: Option<String>,

    /// GitHub OAuth client secret
    pub github_client_secret: Option<String>,

    /// Jira OAuth client ID
    pub jira_client_id: Option<String>,

    /// Jira OAuth client secret
    pub jira_client_secret: Option<String>,

    /// Linear OAuth client ID
    pub linear_client_id: Option<String>,

    /// Linear OAuth client secret
    pub linear_client_secret: Option<String>,

    // =========================================================================
    // Security Configuration
    // =========================================================================
    /// Encryption key for field-level encryption of integration tokens
    pub encryption_key: Option<String>,

    /// GitHub webhook secret for verifying webhook signatures
    pub github_webhook_secret: Option<String>,

    /// Jira webhook secret for verifying webhook signatures
    pub jira_webhook_secret: Option<String>,

    /// Linear webhook secret for verifying webhook signatures
    pub linear_webhook_secret: Option<String>,

    // =========================================================================
    // Database Pool Configuration
    // =========================================================================
    /// Maximum database connections (default: 50)
    pub database_max_connections: u32,

    // =========================================================================
    // x402 Micropayment Configuration (SaaS only)
    // =========================================================================
    /// Enable x402 micropayment support for agent API keys
    pub x402_enabled: bool,

    /// Wallet address to receive x402 USDC payments
    pub x402_wallet_address: String,

    /// RPC URL for Base (used to verify on-chain payments)
    pub x402_rpc_url: String,

    /// USDC contract address on Base
    pub x402_usdc_address: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let deployment_mode = DeploymentMode::from_env();

        Ok(Self {
            server_addr: env::var("SERVER_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string()),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:./data/bugwatch.db?mode=rwc".to_string()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "development-secret-change-in-production".to_string()),
            jwt_access_expiration: env::var("JWT_ACCESS_EXPIRATION")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(900), // 15 minutes
            jwt_refresh_expiration: env::var("JWT_REFRESH_EXPIRATION")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(604800), // 7 days
            deployment_mode,
            environment: env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string()),
            app_url: env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3001".to_string()),
            allowed_origins: env::var("ALLOWED_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            // Self-hosted config
            retention_days: env::var("BUGWATCH_RETENTION_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(90),
            rate_limit_per_minute: env::var("BUGWATCH_RATE_LIMIT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10000),
            // SMTP config
            smtp_host: env::var("SMTP_HOST").ok(),
            smtp_port: env::var("SMTP_PORT").ok().and_then(|v| v.parse().ok()),
            smtp_user: env::var("SMTP_USER").ok(),
            smtp_password: env::var("SMTP_PASSWORD").ok(),
            smtp_from: env::var("SMTP_FROM").ok(),
            // Stripe config
            stripe_secret_key: env::var("STRIPE_SECRET_KEY").ok(),
            stripe_webhook_secret: env::var("STRIPE_WEBHOOK_SECRET").ok(),
            stripe_price_id_pro_monthly: env::var("STRIPE_PRICE_ID_PRO_MONTHLY").ok(),
            stripe_price_id_pro_annual: env::var("STRIPE_PRICE_ID_PRO_ANNUAL").ok(),
            stripe_price_id_team_monthly: env::var("STRIPE_PRICE_ID_TEAM_MONTHLY").ok(),
            stripe_price_id_team_annual: env::var("STRIPE_PRICE_ID_TEAM_ANNUAL").ok(),
            // BugWatch self-monitoring config
            bugwatch_api_key: env::var("BUGWATCH_API_KEY").ok(),
            bugwatch_endpoint: env::var("BUGWATCH_ENDPOINT").ok(),
            bugwatch_enabled: env::var("BUGWATCH_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            // Integration OAuth config
            github_client_id: env::var("GITHUB_CLIENT_ID").ok(),
            github_client_secret: env::var("GITHUB_CLIENT_SECRET").ok(),
            jira_client_id: env::var("JIRA_CLIENT_ID").ok(),
            jira_client_secret: env::var("JIRA_CLIENT_SECRET").ok(),
            linear_client_id: env::var("LINEAR_CLIENT_ID").ok(),
            linear_client_secret: env::var("LINEAR_CLIENT_SECRET").ok(),
            // Security config
            encryption_key: env::var("BUGWATCH_ENCRYPTION_KEY").ok(),
            github_webhook_secret: env::var("GITHUB_WEBHOOK_SECRET").ok(),
            jira_webhook_secret: env::var("JIRA_WEBHOOK_SECRET").ok(),
            linear_webhook_secret: env::var("LINEAR_WEBHOOK_SECRET").ok(),
            // Database pool config
            database_max_connections: env::var("DATABASE_MAX_CONNECTIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50),
            // x402 micropayment config (SaaS only)
            x402_enabled: env::var("X402_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            x402_wallet_address: env::var("X402_WALLET_ADDRESS").unwrap_or_else(|_| "".to_string()),
            x402_rpc_url: env::var("X402_RPC_URL")
                .unwrap_or_else(|_| "https://mainnet.base.org".to_string()),
            x402_usdc_address: env::var("X402_USDC_ADDRESS")
                .unwrap_or_else(|_| "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".to_string()),
        })
    }

    /// Validate configuration for the current environment.
    /// Panics in production if critical settings are missing or insecure.
    pub fn validate(&self) {
        if self.x402_enabled {
            if self.x402_wallet_address.is_empty() {
                panic!("FATAL: X402_WALLET_ADDRESS must be set when X402_ENABLED=true");
            }
            if !self.x402_wallet_address.starts_with("0x")
                || self.x402_wallet_address.len() != 42
                || !self.x402_wallet_address[2..].chars().all(|c| c.is_ascii_hexdigit())
            {
                panic!("FATAL: X402_WALLET_ADDRESS must be a valid Ethereum address (0x + 40 hex chars)");
            }
            if self.x402_rpc_url.is_empty() {
                panic!("FATAL: X402_RPC_URL must be set when X402_ENABLED=true");
            }
            if !self.x402_usdc_address.starts_with("0x")
                || self.x402_usdc_address.len() != 42
                || !self.x402_usdc_address[2..].chars().all(|c| c.is_ascii_hexdigit())
            {
                panic!("FATAL: X402_USDC_ADDRESS must be a valid Ethereum address (0x + 40 hex chars)");
            }
        }

        if self.environment == "production" {
            if self.jwt_secret == "development-secret-change-in-production" {
                panic!("FATAL: JWT_SECRET must be set in production (min 32 characters)");
            }
            if self.jwt_secret.len() < 32 {
                panic!(
                    "FATAL: JWT_SECRET must be at least 32 characters in production (got {})",
                    self.jwt_secret.len()
                );
            }
            if self.database_url.starts_with("sqlite:") {
                panic!("FATAL: SQLite is not supported in production. Set DATABASE_URL to a PostgreSQL connection string");
            }
            if self.allowed_origins.is_empty() {
                panic!("FATAL: ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins)");
            }
        }
    }

    /// Check if running in self-hosted mode
    pub fn is_self_hosted(&self) -> bool {
        self.deployment_mode.is_self_hosted()
    }

    /// Check if SMTP is configured for self-hosted email
    pub fn is_smtp_configured(&self) -> bool {
        self.smtp_host.is_some()
    }

    /// Check if Stripe is configured
    pub fn is_stripe_configured(&self) -> bool {
        self.stripe_secret_key.is_some()
    }

    pub fn is_production(&self) -> bool {
        self.environment == "production"
    }

    /// Check if BugWatch self-monitoring is enabled and configured
    pub fn is_bugwatch_enabled(&self) -> bool {
        self.bugwatch_enabled && self.bugwatch_api_key.is_some()
    }
}
