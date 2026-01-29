use anyhow::Result;
use std::env;

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

    /// Environment (development, staging, production)
    pub environment: String,

    /// Anthropic API key for AI fix generation
    pub anthropic_api_key: Option<String>,

    /// AI fix cost in credits (default: 1)
    pub ai_fix_credit_cost: i32,

    /// Application URL (for links in notifications)
    pub app_url: String,

    // =========================================================================
    // Stripe Configuration
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

    /// BugWatch endpoint (defaults to https://api.bugwatch.io)
    pub bugwatch_endpoint: Option<String>,

    /// Enable BugWatch self-monitoring
    pub bugwatch_enabled: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
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
            environment: env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string()),
            anthropic_api_key: env::var("ANTHROPIC_API_KEY").ok(),
            ai_fix_credit_cost: env::var("AI_FIX_CREDIT_COST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1),
            app_url: env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3001".to_string()),
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
        })
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
