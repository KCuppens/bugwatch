use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{AuthIdentity, EitherAuth},
    billing::tiers::can_access_feature,
    db::{
        models::{AlertCondition, AlertLog, AlertRule, NotificationChannel},
        repositories::{
            AlertLogRepository, AlertRuleRepository, NotificationChannelRepository,
            OrganizationRepository, ProjectRepository,
        },
    },
    AppError, AppResult, AppState,
};

// ============ Helpers ============

fn is_valid_email(s: &str) -> bool {
    let mut parts = s.splitn(2, '@');
    let local = parts.next().unwrap_or("");
    let domain = parts.next().unwrap_or("");
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

fn validate_channel_url(url: &str) -> AppResult<()> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(AppError::BadRequest(
            "Webhook URL must use http:// or https://".to_string(),
        ));
    }
    let host_part = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host_with_port = host_part.split('/').next().unwrap_or("");
    let host = if host_with_port.starts_with('[') {
        // IPv6 literal: [::1] or [::1]:8080 — extract between brackets
        host_with_port
            .split(']')
            .next()
            .unwrap_or("")
            .trim_start_matches('[')
    } else {
        host_with_port.split(':').next().unwrap_or("")
    };
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") {
        return Err(AppError::BadRequest(
            "Webhook URL must not target internal hostnames".to_string(),
        ));
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let blocked = match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() || v6.is_unspecified() {
                    true
                } else if v6
                    .to_ipv4_mapped()
                    .map(|v4| v4.is_loopback() || v4.is_private() || v4.is_link_local())
                    .unwrap_or(false)
                {
                    true
                } else {
                    // IPv6 link-local: fe80::/10
                    // IPv6 unique-local: fc00::/7 (fc:: and fd::)
                    let o = v6.octets();
                    let is_link_local = o[0] == 0xfe && (o[1] & 0xc0) == 0x80;
                    let is_unique_local = o[0] & 0xfe == 0xfc;
                    is_link_local || is_unique_local
                }
            }
        };
        if blocked {
            return Err(AppError::BadRequest(
                "Webhook URL must not target private or loopback addresses".to_string(),
            ));
        }
    }
    Ok(())
}

// ============ Alert Rules ============

#[derive(Debug, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub name: String,
    pub condition: AlertCondition,
    pub channel_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAlertRuleRequest {
    pub name: Option<String>,
    pub condition: Option<AlertCondition>,
    pub channel_ids: Option<Vec<String>>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AlertRuleResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub condition: AlertCondition,
    pub channel_ids: Vec<String>,
    pub is_active: bool,
    pub created_at: String,
    pub muted_until: Option<String>,
}

impl TryFrom<AlertRule> for AlertRuleResponse {
    type Error = serde_json::Error;

    fn try_from(rule: AlertRule) -> Result<Self, Self::Error> {
        let condition: AlertCondition = serde_json::from_str(&rule.condition)?;
        let channel_ids: Vec<String> = serde_json::from_str(&rule.actions)?;

        Ok(Self {
            id: rule.id,
            project_id: rule.project_id,
            name: rule.name,
            condition,
            channel_ids,
            is_active: *rule.is_active,
            created_at: rule.created_at.to_rfc3339(),
            muted_until: rule.muted_until.map(|t| t.to_rfc3339()),
        })
    }
}

