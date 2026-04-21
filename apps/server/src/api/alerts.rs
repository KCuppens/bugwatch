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
            is_active: rule.is_active,
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

    let condition_json = serde_json::to_string(&request.condition)
        .map_err(|e| AppError::BadRequest(format!("Invalid condition: {}", e)))?;
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
            for key in &["api_key", "routing_key", "secret", "webhook_url"] {
                if obj.contains_key(*key) {
                    obj.insert(
                        (*key).to_string(),
                        serde_json::Value::String("***".to_string()),
                    );
                }
            }
        }

        Self {
            id: channel.id,
            project_id: channel.project_id,
            name: channel.name,
            channel_type: channel.channel_type,
            config,
            is_active: channel.is_active,
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
    pub duration_minutes: i32,
}

/// POST /api/v1/projects/:project_id/alerts/:alert_id/mute
pub async fn mute_alert_rule(
    State(state): State<AppState>,
    auth: EitherAuth,
    Path((project_id, alert_id)): Path<(String, String)>,
    Json(request): Json<MuteAlertRequest>,
) -> AppResult<Json<AlertRuleResponse>> {
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

    if request.duration_minutes <= 0 {
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

    let updated =
        AlertRuleRepository::mute(&state.db, &alert_id, muted_until, request.duration_minutes)
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
    let channels: std::collections::HashMap<String, _> =
        NotificationChannelRepository::find_by_ids(&state.db, &channel_ids)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to fetch channels: {}", e)))?
            .into_iter()
            .filter(|c| c.is_active)
            .map(|c| (c.id.clone(), c))
            .collect();

    let mut sent_count = 0;
    let mut errors = Vec::new();

    for channel_id in &channel_ids {
        let Some(channel) = channels.get(channel_id) else {
            continue;
        };
        match notification_service.send_test(channel).await {
            Ok(_) => sent_count += 1,
            Err(e) => errors.push(format!("{}: {}", channel.name, e)),
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
