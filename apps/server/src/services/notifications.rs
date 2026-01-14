use anyhow::{anyhow, Result};
use aws_sdk_sesv2::types::{Body, Content, Destination, EmailContent, Message};
use aws_sdk_sesv2::Client as SesClient;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use crate::db::models::NotificationChannel;
use crate::db::repositories::alerts::EmailRateLimitRepository;
use crate::db::DbPool;

/// Notification service for sending alerts via various channels
pub struct NotificationService {
    client: Client,
    ses_client: Option<SesClient>,
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

        // Initialize AWS SES client if credentials are available
        let ses_client = match Self::init_ses_client().await {
            Ok(client) => {
                info!("AWS SES client initialized successfully");
                Some(client)
            }
            Err(e) => {
                warn!("AWS SES not configured, email notifications will be logged only: {}", e);
                None
            }
        };

        let from_email = std::env::var("FROM_EMAIL")
            .unwrap_or_else(|_| "alerts@bugwatch.dev".to_string());

        Self {
            client,
            ses_client,
            from_email,
        }
    }

    async fn init_ses_client() -> Result<SesClient> {
        let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;

        // Verify we have credentials by checking for region
        if config.region().is_none() {
            return Err(anyhow!("AWS region not configured"));
        }

        Ok(SesClient::new(&config))
    }

    /// Send an alert to a notification channel (without rate limiting)
    pub async fn send(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<()> {
        match channel.channel_type.as_str() {
            "email" => self.send_email(channel, payload).await,
            "webhook" => self.send_webhook(channel, payload).await,
            "slack" => self.send_slack(channel, payload).await,
            _ => Err(anyhow!("Unknown channel type: {}", channel.channel_type)),
        }
    }

    /// Send an alert with rate limiting support (for email)
    pub async fn send_with_rate_limit(
        &self,
        pool: &DbPool,
        channel: &NotificationChannel,
        payload: &AlertPayload,
        context: &AlertContext,
    ) -> Result<bool> {
        // Only apply rate limiting to email channels
        if channel.channel_type != "email" {
            self.send(channel, payload).await?;
            return Ok(true);
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
                return Ok(false);
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

        Ok(true)
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
        };

        self.send(channel, &payload).await
    }

    /// Send email notification via AWS SES
    async fn send_email(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<()> {
        let config: EmailConfig = serde_json::from_str(&channel.config)?;

        if config.recipients.is_empty() {
            return Err(anyhow!("No email recipients configured"));
        }

        // Use AWS SES if available, otherwise log
        match &self.ses_client {
            Some(ses) => {
                for recipient in &config.recipients {
                    self.send_via_ses(ses, recipient, payload).await?;
                }
                info!("Email sent to {:?} via AWS SES", config.recipients);
            }
            None => {
                // Fallback: just log the email (for development/testing)
                info!(
                    "Email alert (SES not configured) to {:?}: {} - {}",
                    config.recipients, payload.title, payload.message
                );
            }
        }

        Ok(())
    }

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
                url
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
            payload.title,
            payload.message,
            payload.project_name,
            payload.severity,
            payload.timestamp,
            view_link
        )
    }

    /// Send webhook notification
    async fn send_webhook(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<()> {
        let config: WebhookConfig = serde_json::from_str(&channel.config)?;

        let mut request = self.client.post(&config.url).json(payload);

        // Add HMAC signature if secret is configured
        if let Some(secret) = &config.secret {
            let payload_json = serde_json::to_string(payload)?;
            let signature = compute_hmac_signature(&payload_json, secret);
            request = request.header("X-Bugwatch-Signature", signature);
        }

        let response = request.send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Webhook failed: {} - {}", status, body));
        }

        info!("Webhook sent to {}", config.url);
        Ok(())
    }

    /// Send Slack notification
    async fn send_slack(&self, channel: &NotificationChannel, payload: &AlertPayload) -> Result<()> {
        let config: SlackConfig = serde_json::from_str(&channel.config)?;

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
                    blocks.push(serde_json::json!({
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": format!("{} {}", emoji, payload.title),
                            "emoji": true
                        }
                    }));
                }
                SlackBlockType::Message => {
                    blocks.push(serde_json::json!({
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": format!("`{}`", payload.message)
                        }
                    }));
                }
                SlackBlockType::StackTrace => {
                    // Stack trace would come from extended payload - skip if not available
                    // This is a placeholder for when we have stack trace data
                }
                SlackBlockType::Context => {
                    blocks.push(serde_json::json!({
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": format!("*Project:* {} | *Severity:* {} | *Time:* {}",
                                    payload.project_name,
                                    payload.severity,
                                    payload.timestamp
                                )
                            }
                        ]
                    }));
                }
                SlackBlockType::Stats => {
                    // Stats would come from extended payload - skip if not available
                }
            }
        }

        // Build action buttons based on template configuration
        if !template.actions.is_empty() {
            let mut action_elements: Vec<serde_json::Value> = Vec::new();

            for action_config in &template.actions {
                match action_config.action_type {
                    SlackActionType::ViewIssue => {
                        if let Some(url) = &payload.url {
                            let mut button = serde_json::json!({
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": &action_config.label
                                },
                                "url": url
                            });
                            if let Some(style) = &action_config.style {
                                button["style"] = serde_json::json!(style);
                            }
                            action_elements.push(button);
                        }
                    }
                    SlackActionType::Resolve => {
                        // Interactive actions require Slack app setup
                        // For now, just show as a link button that opens Bugwatch
                        if let Some(url) = &payload.url {
                            let mut button = serde_json::json!({
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": &action_config.label
                                },
                                "url": format!("{}?action=resolve", url)
                            });
                            if let Some(style) = &action_config.style {
                                button["style"] = serde_json::json!(style);
                            }
                            action_elements.push(button);
                        }
                    }
                    SlackActionType::Mute => {
                        if let Some(url) = &payload.url {
                            let mut button = serde_json::json!({
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": &action_config.label
                                },
                                "url": format!("{}?action=mute", url)
                            });
                            if let Some(style) = &action_config.style {
                                button["style"] = serde_json::json!(style);
                            }
                            action_elements.push(button);
                        }
                    }
                }
            }

            if !action_elements.is_empty() {
                blocks.push(serde_json::json!({
                    "type": "actions",
                    "elements": action_elements
                }));
            }
        }

        let slack_payload = serde_json::json!({
            "channel": config.channel,
            "attachments": [{
                "color": color,
                "blocks": blocks
            }]
        });

        let response = self
            .client
            .post(&config.webhook_url)
            .json(&slack_payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Slack webhook failed: {} - {}", status, body));
        }

        info!("Slack notification sent");
        Ok(())
    }
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