/// POST /api/v1/projects/:project_id/alerts
pub async fn create_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path(project_id): Path<String>,
    Json(request): Json<CreateAlertRuleRequest>,
) -> AppResult<Json<AlertRuleResponse>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // E5: rate limit create_alert_rule
    let _rl_key_create_alert = {
        let id = match &*auth {
            AuthIdentity::User(u) => u.id.clone(),
            AuthIdentity::Agent(a) => a.organization_id.clone(),
        };
        format!("create_alert:{}:{}", id, project_id)
    };
    let rl = state.rate_limiter.check(&_rl_key_create_alert, 30);
    if !rl.allowed {
        return Err(AppError::BadRequest(
            "Too many requests. Please try again later.".to_string(),
        ));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Gate server alert conditions behind server_monitoring feature (Pro+)
    let is_server_condition = matches!(
        request.condition,
        AlertCondition::ServerCpuHigh { .. }
            | AlertCondition::ServerMemoryHigh { .. }
            | AlertCondition::ServerDiskHigh { .. }
            | AlertCondition::ServerOffline { .. }
    );
    if is_server_condition
        && !state.config.deployment_mode.is_self_hosted()
        && !(state.config.x402_enabled && x402_verified.is_some())
    {
        let tier_str = OrganizationRepository::get_project_tier(&state.db, &project_id)
            .await
            .unwrap_or_else(|_| "free".to_string());
        if !can_access_feature(&tier_str, "server_monitoring") {
            let org_id = project.organization_id.as_deref().unwrap_or("");
            let resource = format!("/api/v1/projects/{}/alerts", project_id);
            return Err(crate::payments::x402_feature_response(
                &state,
                "server_monitoring",
                &resource,
                org_id,
                None,
                "Server alert rules require a Pro plan or higher.",
            )
            .await);
        }
    }

    // B1: cap alert rule name length
    if request.name.len() > 200 {
        return Err(AppError::BadRequest(
            "Alert rule name too long (max 200 characters)".to_string(),
        ));
    }

    // H7: validate condition thresholds
    match &request.condition {
        AlertCondition::IssueFrequency {
            threshold,
            window_minutes,
        } => {
            if *threshold == 0 {
                return Err(AppError::BadRequest(
                    "threshold must be greater than 0".to_string(),
                ));
            }
            if *window_minutes == 0 {
                return Err(AppError::BadRequest(
                    "window_minutes must be greater than 0".to_string(),
                ));
            }
        }
        AlertCondition::ServerCpuHigh {
            threshold_percent, ..
        }
        | AlertCondition::ServerMemoryHigh {
            threshold_percent, ..
        }
        | AlertCondition::ServerDiskHigh {
            threshold_percent, ..
        } => {
            if *threshold_percent <= 0.0 || *threshold_percent > 100.0 {
                return Err(AppError::BadRequest(
                    "threshold_percent must be between 0 and 100".to_string(),
                ));
            }
        }
        AlertCondition::ServerOffline {
            missing_minutes, ..
        } => {
            if *missing_minutes == 0 {
                return Err(AppError::BadRequest(
                    "missing_minutes must be greater than 0".to_string(),
                ));
            }
        }
        _ => {}
    }

    let condition_json = serde_json::to_string(&request.condition)
        .map_err(|e| AppError::BadRequest(format!("Invalid condition: {}", e)))?;

    // B3: cap condition JSON size to prevent oversized payloads
    if condition_json.len() > 65_536 {
        return Err(AppError::BadRequest(
            "Alert condition too complex (max 64KB)".to_string(),
        ));
    }

    // F2: cap channel_ids per alert rule
    if request.channel_ids.len() > 20 {
        return Err(AppError::BadRequest(
            "Alert rule supports at most 20 notification channels".to_string(),
        ));
    }

    let actions_json = serde_json::to_string(&request.channel_ids)
        .map_err(|e| AppError::BadRequest(format!("Invalid channel IDs: {}", e)))?;

    let rule = AlertRuleRepository::create(
        &state.db,
        &project_id,
        &request.name,
        &condition_json,
        &actions_json,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create alert rule: {}", e)))?;

    let response = AlertRuleResponse::try_from(rule)
        .map_err(|e| AppError::Internal(format!("Failed to parse rule: {}", e)))?;

    Ok(Json(response))
}

/// GET /api/v1/projects/:project_id/alerts
pub async fn list_alert_rules(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<AlertRuleResponse>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rules = AlertRuleRepository::list_by_project(&state.db, &project_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list alert rules: {}", e)))?;

    let responses: Result<Vec<AlertRuleResponse>, _> =
        rules.into_iter().map(AlertRuleResponse::try_from).collect();

    let responses =
        responses.map_err(|e| AppError::Internal(format!("Failed to parse rules: {}", e)))?;

    Ok(Json(responses))
}

/// PATCH /api/v1/projects/:project_id/alerts/:alert_id
pub async fn update_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, alert_id)): Path<(String, String)>,
    Json(request): Json<UpdateAlertRuleRequest>,
) -> AppResult<Json<AlertRuleResponse>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("alerts_update", &auth),
        20,
    )?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // B1: validate update fields
    if let Some(ref name) = request.name {
        if name.len() > 200 {
            return Err(AppError::BadRequest(
                "Alert rule name too long (max 200 characters)".to_string(),
            ));
        }
    }
    if let Some(ref condition) = request.condition {
        let condition_json_check = serde_json::to_string(condition)
            .map_err(|e| AppError::BadRequest(format!("Invalid condition: {}", e)))?;
        if condition_json_check.len() > 65_536 {
            return Err(AppError::BadRequest(
                "Alert condition too complex (max 64KB)".to_string(),
            ));
        }
        match condition {
            AlertCondition::IssueFrequency {
                threshold,
                window_minutes,
            } => {
                if *threshold == 0 {
                    return Err(AppError::BadRequest(
                        "threshold must be greater than 0".to_string(),
                    ));
                }
                if *window_minutes == 0 {
                    return Err(AppError::BadRequest(
                        "window_minutes must be greater than 0".to_string(),
                    ));
                }
            }
            AlertCondition::ServerCpuHigh {
                threshold_percent, ..
            }
            | AlertCondition::ServerMemoryHigh {
                threshold_percent, ..
            }
            | AlertCondition::ServerDiskHigh {
                threshold_percent, ..
            } => {
                if *threshold_percent <= 0.0 || *threshold_percent > 100.0 {
                    return Err(AppError::BadRequest(
                        "threshold_percent must be between 0 and 100".to_string(),
                    ));
                }
            }
            AlertCondition::ServerOffline {
                missing_minutes, ..
            } => {
                if *missing_minutes == 0 {
                    return Err(AppError::BadRequest(
                        "missing_minutes must be greater than 0".to_string(),
                    ));
                }
            }
            _ => {}
        }
    }

    // F2: cap channel_ids on update
    if let Some(ref ids) = request.channel_ids {
        if ids.len() > 20 {
            return Err(AppError::BadRequest(
                "Alert rule supports at most 20 notification channels".to_string(),
            ));
        }
    }

    let condition_json = request
        .condition
        .as_ref()
        .map(|c| serde_json::to_string(c))
        .transpose()
        .map_err(|e| AppError::BadRequest(format!("Invalid condition: {}", e)))?;

    let actions_json = request
        .channel_ids
        .as_ref()
        .map(|ids| serde_json::to_string(ids))
        .transpose()
        .map_err(|e| AppError::BadRequest(format!("Invalid channel IDs: {}", e)))?;

    let updated = AlertRuleRepository::update(
        &state.db,
        &alert_id,
        request.name.as_deref(),
        condition_json.as_deref(),
        actions_json.as_deref(),
        request.is_active,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to update alert rule: {}", e)))?;

    let response = AlertRuleResponse::try_from(updated)
        .map_err(|e| AppError::Internal(format!("Failed to parse rule: {}", e)))?;

    Ok(Json(response))
}

