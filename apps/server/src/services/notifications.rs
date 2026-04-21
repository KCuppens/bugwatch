use anyhow::{anyhow, Result};
#[cfg(feature = "saas")]
use aws_sdk_sesv2::types::{Body, Content, Destination, EmailContent, Message};
#[cfg(feature = "saas")]
use aws_sdk_sesv2::Client as SesClient;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message as LettreMessage, Tokio1Executor};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use crate::db::models::NotificationChannel;
use crate::db::repositories::alerts::EmailRateLimitRepository;
use crate::db::DbPool;

/// Email transport abstraction — SMTP for self-hosted, SES for SaaS
enum EmailTransport {
    Smtp(AsyncSmtpTransport<Tokio1Executor>),
    #[cfg(feature = "saas")]
    Ses(SesClient),
}

/// Returns true for IP addresses that should never be webhook targets:
/// loopback, RFC-1918 private, and link-local ranges.
fn is_ssrf_risk(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            // IPv4-mapped IPv6 (::ffff:x.x.x.x) — check embedded IPv4 address
            if let Some(v4) = v6.to_ipv4_mapped() {
                if v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
                {
                    return true;
                }
            }
            let o = v6.octets();
            // fe80::/10 link-local
            let is_link_local = o[0] == 0xfe && (o[1] & 0xc0) == 0x80;
            // fc00::/7 unique local (fc00:: and fd00::)
            let is_unique_local = o[0] & 0xfe == 0xfc;
            is_link_local || is_unique_local
        }
    }
}

/// Notification service for sending alerts via various channels
pub struct NotificationService {
    client: Client,
    email_transport: Option<EmailTransport>,
    from_email: String,
    circuit_breaker: crate::utils::CircuitBreaker,
}

/// Alert payload sent to notification channels
#[derive(Debug, Clone, Serialize)]
pub struct AlertPayload {
    pub title: String,
    pub message: String,
    pub severity: String,
    pub project_name: String,
    pub trigger_type: String,
    pub trigger_id: Option<String>,
    pub url: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<AlertIssueDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace: Option<Vec<StackFrame>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_users: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency: Option<AlertFrequency>,
}

/// Embedded issue detail for webhook payloads
#[derive(Debug, Clone, Serialize)]
pub struct AlertIssueDetail {
    pub id: String,
    pub title: String,
    pub status: String,
    pub level: String,
    pub count: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub environment: String,
}

/// Top stack frames from latest event
#[derive(Debug, Clone, Serialize)]
pub struct StackFrame {
    pub filename: Option<String>,
    pub function: Option<String>,
    pub lineno: Option<i64>,
    pub colno: Option<i64>,
}

/// Event frequency data
#[derive(Debug, Clone, Serialize)]
pub struct AlertFrequency {
    pub last_hour: i64,
    pub last_day: i64,
}

/// Extended alert context for rate limiting
#[derive(Debug, Clone)]
pub struct AlertContext {
    pub project_id: String,
    pub issue_fingerprint: Option<String>,
    pub cooldown_minutes: i32,
}

/// Email configuration
#[derive(Debug, Deserialize)]
pub struct EmailConfig {
    pub recipients: Vec<String>,
}

/// Webhook configuration
#[derive(Debug, Deserialize)]
pub struct WebhookConfig {
    pub url: String,
    pub secret: Option<String>,
}

/// Response from a webhook endpoint (optional action commands)
#[derive(Debug, Deserialize)]
struct WebhookResponse {
    action: Option<String>,
}

/// Slack configuration
#[derive(Debug, Deserialize)]
pub struct SlackConfig {
    pub webhook_url: String,
    pub channel: Option<String>,
    /// Custom message template - if not set, uses default rich formatting
    pub message_template: Option<SlackMessageTemplate>,
}

