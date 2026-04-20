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
    pub api_key_hash: String,
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
    pub environment: String,
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
    pub created_at: DateTime<Utc>,
    pub last_checked_at: Option<DateTime<Utc>>,
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
    pub checked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MonitorIncident {
    pub id: String,
    pub monitor_id: String,
    pub started_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub cause: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub condition: String, // JSON: { "type": "new_issue" | "issue_frequency" | "monitor_down", ... }
    pub actions: String,   // JSON: array of channel IDs
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub muted_until: Option<DateTime<Utc>>,
    pub snooze_duration_minutes: Option<i32>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct NotificationChannel {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub channel_type: String, // 'email', 'webhook', 'slack'
    pub config: String,       // JSON config
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
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
    pub created_at: DateTime<Utc>,
    pub sent_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct IssueComment {
    pub id: String,
    pub issue_id: String,
    pub user_id: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Alert condition variants stored as JSON in `alert_rules.condition`.
/// Single canonical definition shared by the API layer and alerting service.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AlertCondition {
    #[serde(rename = "new_issue")]
    NewIssue {
        #[serde(default)]
        level: Option<String>,
    },
    #[serde(rename = "issue_frequency")]
    IssueFrequency { threshold: u32, window_minutes: u32 },
    #[serde(rename = "monitor_down")]
    MonitorDown {
        #[serde(default)]
        monitor_id: Option<String>,
    },
    #[serde(rename = "monitor_recovery")]
    MonitorRecovery {
        #[serde(default)]
        monitor_id: Option<String>,
    },
    #[serde(rename = "server_cpu_high")]
    ServerCpuHigh {
        threshold_percent: f64,
        #[serde(default)]
        server_id: Option<String>,
    },
    #[serde(rename = "server_memory_high")]
    ServerMemoryHigh {
        threshold_percent: f64,
        #[serde(default)]
        server_id: Option<String>,
    },
    #[serde(rename = "server_disk_high")]
    ServerDiskHigh {
        threshold_percent: f64,
        #[serde(default)]
        mount: Option<String>,
        #[serde(default)]
        server_id: Option<String>,
    },
    #[serde(rename = "server_offline")]
    ServerOffline {
        #[serde(default = "default_missing_minutes")]
        missing_minutes: u32,
        #[serde(default)]
        server_id: Option<String>,
    },
}

fn default_missing_minutes() -> u32 {
    5
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
    pub current_period_start: Option<DateTime<Utc>>,
    pub current_period_end: Option<DateTime<Utc>>,
    pub cancel_at_period_end: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Payment failure tracking
    pub payment_failed_at: Option<DateTime<Utc>>,
    pub grace_period_ends: Option<DateTime<Utc>>,
    // Tax handling
    pub tax_id: Option<String>,
    pub tax_exempt: Option<bool>,
    pub billing_country: Option<String>,
    pub billing_address: Option<String>,
    // x402 micropayment grant columns
    pub x402_extra_projects: i32,
    pub x402_extra_monitors: i32,
    pub x402_extra_storage_bytes: i64,
    pub x402_extra_retention_days: i32,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct OrganizationMember {
    pub id: String,
    pub organization_id: String,
    pub user_id: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UsageRecord {
    pub id: String,
    pub organization_id: String,
    pub metric: String,
    pub count: i32,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
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
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Server Monitoring
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub project_id: String,
    pub server_id: String,
    pub hostname: String,
    pub os: Option<String>,
    pub kernel: Option<String>,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub is_active: bool,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ServerMetric {
    pub id: String,
    pub server_db_id: String,
    pub cpu_usage_percent: Option<f64>,
    pub load_avg_1: Option<f64>,
    pub load_avg_5: Option<f64>,
    pub load_avg_15: Option<f64>,
    pub mem_total_bytes: Option<i64>,
    pub mem_used_bytes: Option<i64>,
    pub mem_available_bytes: Option<i64>,
    pub mem_usage_percent: Option<f64>,
    pub swap_total_bytes: Option<i64>,
    pub swap_used_bytes: Option<i64>,
    pub net_rx_bytes_per_sec: Option<i64>,
    pub net_tx_bytes_per_sec: Option<i64>,
    pub uptime_seconds: Option<i64>,
    pub disks_json: Option<String>,
    pub processes_json: Option<String>,
    pub docker_json: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

// ============================================================================
// Agent API Keys
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AgentKey {
    pub id: String,
    pub organization_id: String,
    pub name: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    pub key_prefix: String,
    pub permissions: String, // JSON: ["read", "write", "admin"]
    pub created_by: String,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AgentAuditLog {
    pub id: String,
    pub agent_key_id: String,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub metadata: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Performance Monitoring
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub project_id: String,
    pub transaction_name: String,
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub op: String,
    pub description: Option<String>,
    pub status: String,
    pub duration_ms: f64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub environment: Option<String>,
    pub release: Option<String>,
    pub tags: Option<String>,
    pub data: Option<String>,
    pub user_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Span {
    pub id: String,
    pub transaction_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub op: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub duration_ms: f64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub data: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Integrations
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Integration {
    pub id: String,
    pub organization_id: String,
    pub provider: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<DateTime<Utc>>,
    pub external_user_id: Option<String>,
    pub external_username: Option<String>,
    pub config: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct IssueLink {
    pub id: String,
    pub issue_id: String,
    pub integration_id: String,
    pub provider: String,
    pub external_issue_id: String,
    pub external_issue_key: String,
    pub external_issue_url: String,
    pub external_status: Option<String>,
    pub sync_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Session Replay
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SessionRecording {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub user_id: Option<String>,
    pub started_at: DateTime<Utc>,
    pub duration_ms: Option<i32>,
    pub is_complete: bool,
    pub segment_count: i32,
    pub total_size_bytes: i64,
    pub environment: Option<String>,
    pub release: Option<String>,
    pub user_agent: Option<String>,
    pub screen_width: Option<i32>,
    pub screen_height: Option<i32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SessionSegment {
    pub id: String,
    pub recording_id: String,
    pub segment_index: i32,
    #[serde(skip)]
    pub data: Vec<u8>,
    pub size_bytes: i32,
    pub created_at: DateTime<Utc>,
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