/// DELETE /api/v1/projects/:project_id/alerts/:alert_id
pub async fn delete_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, alert_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("alerts_delete", &auth),
        10,
    )?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    AlertRuleRepository::delete(&state.db, &alert_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete alert rule: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Alert rule deleted" })))
}

// ============ Notification Channels ============

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub channel_type: ChannelType,
    pub config: ChannelConfig,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelType {
    Email,
    Webhook,
    Slack,
    Pagerduty,
    Opsgenie,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChannelConfig {
    Email {
        recipients: Vec<String>,
    },
    Webhook {
        url: String,
        secret: Option<String>,
    },
    Slack {
        webhook_url: String,
        channel: Option<String>,
    },
    PagerDuty {
        routing_key: String,
        severity_mapping: Option<std::collections::HashMap<String, String>>,
    },
    OpsGenie {
        api_key: String,
        team: Option<String>,
        priority_mapping: Option<std::collections::HashMap<String, String>>,
    },
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub config: Option<ChannelConfig>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ChannelResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub channel_type: String,
    pub config: serde_json::Value,
    pub is_active: bool,
    pub created_at: String,
}

impl From<NotificationChannel> for ChannelResponse {
    fn from(channel: NotificationChannel) -> Self {
        let mut config: serde_json::Value = serde_json::from_str(&channel.config)
            .inspect_err(|e| {
                tracing::warn!(channel_id = %channel.id, error = %e, "Failed to parse channel config JSON");
            })
            .unwrap_or(serde_json::Value::Null);

        // Never return raw credentials to clients
        if let Some(obj) = config.as_object_mut() {
            // Exact-match keys kept from before
            for key in &["api_key", "routing_key", "secret", "webhook_url"] {
                if obj.contains_key(*key) {
                    obj.insert(
                        (*key).to_string(),
                        serde_json::Value::String("***".to_string()),
                    );
                }
            }
            // B6: also redact any key whose name contains sensitive substrings
            let sensitive_substrings = ["access_token", "bearer_token", "auth_token", "password"];
            let keys_to_redact: Vec<String> = obj
                .keys()
                .filter(|k| {
                    let kl = k.to_lowercase();
                    sensitive_substrings.iter().any(|s| kl.contains(s))
                })
                .cloned()
                .collect();
            for k in keys_to_redact {
                obj.insert(k, serde_json::Value::String("***".to_string()));
            }
        }

        Self {
            id: channel.id,
            project_id: channel.project_id,
            name: channel.name,
            channel_type: channel.channel_type,
            config,
            is_active: *channel.is_active,
            created_at: channel.created_at.to_rfc3339(),
        }
    }
}

/// POST /api/v1/projects/:project_id/channels
pub async fn create_channel(
    State(state): State<AppState>,
    auth: EitherAuth,
    x402_verified: Option<axum::Extension<crate::payments::X402PaymentVerified>>,
    Path(project_id): Path<String>,
    Json(request): Json<CreateChannelRequest>,
) -> AppResult<Json<ChannelResponse>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // E6: rate limit create_channel
    let _rl_key_create_channel = {
        let id = match &*auth {
            AuthIdentity::User(u) => u.id.clone(),
            AuthIdentity::Agent(a) => a.organization_id.clone(),
        };
        format!("create_channel:{}:{}", id, project_id)
    };
    let rl = state.rate_limiter.check(&_rl_key_create_channel, 30);
    if !rl.allowed {
        return Err(AppError::BadRequest(
            "Too many requests. Please try again later.".to_string(),
        ));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Gate notification channel types by tier (bypassed in self-hosted mode or valid x402 payment)
    let channel_type = if state.config.deployment_mode.is_self_hosted()
        || (state.config.x402_enabled && x402_verified.is_some())
    {
        match request.channel_type {
            ChannelType::Email => "email",
            ChannelType::Webhook => "webhook",
            ChannelType::Slack => "slack",
            ChannelType::Pagerduty => "pagerduty",
            ChannelType::Opsgenie => "opsgenie",
        }
    } else {
        let tier_str = OrganizationRepository::get_project_tier(&state.db, &project_id)
            .await
            .unwrap_or_else(|_| "free".to_string());

        let org_id = project.organization_id.as_deref().unwrap_or("");
        let channel_resource = format!("/api/v1/projects/{}/channels", project_id);
        match request.channel_type {
            ChannelType::Email => {
                if !can_access_feature(&tier_str, "email_notifications") {
                    return Err(crate::payments::x402_feature_response(
                        &state,
                        "email_notifications",
                        &channel_resource,
                        org_id,
                        None,
                        "Email notifications require a Pro plan or higher.",
                    )
                    .await);
                }
                "email"
            }
            ChannelType::Webhook => {
                if !can_access_feature(&tier_str, "webhooks") {
                    return Err(crate::payments::x402_feature_response(
                        &state,
                        "webhooks",
                        &channel_resource,
                        org_id,
                        None,
                        "Webhook notifications require a Pro plan or higher.",
                    )
                    .await);
                }
                "webhook"
            }
            ChannelType::Slack => "slack",
            ChannelType::Pagerduty => {
                if !can_access_feature(&tier_str, "pagerduty") {
                    return Err(crate::payments::x402_feature_response(
                        &state,
                        "pagerduty",
                        &channel_resource,
                        org_id,
                        None,
                        "PagerDuty integration requires a Pro plan or higher.",
                    )
                    .await);
                }
                "pagerduty"
            }
            ChannelType::Opsgenie => {
                if !can_access_feature(&tier_str, "opsgenie") {
                    return Err(crate::payments::x402_feature_response(
                        &state,
                        "opsgenie",
                        &channel_resource,
                        org_id,
                        None,
                        "OpsGenie integration requires a Team plan or higher.",
                    )
                    .await);
                }
                "opsgenie"
            }
        }
    };

    // Validate that the config matches the channel type
    match (&request.channel_type, &request.config) {
        (ChannelType::Email, ChannelConfig::Email { .. }) => {}
        (ChannelType::Webhook, ChannelConfig::Webhook { .. }) => {}
        (ChannelType::Slack, ChannelConfig::Slack { .. }) => {}
        (ChannelType::Pagerduty, ChannelConfig::PagerDuty { .. }) => {}
        (ChannelType::Opsgenie, ChannelConfig::OpsGenie { .. }) => {}
        _ => {
            return Err(AppError::BadRequest(
                "Channel config does not match the channel type".to_string(),
            ));
        }
    }

    // B2: cap channel name length
    if request.name.len() > 200 {
        return Err(AppError::BadRequest(
            "Channel name too long (max 200 characters)".to_string(),
        ));
    }

    // B4: validate email recipient format; F1: cap recipients
    if let ChannelConfig::Email { ref recipients } = request.config {
        for r in recipients {
            if !is_valid_email(r) {
                return Err(AppError::BadRequest(format!(
                    "Invalid email address: {}",
                    r
                )));
            }
        }
        if recipients.len() > 10 {
            return Err(AppError::BadRequest(
                "Email channel supports at most 10 recipients".to_string(),
            ));
        }
    }

    // H3: validate webhook/Slack URLs against SSRF
    let url_to_check: Option<&str> = match &request.config {
        ChannelConfig::Webhook { ref url, .. } => Some(url.as_str()),
        ChannelConfig::Slack {
            ref webhook_url, ..
        } => Some(webhook_url.as_str()),
        _ => None,
    };
    if let Some(url) = url_to_check {
        validate_channel_url(url)?;
    }

    let config_json = serde_json::to_string(&request.config)
        .map_err(|e| AppError::BadRequest(format!("Invalid config: {}", e)))?;

    let channel = NotificationChannelRepository::create(
        &state.db,
        &project_id,
        &request.name,
        channel_type,
        &config_json,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create channel: {}", e)))?;

    Ok(Json(ChannelResponse::from(channel)))
}

/// GET /api/v1/projects/:project_id/channels
pub async fn list_channels(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<ChannelResponse>>> {
    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channels = NotificationChannelRepository::list_by_project(&state.db, &project_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list channels: {}", e)))?;

    let responses: Vec<ChannelResponse> = channels.into_iter().map(ChannelResponse::from).collect();

    Ok(Json(responses))
}

/// PATCH /api/v1/projects/:project_id/channels/:channel_id
pub async fn update_channel(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, channel_id)): Path<(String, String)>,
    Json(request): Json<UpdateChannelRequest>,
) -> AppResult<Json<ChannelResponse>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("channels_update", &auth),
        20,
    )?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel = NotificationChannelRepository::find_by_id(&state.db, &channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".to_string()))?;

    if channel.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // B2: validate channel name length on update
    if let Some(ref name) = request.name {
        if name.len() > 200 {
            return Err(AppError::BadRequest(
                "Channel name too long (max 200 characters)".to_string(),
            ));
        }
    }

    // For Email config updates, validate recipients
    if let Some(ChannelConfig::Email { ref recipients }) = request.config {
        for r in recipients {
            if !is_valid_email(r) {
                return Err(AppError::BadRequest(format!(
                    "Invalid email address: {}",
                    r
                )));
            }
        }
        // F1: cap recipients on update
        if recipients.len() > 10 {
            return Err(AppError::BadRequest(
                "Email channel supports at most 10 recipients".to_string(),
            ));
        }
    }

    // H3: validate webhook/Slack URLs on update
    if let Some(ref cfg) = request.config {
        let url_to_check: Option<&str> = match cfg {
            ChannelConfig::Webhook { ref url, .. } => Some(url.as_str()),
            ChannelConfig::Slack {
                ref webhook_url, ..
            } => Some(webhook_url.as_str()),
            _ => None,
        };
        if let Some(url) = url_to_check {
            validate_channel_url(url)?;
        }
    }

    let config_json = request
        .config
        .as_ref()
        .map(|c| serde_json::to_string(c))
        .transpose()
        .map_err(|e| AppError::BadRequest(format!("Invalid config: {}", e)))?;

    let updated = NotificationChannelRepository::update(
        &state.db,
        &channel_id,
        request.name.as_deref(),
        config_json.as_deref(),
        request.is_active,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to update channel: {}", e)))?;

    Ok(Json(ChannelResponse::from(updated)))
}

/// DELETE /api/v1/projects/:project_id/channels/:channel_id
pub async fn delete_channel(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, channel_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("channels_delete", &auth),
        10,
    )?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel = NotificationChannelRepository::find_by_id(&state.db, &channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".to_string()))?;

    if channel.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    NotificationChannelRepository::delete(&state.db, &channel_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete channel: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Channel deleted" })))
}

// ============ Alert Logs ============

#[derive(Debug, Deserialize)]
pub struct AlertLogsQuery {
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    50
}

/// GET /api/v1/projects/:project_id/alerts/logs
pub async fn list_alert_logs(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path(project_id): Path<String>,
    Query(query): Query<AlertLogsQuery>,
) -> AppResult<Json<Vec<AlertLog>>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("alert_logs_list", &auth),
        30,
    )?;

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    if query.limit == 0 {
        return Err(AppError::BadRequest("limit must be at least 1".to_string()));
    }

    let logs = AlertLogRepository::list_by_project(&state.db, &project_id, query.limit.min(100))
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list logs: {}", e)))?;

    Ok(Json(logs))
}

// ============ Cross-Project Alert Logs ============

#[derive(Debug, Deserialize)]
pub struct AcrossProjectsAlertLogsQuery {
    #[serde(default = "default_across_limit")]
    pub limit: u32,
    pub offset: Option<i64>,
}

fn default_across_limit() -> u32 {
    10
}

#[derive(Debug, Serialize)]
pub struct AlertLogWithProjectInfo {
    pub id: String,
    pub alert_rule_id: String,
    pub rule_name: String,
    pub project_id: String,
    pub project_name: String,
    pub trigger_type: String,
    pub trigger_id: Option<String>,
    pub status: String,
    pub message: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub sent_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AlertLogsAcrossProjectsResponse {
    pub data: Vec<AlertLogWithProjectInfo>,
}

/// GET /api/v1/alerts/across-projects
pub async fn list_alert_logs_across_projects(
    State(state): State<AppState>,
    auth: EitherAuth,
    Query(query): Query<AcrossProjectsAlertLogsQuery>,
) -> AppResult<Json<AlertLogsAcrossProjectsResponse>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("alert_logs_across", &auth),
        30,
    )?;

    // Get projects based on auth type
    let projects = match &*auth {
        AuthIdentity::User(user) => {
            ProjectRepository::find_by_owner(&state.db, &user.id, 100, 0).await?
        }
        AuthIdentity::Agent(agent) => {
            ProjectRepository::find_by_organization(&state.db, &agent.organization_id, 100, 0)
                .await?
        }
    };

    if projects.is_empty() {
        return Ok(Json(AlertLogsAcrossProjectsResponse { data: vec![] }));
    }

    let project_ids: Vec<String> = projects.iter().map(|p| p.id.clone()).collect();
    let project_map: std::collections::HashMap<String, &crate::db::models::Project> =
        projects.iter().map(|p| (p.id.clone(), p)).collect();

    let limit = query.limit.min(100) as i64;
    // B3: clamp offset to prevent absurdly large OFFSET values if used in future pagination
    let _offset = query.offset.unwrap_or(0).max(0).min(10_000_000i64);

    // Fetch alert logs across all projects
    let logs = AlertLogRepository::list_across_projects(&state.db, &project_ids, limit)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list alert logs: {}", e)))?;

    // Collect unique rule IDs and batch-fetch rule names
    let rule_ids: Vec<String> = logs
        .iter()
        .map(|l| l.alert_rule_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // Chunk into batches of 100 to avoid oversized IN (...) clauses on large rule sets.
    let mut rule_map = std::collections::HashMap::new();
    for chunk in rule_ids.chunks(100) {
        let batch = AlertLogRepository::list_rule_names_for_ids(&state.db, chunk)
            .await
            .unwrap_or_default();
        rule_map.extend(batch);
    }

    // Enrich each log with project and rule info
    let data: Vec<AlertLogWithProjectInfo> = logs
        .into_iter()
        .filter_map(|log| {
            let Some((rule_name, project_id)) = rule_map.get(&log.alert_rule_id) else {
                tracing::debug!(alert_rule_id = %log.alert_rule_id, "Skipping log for deleted/unknown rule");
                return None;
            };
            let Some(project) = project_map.get(project_id) else {
                return None;
            };
            Some(AlertLogWithProjectInfo {
                id: log.id,
                alert_rule_id: log.alert_rule_id,
                rule_name: rule_name.clone(),
                project_id: project_id.clone(),
                project_name: project.name.clone(),
                trigger_type: log.trigger_type,
                trigger_id: log.trigger_id,
                status: log.status,
                message: log.message,
                error_message: log.error_message,
                created_at: log.created_at.to_rfc3339(),
                sent_at: log.sent_at.map(|t| t.to_rfc3339()),
            })
        })
        .collect();

    Ok(Json(AlertLogsAcrossProjectsResponse { data }))
}

// ============ Alert Rule Mute/Unmute/Test ============

#[derive(Debug, Deserialize)]
pub struct MuteAlertRequest {
    pub duration_minutes: u32,
}

/// POST /api/v1/projects/:project_id/alerts/:alert_id/mute
pub async fn mute_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, alert_id)): Path<(String, String)>,
    Json(request): Json<MuteAlertRequest>,
) -> AppResult<Json<AlertRuleResponse>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("alerts_mute", &auth),
        20,
    )?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    if request.duration_minutes == 0 {
        return Err(AppError::BadRequest(
            "duration_minutes must be positive".to_string(),
        ));
    }
    if request.duration_minutes > 10_080 {
        return Err(AppError::BadRequest(
            "duration_minutes cannot exceed 10080 (7 days)".to_string(),
        ));
    }

    let muted_until =
        chrono::Utc::now() + chrono::Duration::minutes(request.duration_minutes as i64);

    let updated = AlertRuleRepository::mute(
        &state.db,
        &alert_id,
        muted_until,
        request.duration_minutes as i32,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to mute alert rule: {}", e)))?;

    let response = AlertRuleResponse::try_from(updated)
        .map_err(|e| AppError::Internal(format!("Failed to parse rule: {}", e)))?;

    Ok(Json(response))
}

