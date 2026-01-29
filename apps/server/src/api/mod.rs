use axum::{routing::get, routing::post, routing::patch, routing::delete, Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;

pub mod ai_fixes;
pub mod alerts;
pub mod auth;
pub mod billing;
pub mod comments;
pub mod events;
pub mod issues;
pub mod monitors;
pub mod projects;
pub mod webhooks;

pub fn router() -> Router<AppState> {
    Router::new()
        // Auth routes
        .route("/auth/signup", post(auth::signup))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/me", get(auth::me))
        // Event ingestion
        .route("/events", post(events::ingest))
        // Projects
        .route("/projects", get(projects::list).post(projects::create))
        .route(
            "/projects/:id",
            get(projects::get)
                .patch(projects::update)
                .delete(projects::delete),
        )
        .route("/projects/:id/keys", post(projects::rotate_key))
        .route(
            "/projects/:id/onboarding/complete",
            post(projects::complete_onboarding),
        )
        .route("/projects/:id/verify", get(projects::verify_events))
        // Issues - specific routes MUST come before parameterized :issue_id route
        .route("/projects/:project_id/issues", get(issues::list))
        .route("/projects/:project_id/issues/_search", post(issues::search))
        // Nested issue routes with :issue_id
        .route(
            "/projects/:project_id/issues/:issue_id/events/:event_id",
            get(issues::get_event),
        )
        .route(
            "/projects/:project_id/issues/:issue_id/frequency",
            get(issues::get_frequency),
        )
        .route(
            "/projects/:project_id/issues/:issue_id/impact",
            get(issues::get_impact),
        )
        // Generic :issue_id route LAST (catches "search" if above doesn't match)
        .route(
            "/projects/:project_id/issues/:issue_id",
            get(issues::get)
                .patch(issues::update)
                .delete(issues::delete),
        )
        // Issue Comments
        .route(
            "/projects/:project_id/issues/:issue_id/comments",
            get(comments::list).post(comments::create),
        )
        .route(
            "/projects/:project_id/issues/:issue_id/comments/:comment_id",
            patch(comments::update).delete(comments::delete),
        )
        // AI Fix generation
        .route(
            "/projects/:project_id/issues/:issue_id/ai-fix",
            post(ai_fixes::generate_fix),
        )
        .route("/ai/generate-fix", post(ai_fixes::generate_fix_standalone))
        // Monitors
        .route(
            "/projects/:project_id/monitors",
            get(monitors::list).post(monitors::create),
        )
        .route(
            "/projects/:project_id/monitors/:monitor_id",
            get(monitors::get)
                .patch(monitors::update)
                .delete(monitors::delete),
        )
        .route(
            "/projects/:project_id/monitors/:monitor_id/checks",
            get(monitors::list_checks),
        )
        // Alerts
        .route(
            "/projects/:project_id/alerts",
            get(alerts::list_alert_rules).post(alerts::create_alert_rule),
        )
        .route(
            "/projects/:project_id/alerts/logs",
            get(alerts::list_alert_logs),
        )
        .route(
            "/projects/:project_id/alerts/:alert_id",
            patch(alerts::update_alert_rule).delete(alerts::delete_alert_rule),
        )
        // Notification Channels
        .route(
            "/projects/:project_id/channels",
            get(alerts::list_channels).post(alerts::create_channel),
        )
        .route(
            "/projects/:project_id/channels/:channel_id",
            patch(alerts::update_channel).delete(alerts::delete_channel),
        )
        .route(
            "/projects/:project_id/channels/:channel_id/test",
            post(alerts::test_channel),
        )
        // Organization routes
        .route(
            "/organization",
            get(billing::get_organization)
                .post(billing::create_organization)
                .patch(billing::update_organization),
        )
        // Organization members
        .route(
            "/organization/members",
            get(billing::list_members).post(billing::add_member),
        )
        .route(
            "/organization/members/:member_user_id",
            patch(billing::update_member_role).delete(billing::remove_member),
        )
        // Subscription
        .route("/billing/subscription", get(billing::get_subscription))
        .route("/billing/checkout", post(billing::create_checkout))
        .route("/billing/verify-checkout", post(billing::verify_checkout))
        .route("/billing/portal", post(billing::create_portal))
        .route("/billing/cancel", post(billing::cancel_subscription))
        // Plan changes
        .route("/billing/change-plan", post(billing::change_plan))
        .route("/billing/preview-change", post(billing::preview_plan_change))
        .route("/billing/seats", post(billing::update_seats))
        // Invoices
        .route("/billing/invoices", get(billing::list_invoices))
        .route("/billing/invoices/:invoice_id", get(billing::get_invoice))
        // Payment methods
        .route("/billing/payment-methods", get(billing::list_payment_methods))
        .route("/billing/setup-intent", post(billing::create_setup_intent))
        .route(
            "/billing/payment-methods/default",
            post(billing::set_default_payment_method),
        )
        .route(
            "/billing/payment-methods/:payment_method_id",
            delete(billing::delete_payment_method),
        )
        // Coupons
        .route("/billing/validate-coupon", post(billing::validate_coupon))
        // Tax IDs
        .route(
            "/billing/tax-ids",
            get(billing::get_tax_ids).post(billing::add_tax_id),
        )
        // Dashboard & usage history
        .route("/billing/dashboard", get(billing::get_billing_dashboard))
        .route("/billing/usage/history", get(billing::get_usage_history))
        // Credits
        .route(
            "/billing/credits",
            get(billing::get_credits).post(billing::purchase_credits),
        )
        // Usage
        .route("/billing/usage", get(billing::get_usage))
        // Webhooks (no auth required)
        .route("/webhooks/stripe", post(webhooks::stripe_webhook))
}

/// Standard API success response
#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub data: T,
}

impl<T> ApiResponse<T> {
    pub fn new(data: T) -> Json<Self> {
        Json(Self { data })
    }
}

/// Pagination parameters
#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

fn default_page() -> u32 {
    1
}

fn default_per_page() -> u32 {
    20
}

/// Paginated response wrapper
#[derive(Serialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub pagination: PaginationMeta,
}

#[derive(Debug, Serialize)]
pub struct PaginationMeta {
    pub page: u32,
    pub per_page: u32,
    pub total: u32,
    pub total_pages: u32,
}
