use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub email_verified: bool,
    pub failed_login_attempts: i32,
    pub locked_until: Option<DateTime<Utc>>,
    pub credits: i32,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub api_key: String,
    pub owner_id: String,
    pub tier: String,
    pub created_at: DateTime<Utc>,
    pub settings: String,
    pub platform: Option<String>,
    pub framework: Option<String>,
    pub onboarding_completed_at: Option<DateTime<Utc>>,
    pub organization_id: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Issue {
    pub id: String,
    pub project_id: String,
    pub fingerprint: String,
    pub title: String,
    pub status: String,
    pub level: String,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub count: i64,
    pub user_count: i64,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Event {
    pub id: String,
    pub issue_id: String,
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub payload: String,
    pub processed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AiFix {
    pub id: String,
    pub issue_id: String,
    pub requested_by: Option<String>,
    pub status: String,
    pub fix_diff: Option<String>,
    pub explanation: Option<String>,
    pub pr_url: Option<String>,
    pub credits_used: Option<f64>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Monitor {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub url: String,
    pub method: String,
    pub interval_seconds: i32,
    pub timeout_ms: i32,
    pub expected_status: Option<i32>,
    pub headers: String,
    pub body: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub last_checked_at: Option<String>,
    pub current_status: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MonitorCheck {
    pub id: String,
    pub monitor_id: String,
    pub status: String,
    pub response_time_ms: Option<i32>,
    pub status_code: Option<i32>,
    pub error_message: Option<String>,
    pub checked_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MonitorIncident {
    pub id: String,
    pub monitor_id: String,
    pub started_at: String,
    pub resolved_at: Option<String>,
    pub cause: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub condition: String,  // JSON: { "type": "new_issue" | "issue_frequency" | "monitor_down", ... }
    pub actions: String,    // JSON: array of channel IDs
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct NotificationChannel {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub channel_type: String,  // 'email', 'webhook', 'slack'
    pub config: String,        // JSON config
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AlertLog {
    pub id: String,
    pub alert_rule_id: String,
    pub channel_id: Option<String>,
    pub trigger_type: String,
    pub trigger_id: Option<String>,
    pub status: String,
    pub message: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub sent_at: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct IssueComment {
    pub id: String,
    pub issue_id: String,
    pub user_id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Billing & Organization Models
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub owner_id: String,
    pub tier: String,
    pub stripe_customer_id: Option<String>,
    pub stripe_subscription_id: Option<String>,
    pub subscription_status: String,
    pub seats: i32,
    pub billing_interval: Option<String>,
    pub current_period_start: Option<String>,
    pub current_period_end: Option<String>,
    pub cancel_at_period_end: bool,
    pub created_at: String,
    pub updated_at: String,
    // Payment failure tracking
    pub payment_failed_at: Option<String>,
    pub grace_period_ends: Option<String>,
    // Tax handling
    pub tax_id: Option<String>,
    pub tax_exempt: Option<bool>,
    pub billing_country: Option<String>,
    pub billing_address: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct OrganizationMember {
    pub id: String,
    pub organization_id: String,
    pub user_id: String,
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UsageRecord {
    pub id: String,
    pub organization_id: String,
    pub metric: String,
    pub count: i32,
    pub period_start: String,
    pub period_end: String,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct BillingEvent {
    pub id: String,
    pub organization_id: String,
    pub event_type: String,
    pub stripe_event_id: Option<String>,
    pub amount_cents: Option<i32>,
    pub currency: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CreditPurchase {
    pub id: String,
    pub user_id: String,
    pub credits: i32,
    pub amount_cents: i32,
    pub stripe_payment_intent_id: Option<String>,
    pub status: String,
    pub created_at: String,
}

// ============================================================================
// Email Rate Limiting
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct EmailRateLimit {
    pub id: String,
    pub project_id: String,
    pub issue_fingerprint: String,
    pub channel_id: String,
    pub last_sent_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}