/// POST /api/v1/projects/:project_id/alerts/:alert_id/unmute
pub async fn unmute_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, alert_id)): Path<(String, String)>,
) -> AppResult<Json<AlertRuleResponse>> {
    crate::api::enforce_rate_limit(
        &state,
        &crate::api::rate_limit_key_for_auth("alerts_unmute", &auth),
        20,
    )?;

    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let updated = AlertRuleRepository::unmute(&state.db, &alert_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to unmute alert rule: {}", e)))?;

    let response = AlertRuleResponse::try_from(updated)
        .map_err(|e| AppError::Internal(format!("Failed to parse rule: {}", e)))?;

    Ok(Json(response))
}

/// POST /api/v1/projects/:project_id/alerts/:alert_id/test
pub async fn test_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, alert_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // E1: rate limit test_alert_rule
    {
        let id = match &*auth {
            AuthIdentity::User(u) => u.id.clone(),
            AuthIdentity::Agent(a) => a.organization_id.clone(),
        };
        let rl = state
            .rate_limiter
            .check(&format!("test_alert:{}:{}", id, alert_id), 5);
        if !rl.allowed {
            return Err(AppError::BadRequest(
                "Too many requests. Please try again later.".to_string(),
            ));
        }
    }

    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel_ids: Vec<String> = serde_json::from_str(&rule.actions).map_err(|e| {
        tracing::error!(error = %e, "Failed to parse channel IDs from alert rule actions");
        AppError::Internal("Invalid configuration".to_string())
    })?;

    let notification_service = &state.notification_service;

    // Batch-fetch all channels to avoid N+1 queries
    let mut channels: std::collections::HashMap<String, NotificationChannel> =
        NotificationChannelRepository::find_by_ids(&state.db, &channel_ids)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to fetch channels: {}", e)))?
            .into_iter()
            .filter(|c| *c.is_active)
            .map(|c| (c.id.clone(), c))
            .collect();

    // Collect the ordered active channels into owned values so they can be
    // moved into spawned tasks (the HashMap cannot be shared across task boundaries).
    let active_channels: Vec<NotificationChannel> = channel_ids
        .iter()
        .filter_map(|id| channels.remove(id))
        .collect();

    // Fan out test sends concurrently — each channel is independent.
    type TestOutcome = Result<String, String>; // Ok(channel_name) | Err(error_msg)
    let mut join_set: tokio::task::JoinSet<TestOutcome> = tokio::task::JoinSet::new();

    for channel in active_channels {
        let svc = std::sync::Arc::clone(notification_service);
        join_set.spawn(async move {
            match svc.send_test(&channel).await {
                Ok(_) => Ok(channel.name),
                Err(e) => Err(format!("{}: {}", channel.name, e)),
            }
        });
    }

    let mut sent_count = 0usize;
    let mut errors: Vec<String> = Vec::new();

    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok(Ok(_channel_name)) => sent_count += 1,
            Ok(Err(msg)) => errors.push(msg),
            Err(e) => errors.push(format!("Task panicked: {}", e)),
        }
    }

    if !errors.is_empty() {
        Ok(Json(serde_json::json!({
            "message": format!("Test sent to {} channels, {} failed", sent_count, errors.len()),
            "errors": errors,
        })))
    } else {
        Ok(Json(serde_json::json!({
            "message": format!("Test notification sent to {} channels", sent_count),
        })))
    }
}