/// PagerDuty configuration
#[derive(Debug, Deserialize)]
pub struct PagerDutyConfig {
    pub routing_key: String,
    #[serde(default)]
    pub severity_mapping: Option<std::collections::HashMap<String, String>>,
}

/// OpsGenie configuration
#[derive(Debug, Deserialize)]
pub struct OpsGenieConfig {
    pub api_key: String,
    #[serde(default)]
    pub team: Option<String>,
    #[serde(default)]
    pub priority_mapping: Option<std::collections::HashMap<String, String>>,
}

/// Template for customizing Slack message layout
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SlackMessageTemplate {
    /// Which blocks to include and their order
    pub blocks: Vec<SlackBlockConfig>,
    /// Action buttons to include
    #[serde(default)]
    pub actions: Vec<SlackActionConfig>,
}

impl Default for SlackMessageTemplate {
    fn default() -> Self {
        Self {
            blocks: vec![
                SlackBlockConfig {
                    block_type: SlackBlockType::Header,
                    enabled: true,
                },
                SlackBlockConfig {
                    block_type: SlackBlockType::Message,
                    enabled: true,
                },
                SlackBlockConfig {
                    block_type: SlackBlockType::StackTrace,
                    enabled: true,
                },
                SlackBlockConfig {
                    block_type: SlackBlockType::Context,
                    enabled: true,
                },
            ],
            actions: vec![SlackActionConfig {
                action_type: SlackActionType::ViewIssue,
                label: "View in Bugwatch".to_string(),
                style: Some("primary".to_string()),
            }],
        }
    }
}

/// Types of blocks that can be included in Slack messages
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SlackBlockType {
    Header,
    Message,
    StackTrace,
    Context,
    Stats,
}

/// Configuration for a single block in the template
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SlackBlockConfig {
    pub block_type: SlackBlockType,
    pub enabled: bool,
}

/// Types of action buttons
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SlackActionType {
    ViewIssue,
    Resolve,
    Mute,
}

/// Configuration for an action button
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SlackActionConfig {
    pub action_type: SlackActionType,
    pub label: String,
    #[serde(default)]
    pub style: Option<String>,
}

impl NotificationService {
    pub async fn new() -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        // Try SMTP first (self-hosted), then AWS SES (SaaS)
        let email_transport = match Self::init_smtp_transport() {
            Ok(t) => {
                info!("SMTP email transport initialized");
                Some(EmailTransport::Smtp(t))
            }
            Err(_) => Self::init_ses_transport().await,
        };

        if email_transport.is_none() {
            warn!("No email transport configured (set SMTP_HOST or AWS credentials). Email notifications will be logged only.");
        }

        let from_email = std::env::var("SMTP_FROM")
            .or_else(|_| std::env::var("FROM_EMAIL"))
            .unwrap_or_else(|_| "alerts@bugwatch.dev".to_string());

