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

/// Notification service for sending alerts via various channels
pub struct NotificationService {
    client: Client,
    email_transport: Option<EmailTransport>,
    from_email: String,
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
                SlackBlockConfig { block_type: SlackBlockType::Header, enabled: true },
                SlackBlockConfig { block_type: SlackBlockType::Message, enabled: true },
                SlackBlockConfig { block_type: SlackBlockType::StackTrace, enabled: true },
                SlackBlockConfig { block_type: SlackBlockType::Context, enabled: true },
            ],
            actions: vec![
                SlackActionConfig {
                    action_type: SlackActionType::ViewIssue,
                    label: "View in Bugwatch".to_string(),
                    style: Some("primary".to_string()),
                },
            ],
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
        let email_transport = Self::init_smtp_transport()
            .map(|t| {
                info!("SMTP email transport initialized");
                EmailTransport::Smtp(t)
            })
            .ok()
            .or_else(|| Self::init_ses_transport_sync());

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
        }
    }

    /// Initialize SMTP transport from environment variables
    fn init_smtp_transport() -> Result<AsyncSmtpTransport<Tokio1Executor>> {
        let host = std::env::var("SMTP_HOST")
            .map_err(|_| anyhow!("SMTP_HOST not set"))?;
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
    fn init_ses_transport_sync() -> Option<EmailTransport> {
        #[cfg(feature = "saas")]
        {
            // Use tokio::task::block_in_place to run async SES init
            match tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(Self::init_ses_client())
            }) {
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
    pub async fn send(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<Option<String>> {
        match channel.channel_type.as_str() {
            "email" => { self.send_email(channel, payload).await?; Ok(None) }
            "webhook" => self.send_webhook(channel, payload).await,
            "slack" => { self.send_slack(channel, payload).await?; Ok(None) }
            _ => Err(anyhow!("Unknown channel type: {}", channel.channel_type)),
        }
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
    async fn send_email(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<()> {
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
            .from(self.from_email.parse().map_err(|e| anyhow!("Invalid from address: {}", e))?)
            .to(recipient.parse().map_err(|e| anyhow!("Invalid recipient address: {}", e))?)
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
    async fn send_via_ses(&self, ses: &SesClient, recipient: &str, payload: &AlertPayload) -> Result<()> {
        let subject = format!("[Bugwatch] {}", payload.title);

        // Build HTML email body
        let html_body = self.build_email_html(payload);
        let text_body = format!(
            "{}\n\n{}\n\nProject: {}\nSeverity: {}\nTime: {}",
            payload.title,
            payload.message,
            payload.project_name,
            payload.severity,
            payload.timestamp
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
            .destination(
                Destination::builder()
                    .to_addresses(recipient)
                    .build(),
            )
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
    async fn send_webhook(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<Option<String>> {
        let config: WebhookConfig = serde_json::from_str(&channel.config)?;

        let mut request = self.client.post(&config.url).json(payload);

        // Add HMAC signature if secret is configured
        if let Some(secret) = &config.secret {
            let payload_json = serde_json::to_string(payload)?;
            let signature = compute_hmac_signature(&payload_json, secret);
            request = request.header("X-Bugwatch-Signature", signature);
        }

        let response = request.send().await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Webhook failed: {} - {}", status, body));
        }

        info!("Webhook sent to {}", config.url);

        // Try to parse the response body for an action command
        if !body.is_empty() {
            if let Ok(webhook_resp) = serde_json::from_str::<WebhookResponse>(&body) {
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
    async fn send_slack(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<()> {
        info!("Attempting to send Slack notification to channel '{}'", channel.name);
        let config: SlackConfig = serde_json::from_str(&channel.config)
            .map_err(|e| {
                error!("Failed to parse Slack config: {}", e);
                anyhow!("Invalid Slack config: {}", e)
            })?;

        info!("Slack webhook URL configured: {}...", &config.webhook_url.chars().take(50).collect::<String>());

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
                    let context_text = format!("*Project:* {} | *Severity:* {} | *Time:* {}",
                        payload.project_name,
                        payload.severity,
                        payload.timestamp
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
                            links.push(format!("<{}|{}>", url, action_config.label));
                        }
                    }
                    SlackActionType::Resolve => {
                        if let Some(url) = &payload.url {
                            links.push(format!("<{}?action=resolve|{}>", url, action_config.label));
                        }
                    }
                    SlackActionType::Mute => {
                        if let Some(url) = &payload.url {
                            links.push(format!("<{}?action=mute|{}>", url, action_config.label));
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

        let fallback_text = format!("[{}] {}: {}", payload.severity, payload.title, payload.message);

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
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!("Slack webhook failed with status {}: {}", status, body);
            return Err(anyhow!("Slack webhook failed: {} - {}", status, body));
        }

        info!("Slack notification sent successfully to channel '{}'", channel.name);
        Ok(())
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
fn compute_hmac_signature(payload: &str, secret: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());

    let result = mac.finalize();
    let bytes = result.into_bytes();

    // Return as hex string
    hex::encode(bytes)
}

impl Default for NotificationService {
    fn default() -> Self {
        // Use blocking runtime for default initialization
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(Self::new())
        })
    }
}
