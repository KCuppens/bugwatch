use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    db::{
        models::{AlertRule, NotificationChannel, AlertLog},
        repositories::{AlertRuleRepository, NotificationChannelRepository, AlertLogRepository, ProjectRepository},
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AlertCondition {
    #[serde(rename = "new_issue")]
    NewIssue {
        #[serde(default)]
        level: Option<String>, // 'error', 'warning', 'fatal'
    },
    #[serde(rename = "issue_frequency")]
    IssueFrequency {
        threshold: u32,
        window_minutes: u32,
    },
    #[serde(rename = "monitor_down")]
    MonitorDown {
        #[serde(default)]
        monitor_id: Option<String>, // None = all monitors
    },
    #[serde(rename = "monitor_recovery")]
    MonitorRecovery {
        #[serde(default)]
        monitor_id: Option<String>,
    },
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
        })
    }
}

/// POST /api/v1/projects/:project_id/alerts
pub async fn create_alert_rule(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(request): Json<CreateAlertRuleRequest>,
) -> AppResult<Json<AlertRuleResponse>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
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
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<AlertRuleResponse>>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rules = AlertRuleRepository::list_by_project(&state.db, &project_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list alert rules: {}", e)))?;

    let responses: Result<Vec<AlertRuleResponse>, _> = rules
        .into_iter()
        .map(AlertRuleResponse::try_from)
        .collect();

    let responses = responses
        .map_err(|e| AppError::Internal(format!("Failed to parse rules: {}", e)))?;

    Ok(Json(responses))
}

/// PATCH /api/v1/projects/:project_id/alerts/:alert_id
pub async fn update_alert_rule(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, alert_id)): Path<(String, String)>,
    Json(request): Json<UpdateAlertRuleRequest>,
) -> AppResult<Json<AlertRuleResponse>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::NotFound("Alert rule not found".to_string()));
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
    auth_user: AuthUser,
    Path((project_id, alert_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let rule = AlertRuleRepository::find_by_id(&state.db, &alert_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Alert rule not found".to_string()))?;

    if rule.project_id != project_id {
        return Err(AppError::NotFound("Alert rule not found".to_string()));
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
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChannelConfig {
    Email { recipients: Vec<String> },
    Webhook { url: String, secret: Option<String> },
    Slack { webhook_url: String, channel: Option<String> },
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
        let config: serde_json::Value = serde_json::from_str(&channel.config)
            .unwrap_or(serde_json::Value::Null);

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
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Json(request): Json<CreateChannelRequest>,
) -> AppResult<Json<ChannelResponse>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel_type = match request.channel_type {
        ChannelType::Email => "email",
        ChannelType::Webhook => "webhook",
        ChannelType::Slack => "slack",
    };

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
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<ChannelResponse>>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
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
    auth_user: AuthUser,
    Path((project_id, channel_id)): Path<(String, String)>,
    Json(request): Json<UpdateChannelRequest>,
) -> AppResult<Json<ChannelResponse>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel = NotificationChannelRepository::find_by_id(&state.db, &channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".to_string()))?;

    if channel.project_id != project_id {
        return Err(AppError::NotFound("Channel not found".to_string()));
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
    auth_user: AuthUser,
    Path((project_id, channel_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel = NotificationChannelRepository::find_by_id(&state.db, &channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".to_string()))?;

    if channel.project_id != project_id {
        return Err(AppError::NotFound("Channel not found".to_string()));
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
    auth_user: AuthUser,
    Path(project_id): Path<String>,
    Query(query): Query<AlertLogsQuery>,
) -> AppResult<Json<Vec<AlertLog>>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let logs = AlertLogRepository::list_by_project(&state.db, &project_id, query.limit.min(100))
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list logs: {}", e)))?;

    Ok(Json(logs))
}

/// POST /api/v1/projects/:project_id/channels/:channel_id/test
pub async fn test_channel(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((project_id, channel_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify project ownership
    let project = ProjectRepository::find_by_id(&state.db, &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.owner_id != auth_user.id {
        return Err(AppError::Forbidden("Access denied".to_string()));
    }

    let channel = NotificationChannelRepository::find_by_id(&state.db, &channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".to_string()))?;

    if channel.project_id != project_id {
        return Err(AppError::NotFound("Channel not found".to_string()));
    }

    // Send test notification
    let notification_service = crate::services::notifications::NotificationService::new().await;

    notification_service
        .send_test(&channel)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send test: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Test notification sent" })))
}