        Self {
            client,
            email_transport,
            from_email,
            // Open after 5 consecutive failures, try again after 60 seconds
            circuit_breaker: crate::utils::CircuitBreaker::new("notifications", 5, 60),
        }
    }

    /// Initialize SMTP transport from environment variables
    fn init_smtp_transport() -> Result<AsyncSmtpTransport<Tokio1Executor>> {
        let host = std::env::var("SMTP_HOST").map_err(|_| anyhow!("SMTP_HOST not set"))?;
        let port: u16 = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(587);

        let mut builder = if port == 465 {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&host)?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)?
        };

        builder = builder.port(port);

        // Add credentials if provided
        if let (Ok(user), Ok(pass)) = (std::env::var("SMTP_USER"), std::env::var("SMTP_PASSWORD")) {
            let creds = Credentials::new(user, pass);
            builder = builder.credentials(creds);
        }

        Ok(builder.build())
    }

    /// Initialize SES transport (SaaS only)
    async fn init_ses_transport() -> Option<EmailTransport> {
        #[cfg(feature = "saas")]
        {
            match Self::init_ses_client().await {
                Ok(client) => {
                    info!("AWS SES email transport initialized");
                    Some(EmailTransport::Ses(client))
                }
                Err(e) => {
                    warn!("AWS SES not configured: {}", e);
                    None
                }
            }
        }
        #[cfg(not(feature = "saas"))]
        {
            None
        }
    }

    #[cfg(feature = "saas")]
    async fn init_ses_client() -> Result<SesClient> {
        let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;

        // Verify we have credentials by checking for region
        if config.region().is_none() {
            return Err(anyhow!("AWS region not configured"));
        }

        Ok(SesClient::new(&config))
    }

    /// Send an alert to a notification channel (without rate limiting)
    ///
    /// Returns `Ok(Some(action))` when a webhook responds with
    /// `{"action": "resolve"}` or `{"action": "ignore"}`.
    pub async fn send(
        &self,
        channel: &NotificationChannel,
        payload: &AlertPayload,
    ) -> Result<Option<String>> {
        if !self.circuit_breaker.allow_request() {
            warn!(
                "Circuit breaker open for notifications — skipping {} alert",
                channel.channel_type
            );
            return Err(anyhow!("Notification circuit breaker is open"));
        }

        let result = match channel.channel_type.as_str() {
            "email" => {
                self.send_email(channel, payload).await?;
                Ok(None)
            }
            "webhook" => self.send_webhook(channel, payload).await,
            "slack" => {
                self.send_slack(channel, payload).await?;
                Ok(None)
            }
            "pagerduty" => {
                self.send_pagerduty(channel, payload).await?;
                Ok(None)
            }
            "opsgenie" => {
                self.send_opsgenie(channel, payload).await?;
                Ok(None)
            }
            _ => Err(anyhow!("Unknown channel type: {}", channel.channel_type)),
        };

        match &result {
            Ok(_) => self.circuit_breaker.record_success(),
            Err(_) => self.circuit_breaker.record_failure(),
        }

        result
    }

    /// Send an alert with rate limiting support (for email)
    ///
    /// Returns `Ok((true, Some(action)))` when a webhook responds with an action,
    /// `Ok((true, None))` when sent successfully, or `Ok((false, None))` when rate-limited.
    pub async fn send_with_rate_limit(
        &self,
        pool: &DbPool,
        channel: &NotificationChannel,
        payload: &AlertPayload,
        context: &AlertContext,
    ) -> Result<(bool, Option<String>)> {
        // Only apply rate limiting to email channels
        if channel.channel_type != "email" {
            let action = self.send(channel, payload).await?;
            return Ok((true, action));
        }

        // Check rate limit for email
        if let Some(fingerprint) = &context.issue_fingerprint {
            let rate_limited = EmailRateLimitRepository::check_rate_limit(
                pool,
                &context.project_id,
                fingerprint,
                &channel.id,
                context.cooldown_minutes,
            )
            .await?;

            if let Some(last_sent) = rate_limited {
                info!(
                    "Email rate limited for project={}, fingerprint={}, last_sent={}",
                    context.project_id, fingerprint, last_sent
                );
                return Ok((false, None));
            }
        }

        // Send the email
        self.send_email(channel, payload).await?;

        // Record the send for rate limiting
        if let Some(fingerprint) = &context.issue_fingerprint {
            EmailRateLimitRepository::record_sent(
                pool,
                &context.project_id,
                fingerprint,
                &channel.id,
            )
            .await?;
        }

        Ok((true, None))
    }

    /// Send a test notification
    pub async fn send_test(&self, channel: &NotificationChannel) -> Result<()> {
        let payload = AlertPayload {
            title: "Test Notification".to_string(),
            message: "This is a test notification from Bugwatch.".to_string(),
            severity: "info".to_string(),
            project_name: "Test Project".to_string(),
            trigger_type: "test".to_string(),
            trigger_id: None,
            url: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            project_id: None,
            issue: None,
            stack_trace: None,
            affected_users: None,
            frequency: None,
        };

        // Ignore any webhook action from test notifications
        let _ = self.send(channel, &payload).await?;
        Ok(())
    }

    /// Send email notification via configured transport (SMTP or SES)
    async fn send_email(
        &self,
        channel: &NotificationChannel,
        payload: &AlertPayload,
    ) -> Result<()> {
        let config: EmailConfig = serde_json::from_str(&channel.config)?;

        if config.recipients.is_empty() {
            return Err(anyhow!("No email recipients configured"));
        }

        match &self.email_transport {
            Some(EmailTransport::Smtp(transport)) => {
                for recipient in &config.recipients {
                    self.send_via_smtp(transport, recipient, payload).await?;
                }
                info!("Email sent to {:?} via SMTP", config.recipients);
            }
            #[cfg(feature = "saas")]
            Some(EmailTransport::Ses(ses)) => {
                for recipient in &config.recipients {
                    self.send_via_ses(ses, recipient, payload).await?;
                }
                info!("Email sent to {:?} via AWS SES", config.recipients);
            }
            None => {
                // Fallback: just log the email (for development/testing)
                info!(
                    "Email alert (no transport configured) to {:?}: {} - {}",
                    config.recipients, payload.title, payload.message
                );
            }
        }

        Ok(())
    }

    /// Send email via SMTP (self-hosted)
    async fn send_via_smtp(
        &self,
        transport: &AsyncSmtpTransport<Tokio1Executor>,
        recipient: &str,
        payload: &AlertPayload,
    ) -> Result<()> {
        let subject = format!("[Bugwatch] {}", payload.title);
        let html_body = self.build_email_html(payload);

        let email = LettreMessage::builder()
            .from(
                self.from_email
                    .parse()
                    .map_err(|e| anyhow!("Invalid from address: {}", e))?,
            )
            .to(recipient
                .parse()
                .map_err(|e| anyhow!("Invalid recipient address: {}", e))?)
            .subject(subject)
            .header(ContentType::TEXT_HTML)
            .body(html_body)
            .map_err(|e| anyhow!("Failed to build email: {}", e))?;

        transport
            .send(email)
            .await
            .map_err(|e| anyhow!("Failed to send email via SMTP: {}", e))?;

        Ok(())
    }

    /// Send email via AWS SES (SaaS)
    #[cfg(feature = "saas")]
    async fn send_via_ses(
        &self,
        ses: &SesClient,
        recipient: &str,
        payload: &AlertPayload,
    ) -> Result<()> {
        let subject = format!("[Bugwatch] {}", payload.title);

        // Build HTML email body
        let html_body = self.build_email_html(payload);
        // Strip CRLF to prevent email header injection via user-controlled fields.
        let title_safe = payload.title.replace('\r', "").replace('\n', " ");
        let message_safe = payload.message.replace('\r', "").replace('\n', " ");
        let text_body = format!(
            "{}\n\n{}\n\nProject: {}\nSeverity: {}\nTime: {}",
            title_safe, message_safe, payload.project_name, payload.severity, payload.timestamp
        );

        let email_content = EmailContent::builder()
            .simple(
                Message::builder()
                    .subject(Content::builder().data(subject).build()?)
                    .body(
                        Body::builder()
                            .html(Content::builder().data(html_body).build()?)
                            .text(Content::builder().data(text_body).build()?)
                            .build(),
                    )
                    .build(),
            )
            .build();

        ses.send_email()
            .from_email_address(&self.from_email)
            .destination(Destination::builder().to_addresses(recipient).build())
            .content(email_content)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to send email via SES: {}", e))?;

        Ok(())
    }

    fn build_email_html(&self, payload: &AlertPayload) -> String {
        let severity_color = match payload.severity.as_str() {
            "fatal" | "error" => "#dc2626",
            "warning" => "#f59e0b",
            "info" => "#3b82f6",
            _ => "#6b7280",
        };

        let view_link = payload.url.as_ref().map(|url| {
            format!(
                r#"<a href="{}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin-top: 16px;">View in Bugwatch</a>"#,
                html_escape(url)
            )
        }).unwrap_or_default();

        format!(
            r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6; padding: 20px; margin: 0;">
    <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="background-color: {}; padding: 16px 24px;">
            <h1 style="color: white; margin: 0; font-size: 18px;">{}</h1>
        </div>
        <div style="padding: 24px;">
            <p style="color: #374151; line-height: 1.6; margin: 0 0 16px 0;">{}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Project</td>
                    <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">{}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Severity</td>
                    <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">{}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Time</td>
                    <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">{}</td>
                </tr>
            </table>
            {}
        </div>
        <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">Sent by Bugwatch - AI-Powered Error Tracking</p>
        </div>
    </div>
</body>
</html>"#,
            severity_color,
            html_escape(&payload.title),
            html_escape(&payload.message),
            html_escape(&payload.project_name),
            html_escape(&payload.severity),
            html_escape(&payload.timestamp),
            view_link
        )
    }

    /// Send webhook notification
    ///
    /// Returns `Ok(Some(action))` when the webhook responds with
    /// `{"action": "resolve"}` or `{"action": "ignore"}`.
    async fn send_webhook(
        &self,
        channel: &NotificationChannel,
        payload: &AlertPayload,
    ) -> Result<Option<String>> {
        let config: WebhookConfig = serde_json::from_str(&channel.config)?;

        // SSRF guard: resolve the webhook hostname and reject private/internal addresses.
        // Collect all resolved IPs and pin them in a throw-away client to prevent
        // DNS rebinding (TOCTOU: reqwest would otherwise re-resolve the hostname on send).
        let parsed =
            url::Url::parse(&config.url).map_err(|_| anyhow::anyhow!("Webhook URL is invalid"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(anyhow::anyhow!("Webhook URL must use http or https"));
        }
        let host = parsed
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("Webhook URL has no host"))?
            .to_string();
        let port = parsed.port_or_known_default().unwrap_or(80);
        let lookup = format!("{}:{}", host, port);
        let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host(&lookup)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to resolve webhook host: {}", e))?
            .collect();
        if addrs.is_empty() {
            return Err(anyhow::anyhow!(
                "Webhook URL host did not resolve to any address"
            ));
        }
        for addr in &addrs {
            if is_ssrf_risk(addr.ip()) {
                return Err(anyhow::anyhow!(
                    "Webhook URL resolves to a private or internal address"
                ));
            }
        }
        let pinned_client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .resolve(&host, addrs[0])
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build pinned webhook client: {}", e))?;

        // Compute signature once; rebuild request each attempt since send() consumes the builder.
        let signature = config.secret.as_ref().map(|secret| {
            let payload_json = serde_json::to_string(payload).unwrap_or_default();
            compute_hmac_signature(&payload_json, secret)
        });

        // Single attempt — outer send_with_retry in alerting.rs handles up to 3
        // retries with jitter. An inner retry loop here would produce up to 9
        // total requests per alert to an already-failing endpoint.
        let mut req = pinned_client.post(&config.url).json(payload);
        if let Some(ref sig) = signature {
            req = req.header("X-Bugwatch-Signature", sig.as_str());
        }
        let response_body = match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                // Cap at 64KB to prevent memory exhaustion from hostile endpoints.
                let raw = resp.bytes().await.unwrap_or_default();
                let body = String::from_utf8_lossy(if raw.len() > 65_536 {
                    &raw[..65_536]
                } else {
                    &raw
                })
                .into_owned();
                if !status.is_success() {
                    return Err(anyhow!("Webhook failed: {} - {}", status, body));
                }
                body
            }
            Err(e) => return Err(anyhow::Error::from(e)),
        };

        info!("Webhook sent to {}", config.url);

        // Try to parse the response body for an action command
        if !response_body.is_empty() {
            if let Ok(webhook_resp) = serde_json::from_str::<WebhookResponse>(&response_body) {
                if let Some(action) = webhook_resp.action {
                    if action == "resolve" || action == "ignore" {
                        info!("Webhook returned action: {}", action);
                        return Ok(Some(action));
                    }
                }
            }
        }

        Ok(None)
    }

    /// Send Slack notification
    async fn send_slack(
        &self,
        channel: &NotificationChannel,
        payload: &AlertPayload,
    ) -> Result<()> {
        info!(
            "Attempting to send Slack notification to channel '{}'",
            channel.name
        );
        let config: SlackConfig = serde_json::from_str(&channel.config).map_err(|e| {
            error!("Failed to parse Slack config: {}", e);
            anyhow!("Invalid Slack config: {}", e)
        })?;

        // SSRF guard — validate Slack webhook URL resolves to a safe address.
        // Incoming webhook URLs are typically hooks.slack.com, but we validate
        // all resolutions to catch misconfigured or crafted URLs.
        {
            let parsed = url::Url::parse(&config.webhook_url)
                .map_err(|_| anyhow!("Slack webhook URL is invalid"))?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(anyhow!("Slack webhook URL must use http or https"));
            }
            let host = parsed
                .host_str()
                .ok_or_else(|| anyhow!("Slack webhook URL has no host"))?
                .to_string();
            let port = parsed.port_or_known_default().unwrap_or(443);
            let addrs: Vec<std::net::SocketAddr> =
                tokio::net::lookup_host(format!("{}:{}", host, port))
                    .await
                    .map_err(|e| anyhow!("Failed to resolve Slack webhook host: {}", e))?
                    .collect();
            for addr in &addrs {
                if is_ssrf_risk(addr.ip()) {
                    return Err(anyhow!(
                        "Slack webhook URL resolves to a private or internal address"
                    ));
                }
            }
        }

        info!(
            "Slack webhook URL host: {}",
            config.webhook_url.split('/').nth(2).unwrap_or("unknown")
        );

        // Get template (use default if not configured)
        let template = config.message_template.unwrap_or_default();

        // Build Slack message with blocks based on template
        let color = match payload.severity.as_str() {
            "fatal" | "error" => "#dc2626",
            "warning" => "#f59e0b",
            "info" => "#3b82f6",
            _ => "#6b7280",
        };

        let emoji = match payload.severity.as_str() {
            "fatal" => ":skull:",
            "error" => ":x:",
            "warning" => ":warning:",
            "info" => ":information_source:",
            _ => ":bell:",
        };

        let mut blocks: Vec<serde_json::Value> = Vec::new();

        // Build blocks based on template configuration
        for block_config in &template.blocks {
            if !block_config.enabled {
                continue;
            }

            match block_config.block_type {
                SlackBlockType::Header => {
                    // Slack section text limit: 3000 chars
                    let header_text = format!("{} *{}*", emoji, payload.title);
                    blocks.push(serde_json::json!({
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": truncate_str(&header_text, 3000)
                        }
                    }));
                }
                SlackBlockType::Message => {
                    // Slack section text limit: 3000 chars (account for backticks + ellipsis)
                    let msg = if payload.message.len() > 2997 {
                        let end = floor_char_boundary(&payload.message, 2993);
                        format!("`{}...`", &payload.message[..end])
                    } else {
                        format!("`{}`", payload.message)
                    };
                    blocks.push(serde_json::json!({
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": msg
                        }
                    }));
                }
                SlackBlockType::StackTrace => {
                    // Stack trace would come from extended payload - skip if not available
                }
                SlackBlockType::Context => {
                    // Slack context text limit: 3000 chars
                    let context_text = format!(
                        "*Project:* {} | *Severity:* {} | *Time:* {}",
                        payload.project_name, payload.severity, payload.timestamp
                    );
                    blocks.push(serde_json::json!({
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": truncate_str(&context_text, 3000)
                            }
                        ]
                    }));
                }
                SlackBlockType::Stats => {
                    // Stats would come from extended payload - skip if not available
                }
            }
        }

        // Build action links as mrkdwn (incoming webhooks don't support
        // interactive actions blocks — only Slack apps with interactivity do).
        if !template.actions.is_empty() {
            let mut links: Vec<String> = Vec::new();

            for action_config in &template.actions {
                match action_config.action_type {
                    SlackActionType::ViewIssue => {
                        if let Some(url) = &payload.url {
                            let safe_url = url.replace('>', "%3E").replace('|', "%7C");
                            links.push(format!("<{}|{}>", safe_url, action_config.label));
                        }
                    }
                    SlackActionType::Resolve => {
                        if let Some(url) = &payload.url {
                            let safe_url = url.replace('>', "%3E").replace('|', "%7C");
                            links.push(format!(
                                "<{}?action=resolve|{}>",
                                safe_url, action_config.label
                            ));
                        }
                    }
                    SlackActionType::Mute => {
                        if let Some(url) = &payload.url {
                            let safe_url = url.replace('>', "%3E").replace('|', "%7C");
                            links.push(format!(
                                "<{}?action=mute|{}>",
                                safe_url, action_config.label
                            ));
                        }
                    }
                }
            }

            if !links.is_empty() {
                blocks.push(serde_json::json!({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": links.join("  |  ")
                    }
                }));
            }
        }

        // If no blocks were generated, add a minimal fallback block
        if blocks.is_empty() {
            let fallback_block_text = format!("{} *{}*: {}", emoji, payload.title, payload.message);
            blocks.push(serde_json::json!({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": truncate_str(&fallback_block_text, 3000)
                }
            }));
        }

        let fallback_text = format!(
            "[{}] {}: {}",
            payload.severity, payload.title, payload.message
        );

        // Incoming webhooks do NOT support blocks inside attachments (that's
        // only available via chat.postMessage). Use top-level blocks for content
        // and a minimal attachment just for the color accent bar.
        let mut slack_payload = serde_json::json!({
            "text": truncate_str(&fallback_text, 300),
            "blocks": blocks,
            "attachments": [{
                "color": color,
                "fallback": " "
            }]
        });

        if let Some(channel) = &config.channel {
            slack_payload["channel"] = serde_json::json!(channel);
        }

        let response = self
            .client
            .post(&config.webhook_url)
            .json(&slack_payload)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!("Slack webhook failed with status {}: {}", status, body);
            return Err(anyhow!("Slack webhook failed: {} - {}", status, body));
        }

        info!(
            "Slack notification sent successfully to channel '{}'",
            channel.name
        );
        Ok(())
    }

    /// Send PagerDuty notification via Events API v2
    async fn send_pagerduty(
        &self,
        channel: &NotificationChannel,
        payload: &AlertPayload,
    ) -> Result<()> {
        let config: PagerDutyConfig = serde_json::from_str(&channel.config)?;

        if config.routing_key.trim().is_empty() {
            return Err(anyhow!("PagerDuty routing_key is empty"));
        }

        let pd_severity = if let Some(ref mapping) = config.severity_mapping {
            mapping
                .get(&payload.severity)
                .cloned()
                .unwrap_or_else(|| Self::map_to_pd_severity(&payload.severity))
        } else {
            Self::map_to_pd_severity(&payload.severity)
        };

        let pd_payload = serde_json::json!({
            "routing_key": config.routing_key,
            "event_action": "trigger",
            "payload": {
                "summary": format!("[{}] {}: {}", payload.project_name, payload.title, payload.message),
                "severity": pd_severity,
                "source": format!("bugwatch/{}", payload.project_name),
                "component": payload.trigger_type,
                "group": payload.project_name,
                "custom_details": {
                    "project": payload.project_name,
                    "trigger_type": payload.trigger_type,
                    "severity": payload.severity,
                    "url": payload.url,
                    "timestamp": payload.timestamp,
                }
            },
            "links": payload.url.as_ref().map(|u| vec![serde_json::json!({"href": u, "text": "View in Bugwatch"})]).unwrap_or_default(),
        });

        let response = self
            .client
            .post("https://events.pagerduty.com/v2/enqueue")
            .json(&pd_payload)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            tracing::warn!(status = %status, "PagerDuty notification failed");
            return Err(anyhow!(
                "PagerDuty notification failed with status {}",
                status
            ));
        }

        info!("PagerDuty notification sent");
        Ok(())
    }

    fn map_to_pd_severity(severity: &str) -> String {
        match severity {
            "fatal" => "critical".to_string(),
            "error" => "error".to_string(),
            "warning" => "warning".to_string(),
            _ => "info".to_string(),
        }
    }

    /// Send OpsGenie notification via Alerts API
    async fn send_opsgenie(
        &self,
        channel: &NotificationChannel,
        payload: &AlertPayload,
    ) -> Result<()> {
        let config: OpsGenieConfig = serde_json::from_str(&channel.config)?;

        if config.api_key.trim().is_empty() {
            return Err(anyhow!("OpsGenie api_key is empty"));
        }

        let priority = if let Some(ref mapping) = config.priority_mapping {
            mapping
                .get(&payload.severity)
                .cloned()
                .unwrap_or_else(|| Self::map_to_og_priority(&payload.severity))
        } else {
            Self::map_to_og_priority(&payload.severity)
        };

        let mut og_payload = serde_json::json!({
            "message": format!("[{}] {}", payload.project_name, payload.title),
            "description": payload.message,
            "priority": priority,
            "source": "Bugwatch",
            "tags": ["bugwatch", &payload.trigger_type],
            "details": {
                "project": payload.project_name,
                "trigger_type": payload.trigger_type,
                "severity": payload.severity,
                "timestamp": payload.timestamp,
            },
        });

        if let Some(url) = &payload.url {
            og_payload["details"]["url"] = serde_json::json!(url);
        }
        if let Some(ref team) = config.team {
            og_payload["responders"] = serde_json::json!([{"type": "team", "name": team}]);
        }

        let response = self
            .client
            .post("https://api.opsgenie.com/v2/alerts")
            .header("Authorization", format!("GenieKey {}", config.api_key))
            .json(&og_payload)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            tracing::warn!(status = %status, "OpsGenie notification failed");
            return Err(anyhow!(
                "OpsGenie notification failed with status {}",
                status
            ));
        }

        info!("OpsGenie notification sent");
        Ok(())
    }

    fn map_to_og_priority(severity: &str) -> String {
        match severity {
            "fatal" => "P1".to_string(),
            "error" => "P2".to_string(),
            "warning" => "P3".to_string(),
            _ => "P5".to_string(),
        }
    }
}

/// Find the largest byte index <= `i` that is a char boundary in `s`.
/// Stable replacement for the nightly `str::floor_char_boundary`.
fn floor_char_boundary(s: &str, i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    let mut pos = i;
    while pos > 0 && !s.is_char_boundary(pos) {
        pos -= 1;
    }
    pos
}

/// Truncate a string to a max byte length, appending "..." if truncated.
/// Ensures we don't cut in the middle of a multi-byte char.
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }
    let truncated = &s[..floor_char_boundary(s, max_len.saturating_sub(3))];
    format!("{}...", truncated)
}

/// Escape HTML special characters to prevent injection in email bodies.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// Compute HMAC-SHA256 signature for webhook payloads
pub(crate) fn compute_hmac_signature(payload: &str, secret: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());

    let result = mac.finalize();
    let bytes = result.into_bytes();

    // Return as hex string
    hex::encode(bytes)
}