/// POST /api/v1/projects/:project_id/channels/:channel_id/test
pub async fn test_channel(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, channel_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    if !auth.has_permission("write") {
        return Err(AppError::Forbidden("write permission required".to_string()));
    }

    // E1: rate limit test_channel
    {
        let id = match &*auth {
            AuthIdentity::User(u) => u.id.clone(),
            AuthIdentity::Agent(a) => a.organization_id.clone(),
        };
        let rl = state
            .rate_limiter
            .check(&format!("test_channel:{}:{}", id, channel_id), 5);
        if !rl.allowed {
            return Err(AppError::BadRequest(
                "Too many requests. Please try again later.".to_string(),
            ));
        }
    }

    // Verify project access
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if !auth.can_access_project(&state.db, &project).await {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel = NotificationChannelRepository::find_by_id(&state.db, &channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".to_string()))?;

    if channel.project_id != project_id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    // Send test notification
    let notification_service = &state.notification_service;

    notification_service
        .send_test(&channel)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send test: {}", e)))?;

    Ok(Json(
        serde_json::json!({ "message": "Test notification sent" }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- is_valid_email ----

    #[test]
    fn valid_email_accepted() {
        assert!(is_valid_email("user@example.com"));
        assert!(is_valid_email("a+tag@sub.domain.org"));
    }

    #[test]
    fn email_missing_at_rejected() {
        assert!(!is_valid_email("userexample.com"));
    }

    #[test]
    fn email_missing_local_rejected() {
        assert!(!is_valid_email("@example.com"));
    }

    #[test]
    fn email_domain_no_dot_rejected() {
        assert!(!is_valid_email("user@localhost"));
    }

    #[test]
    fn email_domain_leading_dot_rejected() {
        assert!(!is_valid_email("user@.example.com"));
    }

    #[test]
    fn email_domain_trailing_dot_rejected() {
        assert!(!is_valid_email("user@example.com."));
    }

    // ---- validate_channel_url ----

    #[test]
    fn valid_https_url_accepted() {
        assert!(validate_channel_url("https://hooks.slack.com/services/T00/B00/xyz").is_ok());
    }

    #[test]
    fn valid_http_url_accepted() {
        assert!(validate_channel_url("http://webhook.example.com/hook").is_ok());
    }

    #[test]
    fn url_without_scheme_rejected() {
        let err = validate_channel_url("webhook.example.com/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn localhost_url_rejected() {
        let err = validate_channel_url("http://localhost/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn dot_local_url_rejected() {
        let err = validate_channel_url("https://myserver.local/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn dot_internal_url_rejected() {
        let err = validate_channel_url("https://svc.internal/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn loopback_ip_rejected() {
        let err = validate_channel_url("http://127.0.0.1/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn private_ip_rejected() {
        let err = validate_channel_url("http://192.168.1.1/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn ipv6_loopback_rejected() {
        let err = validate_channel_url("http://[::1]/hook").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn public_ip_accepted() {
        assert!(validate_channel_url("https://8.8.8.8/hook").is_ok());
    }

    // ── integration tests ─────────────────────────────────────────────────────

    use axum::{body::Body, http::Request, http::StatusCode};
    use serde_json::Value;
    use tower::ServiceExt;

    async fn make_app() -> axum::Router {
        let state = crate::db::test_helpers::test_app_state().await;
        axum::Router::new()
            .nest("/api/v1", crate::api::router())
            .with_state(state)
    }

    fn peer() -> std::net::SocketAddr {
        "127.0.0.1:1234".parse().unwrap()
    }

    async fn signup_and_token(app: &axum::Router, email: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(format!(
                r#"{{"email":"{}","password":"StrongPass1!"}}"#,
                email
            )))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        for v in resp.headers().get_all("set-cookie") {
            let s = v.to_str().unwrap_or("");
            if let Some(rest) = s.strip_prefix("access_token=") {
                return rest.split(';').next().unwrap_or("").to_string();
            }
        }
        panic!("no access_token in signup response");
    }

    async fn create_project_id(app: &axum::Router, token: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Alert Test Project"}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        json["data"]["id"].as_str().unwrap().to_string()
    }

    // ── auth guards ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_alert_rules_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/alerts")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn create_alert_rule_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/proj1/alerts")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"r","condition":{"type":"new_issue"},"channel_ids":[]}"#,
            ))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn list_channels_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/channels")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn create_channel_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/proj1/channels")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"c","channel_type":"email","config":{"type":"email","recipients":["a@b.com"]}}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn list_alert_logs_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/projects/proj1/alerts/logs")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn alert_logs_across_projects_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/alerts/across-projects")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── CRUD with auth ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_alert_rules_returns_empty_initially() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_list@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json, Value::Array(vec![]));
    }

    #[tokio::test]
    async fn create_alert_rule_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_create@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"My Rule","condition":{"type":"new_issue"},"channel_ids":[]}"#,
            ))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["name"], "My Rule");
        assert!(json["id"].as_str().is_some());
    }

    #[tokio::test]
    async fn list_channels_returns_empty_initially() {
        let app = make_app().await;
        let token = signup_and_token(&app, "chan_list@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/channels", pid))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json, Value::Array(vec![]));
    }

    #[tokio::test]
    async fn create_email_channel_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "chan_create@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/channels", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Email Chan","channel_type":"email","config":{"type":"email","recipients":["ops@example.com"]}}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["name"], "Email Chan");
        assert_eq!(json["channel_type"], "email");
    }

    #[tokio::test]
    async fn create_webhook_channel_with_private_url_rejected() {
        let app = make_app().await;
        let token = signup_and_token(&app, "chan_priv@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/channels", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Internal","channel_type":"webhook","config":{"type":"webhook","url":"http://192.168.1.1/hook"}}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn delete_alert_rule_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_del@example.com").await;
        let pid = create_project_id(&app, &token).await;

        // Create a rule first
        let create_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"To Delete","condition":{"type":"new_issue"},"channel_ids":[]}"#,
            ))
            .unwrap();
        let create_resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(create_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let rule_id = json["id"].as_str().unwrap().to_string();

        let del_req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/projects/{}/alerts/{}", pid, rule_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(del_req).await.unwrap().status(), StatusCode::OK);
    }

    // ── auth guards for update / delete ───────────────────────────────────────

    #[tokio::test]
    async fn update_alert_rule_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/v1/projects/p1/alerts/a1")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"X"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn delete_channel_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("DELETE")
            .uri("/api/v1/projects/p1/channels/c1")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn update_channel_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/v1/projects/p1/channels/c1")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"X"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn mute_alert_rule_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/p1/alerts/a1/mute")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"duration_minutes":60}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn unmute_alert_rule_without_auth_returns_401() {
        let app = make_app().await;
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/p1/alerts/a1/unmute")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    // ── update / delete rule happy paths ──────────────────────────────────────

    #[tokio::test]
    async fn update_alert_rule_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_upd@example.com").await;
        let pid = create_project_id(&app, &token).await;

        // Create a rule
        let create_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"Original","condition":{"type":"new_issue"},"channel_ids":[]}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let rule_id = json["id"].as_str().unwrap().to_string();

        // Update its name
        let upd_req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/projects/{}/alerts/{}", pid, rule_id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Updated"}"#))
            .unwrap();
        let resp = app.oneshot(upd_req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["name"], "Updated");
    }

    #[tokio::test]
    async fn update_alert_rule_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_upd404@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/projects/{}/alerts/nonexistent", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"X"}"#))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn delete_alert_rule_not_found_returns_404() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_del404@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/projects/{}/alerts/nonexistent", pid))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    // ── channel update / delete ───────────────────────────────────────────────

    #[tokio::test]
    async fn update_channel_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "chan_upd@example.com").await;
        let pid = create_project_id(&app, &token).await;

        // Create channel
        let create_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/channels", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Original","channel_type":"email","config":{"type":"email","recipients":["a@example.com"]}}"#))
            .unwrap();
        let resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let channel_id = json["id"].as_str().unwrap().to_string();

        // Update its name
        let upd_req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/projects/{}/channels/{}", pid, channel_id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Updated Channel"}"#))
            .unwrap();
        let resp = app.oneshot(upd_req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["name"], "Updated Channel");
    }

    #[tokio::test]
    async fn delete_channel_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "chan_del@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let create_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/channels", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"ToDelete","channel_type":"email","config":{"type":"email","recipients":["b@example.com"]}}"#))
            .unwrap();
        let resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let channel_id = json["id"].as_str().unwrap().to_string();

        let del_req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/projects/{}/channels/{}", pid, channel_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(del_req).await.unwrap().status(), StatusCode::OK);
    }

    // ── alert logs ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_alert_logs_returns_empty_array() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_logs@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/projects/{}/alerts/logs", pid))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json, Value::Array(vec![]));
    }

    #[tokio::test]
    async fn alert_logs_across_projects_returns_empty() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_logs_xp@example.com").await;
        let _ = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/alerts/across-projects")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"], Value::Array(vec![]));
    }

    // ── mute / unmute ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn mute_alert_rule_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_mute@example.com").await;
        let pid = create_project_id(&app, &token).await;

        // Create rule
        let create_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"Mutable","condition":{"type":"new_issue"},"channel_ids":[]}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let rule_id = json["id"].as_str().unwrap().to_string();

        // Mute it
        let mute_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts/{}/mute", pid, rule_id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"duration_minutes":60}"#))
            .unwrap();
        let resp = app.oneshot(mute_req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            json["muted_until"].as_str().is_some(),
            "muted_until should be set"
        );
    }

    #[tokio::test]
    async fn unmute_alert_rule_succeeds() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_unmute@example.com").await;
        let pid = create_project_id(&app, &token).await;

        // Create rule
        let create_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(
                r#"{"name":"Unmutable","condition":{"type":"new_issue"},"channel_ids":[]}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(create_req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        let rule_id = json["id"].as_str().unwrap().to_string();

        // Mute
        let mute_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts/{}/mute", pid, rule_id))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"duration_minutes":30}"#))
            .unwrap();
        app.clone().oneshot(mute_req).await.unwrap();

        // Unmute
        let unmute_req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/projects/{}/alerts/{}/unmute",
                pid, rule_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(unmute_req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            json["muted_until"].is_null(),
            "muted_until should be null after unmute"
        );
    }

    // ── validation ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn create_alert_rule_name_too_long_returns_400() {
        let app = make_app().await;
        let token = signup_and_token(&app, "alert_long_name@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let long_name = "x".repeat(201);
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/alerts", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(format!(
                r#"{{"name":"{}","condition":{{"type":"new_issue"}},"channel_ids":[]}}"#,
                long_name
            )))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn create_channel_invalid_email_rejected() {
        let app = make_app().await;
        let token = signup_and_token(&app, "chan_bademail@example.com").await;
        let pid = create_project_id(&app, &token).await;

        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/projects/{}/channels", pid))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"name":"Bad","channel_type":"email","config":{"type":"email","recipients":["not-an-email"]}}"#))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
