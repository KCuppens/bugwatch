use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    billing::{get_credit_package, StripeClient},
    db::{
        models::{Organization, OrganizationMember, UsageRecord},
        repositories::{
            CreditPurchaseRepository, OrganizationMemberRepository, OrganizationRepository,
            UsageRepository, UserRepository,
        },
        DbPool,
    },
    AppState,
};

// ============================================================================
// Response Types
// ============================================================================

#[derive(Serialize)]
pub struct OrganizationResponse {
    pub organization: Organization,
    pub members_count: i32,
    pub is_owner: bool,
}

#[derive(Serialize)]
pub struct SubscriptionResponse {
    pub tier: String,
    pub seats: i32,
    pub subscription_status: String,
    pub billing_interval: Option<String>,
    pub current_period_start: Option<String>,
    pub current_period_end: Option<String>,
    pub cancel_at_period_end: bool,
    pub has_stripe: bool,
}

#[derive(Serialize)]
pub struct CheckoutResponse {
    pub checkout_url: String,
}

#[derive(Serialize)]
pub struct PortalResponse {
    pub portal_url: String,
}

#[derive(Serialize)]
pub struct CreditsResponse {
    pub credits: i32,
}

#[derive(Serialize)]
pub struct CreditPurchaseResponse {
    pub checkout_url: String,
}

#[derive(Serialize)]
pub struct UsageResponse {
    pub usage: Vec<UsageRecord>,
    pub period_start: String,
    pub period_end: String,
}

#[derive(Serialize)]
pub struct MemberResponse {
    pub member: OrganizationMember,
    pub user_email: String,
    pub user_name: Option<String>,
}

// ============================================================================
// Request Types
// ============================================================================

#[derive(Deserialize)]
pub struct CreateOrganizationRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct UpdateOrganizationRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct InviteMemberRequest {
    pub email: String,
    pub role: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: String,
}

#[derive(Deserialize)]
pub struct CreateCheckoutRequest {
    pub tier: String,
    pub seats: Option<i32>,
    pub annual: Option<bool>,
    pub success_url: String,
    pub cancel_url: String,
}

#[derive(Deserialize)]
pub struct CreatePortalRequest {
    pub return_url: String,
}

#[derive(Deserialize)]
pub struct CancelSubscriptionRequest {
    pub immediately: Option<bool>,
}

#[derive(Deserialize)]
pub struct PurchaseCreditsRequest {
    pub credits: i32,
}

// ============================================================================
// Organization Endpoints
// ============================================================================

/// Get the current user's organization
pub async fn get_organization(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<OrganizationResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let members_count = OrganizationMemberRepository::count(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(OrganizationResponse {
        is_owner: org.owner_id == user.id,
        organization: org,
        members_count,
    }))
}

/// Create a new organization (only if user doesn't have one)
pub async fn create_organization(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateOrganizationRequest>,
) -> Result<Json<OrganizationResponse>, (StatusCode, String)> {
    // Check if user already has an organization
    let existing = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if existing.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "User already has an organization".to_string(),
        ));
    }

    // Generate slug from name (lowercase, hyphenated, with random suffix for uniqueness)
    let base_slug = req.name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let slug = format!("{}-{}", base_slug, &uuid::Uuid::new_v4().to_string()[..8]);

    let org = OrganizationRepository::create(&state.db, &user.id, &req.name, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(OrganizationResponse {
        is_owner: true,
        organization: org,
        members_count: 1,
    }))
}

/// Update organization name
pub async fn update_organization(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateOrganizationRequest>,
) -> Result<Json<OrganizationResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Only owner can update
    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can update organization".to_string()));
    }

    let updated = OrganizationRepository::update_name(&state.db, &org.id, &req.name)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let members_count = OrganizationMemberRepository::count(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(OrganizationResponse {
        is_owner: true,
        organization: updated,
        members_count,
    }))
}

// ============================================================================
// Member Endpoints
// ============================================================================

/// List organization members
pub async fn list_members(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<MemberResponse>>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let members = OrganizationMemberRepository::list(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch user info for each member
    let mut response = Vec::new();
    for member in members {
        if let Ok(Some(u)) = UserRepository::find_by_id(&state.db, &member.user_id).await {
            response.push(MemberResponse {
                member,
                user_email: u.email,
                user_name: u.name,
            });
        }
    }

    Ok(Json(response))
}

/// Add a member to the organization (by email)
pub async fn add_member(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<InviteMemberRequest>,
) -> Result<Json<MemberResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Only owner/admin can add members
    let user_member = OrganizationMemberRepository::list(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .into_iter()
        .find(|m| m.user_id == user.id);

    let can_manage = org.owner_id == user.id
        || user_member.map(|m| m.role == "admin").unwrap_or(false);

    if !can_manage {
        return Err((StatusCode::FORBIDDEN, "Only owner or admin can add members".to_string()));
    }

    // Check seat limit
    let current_count = OrganizationMemberRepository::count(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if current_count >= org.seats {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            "Seat limit reached. Please upgrade your subscription.".to_string(),
        ));
    }

    // Find user by email
    let target_user = UserRepository::find_by_email(&state.db, &req.email)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    // Check if already a member
    let is_member = OrganizationMemberRepository::is_member(&state.db, &org.id, &target_user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if is_member {
        return Err((StatusCode::CONFLICT, "User is already a member".to_string()));
    }

    let role = req.role.unwrap_or_else(|| "member".to_string());
    let member = OrganizationMemberRepository::add(&state.db, &org.id, &target_user.id, &role)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(MemberResponse {
        member,
        user_email: target_user.email,
        user_name: target_user.name,
    }))
}

/// Remove a member from the organization
pub async fn remove_member(
    user: AuthUser,
    State(state): State<AppState>,
    Path(member_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Cannot remove owner
    if member_user_id == org.owner_id {
        return Err((StatusCode::FORBIDDEN, "Cannot remove organization owner".to_string()));
    }

    // Only owner/admin can remove members
    let can_manage = org.owner_id == user.id
        || OrganizationMemberRepository::list(&state.db, &org.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .into_iter()
            .find(|m| m.user_id == user.id)
            .map(|m| m.role == "admin")
            .unwrap_or(false);

    if !can_manage {
        return Err((StatusCode::FORBIDDEN, "Only owner or admin can remove members".to_string()));
    }

    OrganizationMemberRepository::remove(&state.db, &org.id, &member_user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Update a member's role
pub async fn update_member_role(
    user: AuthUser,
    State(state): State<AppState>,
    Path(member_user_id): Path<String>,
    Json(req): Json<UpdateMemberRoleRequest>,
) -> Result<Json<MemberResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Only owner can change roles
    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can change member roles".to_string()));
    }

    // Cannot change owner's role
    if member_user_id == org.owner_id {
        return Err((StatusCode::FORBIDDEN, "Cannot change owner's role".to_string()));
    }

    OrganizationMemberRepository::update_role(&state.db, &org.id, &member_user_id, &req.role)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch the member after update
    let members = OrganizationMemberRepository::list(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let member = members
        .into_iter()
        .find(|m| m.user_id == member_user_id)
        .ok_or((StatusCode::NOT_FOUND, "Member not found".to_string()))?;

    let target_user = UserRepository::find_by_id(&state.db, &member_user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    Ok(Json(MemberResponse {
        member,
        user_email: target_user.email,
        user_name: target_user.name,
    }))
}

// ============================================================================
// Subscription Endpoints
// ============================================================================

/// Get current subscription details
pub async fn get_subscription(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<SubscriptionResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    Ok(Json(SubscriptionResponse {
        tier: org.tier,
        seats: org.seats,
        subscription_status: org.subscription_status,
        billing_interval: org.billing_interval,
        current_period_start: org.current_period_start,
        current_period_end: org.current_period_end,
        cancel_at_period_end: org.cancel_at_period_end,
        has_stripe: org.stripe_subscription_id.is_some(),
    }))
}

/// Create a Stripe checkout session for subscription
pub async fn create_checkout(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateCheckoutRequest>,
) -> Result<Json<CheckoutResponse>, (StatusCode, String)> {
    let stripe = state
        .stripe
        .as_ref()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Stripe not configured".to_string()))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Ensure organization has a Stripe customer
    let customer_id = match org.stripe_customer_id {
        Some(id) => id,
        None => {
            // Get user email
            let u = UserRepository::find_by_id(&state.db, &user.id)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

            let customer = stripe
                .create_customer(&org.id, &u.email, &org.name)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Save customer ID
            OrganizationRepository::set_stripe_customer(&state.db, &org.id, &customer.id.to_string())
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            customer.id.to_string()
        }
    };

    let seats = req.seats.unwrap_or(1).max(1) as i64;
    let annual = req.annual.unwrap_or(false);

    let session = stripe
        .create_checkout_session(&customer_id, &req.tier, seats, annual, &req.success_url, &req.cancel_url)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let url = session
        .url
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "No checkout URL".to_string()))?;

    Ok(Json(CheckoutResponse { checkout_url: url }))
}

/// Create a Stripe billing portal session
pub async fn create_portal(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreatePortalRequest>,
) -> Result<Json<PortalResponse>, (StatusCode, String)> {
    let stripe = state
        .stripe
        .as_ref()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Stripe not configured".to_string()))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let customer_id = org.stripe_customer_id.ok_or((
        StatusCode::BAD_REQUEST,
        "No Stripe customer. Please upgrade first.".to_string(),
    ))?;

    let session = stripe
        .create_billing_portal_session(&customer_id, &req.return_url)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(PortalResponse {
        portal_url: session.url,
    }))
}

/// Cancel subscription
pub async fn cancel_subscription(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CancelSubscriptionRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let stripe = state
        .stripe
        .as_ref()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Stripe not configured".to_string()))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Only owner can cancel
    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can cancel subscription".to_string()));
    }

    let subscription_id = org.stripe_subscription_id.ok_or((
        StatusCode::BAD_REQUEST,
        "No active subscription".to_string(),
    ))?;

    stripe
        .cancel_subscription(&subscription_id, req.immediately.unwrap_or(false))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Credits Endpoints
// ============================================================================

/// Get user's credit balance
pub async fn get_credits(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<CreditsResponse>, (StatusCode, String)> {
    let u = UserRepository::find_by_id(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    Ok(Json(CreditsResponse { credits: u.credits }))
}

/// Purchase credits
pub async fn purchase_credits(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<PurchaseCreditsRequest>,
) -> Result<Json<CreditPurchaseResponse>, (StatusCode, String)> {
    let stripe = state
        .stripe
        .as_ref()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Stripe not configured".to_string()))?;

    let package = get_credit_package(req.credits).ok_or((
        StatusCode::BAD_REQUEST,
        format!("Invalid credit package: {}", req.credits),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let customer_id = match org.stripe_customer_id {
        Some(id) => id,
        None => {
            let u = UserRepository::find_by_id(&state.db, &user.id)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

            let customer = stripe
                .create_customer(&org.id, &u.email, &org.name)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            OrganizationRepository::set_stripe_customer(&state.db, &org.id, &customer.id.to_string())
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            customer.id.to_string()
        }
    };

    // Create purchase record
    let purchase = CreditPurchaseRepository::create(
        &state.db,
        &user.id,
        package.credits,
        package.price_cents,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get the app URL for success/cancel redirects
    let app_url = state.config.app_url.clone();
    let success_url = format!("{}/dashboard/settings?tab=billing&success=true&purchase_id={}", app_url, purchase.id);
    let cancel_url = format!("{}/dashboard/settings?tab=billing&canceled=true", app_url);

    // Create checkout session
    let session = stripe
        .create_credit_checkout_session(&customer_id, package, &purchase.id, &success_url, &cancel_url)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Store checkout session ID
    CreditPurchaseRepository::set_payment_intent(&state.db, &purchase.id, &session.id.to_string())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let checkout_url = session.url.ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "No checkout URL".to_string(),
    ))?;

    Ok(Json(CreditPurchaseResponse { checkout_url }))
}

// ============================================================================
// Usage Endpoints
// ============================================================================

/// Get current billing period usage
pub async fn get_usage(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UsageResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Determine current period (from org or default to current month)
    let now = chrono::Utc::now();
    let (period_start, period_end) = match (&org.current_period_start, &org.current_period_end) {
        (Some(start), Some(end)) => (start.clone(), end.clone()),
        _ => {
            // Default to current calendar month
            let start = now.format("%Y-%m-01T00:00:00Z").to_string();
            let end = (now + chrono::Duration::days(30))
                .format("%Y-%m-%dT23:59:59Z")
                .to_string();
            (start, end)
        }
    };

    let usage = UsageRepository::list_current(&state.db, &org.id, &period_start)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(UsageResponse {
        usage,
        period_start,
        period_end,
    }))
}

// ============================================================================
// Plan Change (Upgrade/Downgrade) Endpoints
// ============================================================================

#[derive(Deserialize)]
pub struct ChangePlanRequest {
    pub tier: String,
    pub seats: Option<i32>,
    pub annual: Option<bool>,
}

#[derive(Serialize)]
pub struct ChangePlanResponse {
    pub success: bool,
    pub tier: String,
    pub seats: i32,
    pub message: String,
}

#[derive(Serialize)]
pub struct ProrationPreviewResponse {
    pub current_amount_cents: i64,
    pub new_amount_cents: i64,
    pub proration_amount_cents: i64,
    pub immediate_charge: bool,
}

/// Change subscription plan (upgrade or downgrade)
pub async fn change_plan(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ChangePlanRequest>,
) -> Result<Json<ChangePlanResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    // Check if user is owner
    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can change plan".to_string()));
    }

    // Need an active subscription
    let subscription_id = org.stripe_subscription_id.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "No active subscription to modify".to_string(),
    ))?;

    let seats = req.seats.unwrap_or(org.seats) as i64;
    let annual = req.annual.unwrap_or(org.billing_interval.as_deref() == Some("annual"));

    // Update subscription in Stripe
    let subscription = stripe
        .update_subscription_tier(subscription_id, &req.tier, annual, seats)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update local database
    OrganizationRepository::update_subscription(
        &state.db,
        &org.id,
        &req.tier,
        seats as i32,
        Some(&subscription.id.to_string()),
        "active",
        Some(if annual { "annual" } else { "monthly" }),
        Some(&subscription.current_period_start.to_string()),
        Some(&subscription.current_period_end.to_string()),
        subscription.cancel_at_period_end,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ChangePlanResponse {
        success: true,
        tier: req.tier,
        seats: seats as i32,
        message: "Plan updated successfully".to_string(),
    }))
}

/// Preview proration for plan change
pub async fn preview_plan_change(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ChangePlanRequest>,
) -> Result<Json<ProrationPreviewResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let subscription_id = org.stripe_subscription_id.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "No active subscription".to_string(),
    ))?;

    let seats = req.seats.unwrap_or(org.seats) as i64;
    let annual = req.annual.unwrap_or(false);

    let preview = stripe
        .preview_proration(subscription_id, &req.tier, annual, seats)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ProrationPreviewResponse {
        current_amount_cents: preview.current_amount_cents,
        new_amount_cents: preview.new_amount_cents,
        proration_amount_cents: preview.proration_amount_cents,
        immediate_charge: preview.immediate_charge,
    }))
}

/// Update seat count
#[derive(Deserialize)]
pub struct UpdateSeatsRequest {
    pub seats: i32,
}

pub async fn update_seats(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateSeatsRequest>,
) -> Result<Json<ChangePlanResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can update seats".to_string()));
    }

    let subscription_id = org.stripe_subscription_id.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "No active subscription".to_string(),
    ))?;

    // Update in Stripe
    stripe
        .update_subscription_seats(subscription_id, req.seats as i64)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update local database
    OrganizationRepository::update_seats(&state.db, &org.id, req.seats)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ChangePlanResponse {
        success: true,
        tier: org.tier,
        seats: req.seats,
        message: "Seats updated successfully".to_string(),
    }))
}

// ============================================================================
// Invoice Endpoints
// ============================================================================

use crate::billing::stripe::{InvoiceSummary, InvoiceDetail};

#[derive(Serialize)]
pub struct InvoicesResponse {
    pub invoices: Vec<InvoiceSummary>,
}

/// List all invoices
pub async fn list_invoices(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<InvoicesResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let customer_id = org.stripe_customer_id.as_ref().ok_or((
        StatusCode::NOT_FOUND,
        "No billing history".to_string(),
    ))?;

    let invoices = stripe
        .list_invoices(customer_id, Some(100))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(InvoicesResponse { invoices }))
}

/// Get single invoice details
pub async fn get_invoice(
    user: AuthUser,
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceDetail>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    // Verify user has an org (access control)
    let _org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let invoice = stripe
        .get_invoice(&invoice_id)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    Ok(Json(invoice))
}

// ============================================================================
// Payment Method Endpoints
// ============================================================================

use crate::billing::stripe::PaymentMethodSummary;

#[derive(Serialize)]
pub struct PaymentMethodsResponse {
    pub payment_methods: Vec<PaymentMethodSummary>,
    pub default_payment_method: Option<String>,
}

#[derive(Serialize)]
pub struct SetupIntentResponse {
    pub client_secret: String,
}

#[derive(Deserialize)]
pub struct SetDefaultPaymentMethodRequest {
    pub payment_method_id: String,
}

/// List payment methods
pub async fn list_payment_methods(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<PaymentMethodsResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let customer_id = org.stripe_customer_id.as_ref().ok_or((
        StatusCode::NOT_FOUND,
        "No payment methods".to_string(),
    ))?;

    let methods = stripe
        .list_payment_methods(customer_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get default payment method from customer
    let customer = stripe
        .get_customer(customer_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let default_pm = customer.invoice_settings
        .and_then(|s| s.default_payment_method)
        .map(|pm| pm.id().to_string());

    Ok(Json(PaymentMethodsResponse {
        payment_methods: methods,
        default_payment_method: default_pm,
    }))
}

/// Create setup intent for adding new payment method
pub async fn create_setup_intent(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<SetupIntentResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let customer_id = org.stripe_customer_id.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "No Stripe customer".to_string(),
    ))?;

    let intent = stripe
        .create_setup_intent(customer_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let client_secret = intent.client_secret.ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "No client secret".to_string(),
    ))?;

    Ok(Json(SetupIntentResponse { client_secret }))
}

/// Set default payment method
pub async fn set_default_payment_method(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<SetDefaultPaymentMethodRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can update payment methods".to_string()));
    }

    let customer_id = org.stripe_customer_id.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "No Stripe customer".to_string(),
    ))?;

    stripe
        .set_default_payment_method(customer_id, &req.payment_method_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// Delete payment method
pub async fn delete_payment_method(
    user: AuthUser,
    State(state): State<AppState>,
    Path(payment_method_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can delete payment methods".to_string()));
    }

    stripe
        .detach_payment_method(&payment_method_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

// ============================================================================
// Coupon Validation Endpoints
// ============================================================================

use crate::billing::stripe::CouponInfo;

#[derive(Deserialize)]
pub struct ValidateCouponRequest {
    pub code: String,
}

/// Validate a coupon code
pub async fn validate_coupon(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ValidateCouponRequest>,
) -> Result<Json<CouponInfo>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    // Verify user exists (basic auth check)
    let _org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let coupon = stripe
        .validate_coupon(&req.code)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if !coupon.valid {
        return Err((StatusCode::BAD_REQUEST, "Coupon is not valid".to_string()));
    }

    Ok(Json(coupon))
}

// ============================================================================
// Tax ID Endpoints
// ============================================================================

use crate::billing::stripe::TaxIdInfo;

#[derive(Serialize)]
pub struct TaxIdsResponse {
    pub tax_ids: Vec<TaxIdInfo>,
}

#[derive(Deserialize)]
pub struct AddTaxIdRequest {
    #[serde(rename = "type")]
    pub type_: String,
    pub value: String,
}

/// Get tax IDs
pub async fn get_tax_ids(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<TaxIdsResponse>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let customer_id = org.stripe_customer_id.as_ref().ok_or((
        StatusCode::NOT_FOUND,
        "No billing setup".to_string(),
    ))?;

    let tax_ids = stripe
        .list_tax_ids(customer_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(TaxIdsResponse { tax_ids }))
}

/// Add tax ID
pub async fn add_tax_id(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<AddTaxIdRequest>,
) -> Result<Json<TaxIdInfo>, (StatusCode, String)> {
    let stripe = state.stripe.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Stripe not configured".to_string(),
    ))?;

    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    if org.owner_id != user.id {
        return Err((StatusCode::FORBIDDEN, "Only owner can add tax ID".to_string()));
    }

    let customer_id = org.stripe_customer_id.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "No Stripe customer".to_string(),
    ))?;

    let tax_id = stripe
        .add_tax_id(customer_id, &req.type_, &req.value)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // Also store in local database
    OrganizationRepository::update_tax_info(&state.db, &org.id, Some(&req.value), None, None)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(TaxIdInfo {
        id: tax_id.id.to_string(),
        type_: format!("{:?}", tax_id.type_),
        value: tax_id.value.unwrap_or_default(),
        verification_status: tax_id.verification.as_ref().map(|v| format!("{:?}", v.status)),
        country: tax_id.country,
    }))
}

// ============================================================================
// Billing Dashboard Endpoints
// ============================================================================

#[derive(Serialize)]
pub struct BillingDashboardResponse {
    pub current_tier: String,
    pub monthly_cost_cents: i64,
    pub seats_used: i32,
    pub seats_total: i32,
    pub billing_period_start: Option<String>,
    pub billing_period_end: Option<String>,
    pub is_past_due: bool,
    pub cancel_at_period_end: bool,
}

/// Get billing dashboard summary
pub async fn get_billing_dashboard(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<BillingDashboardResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let members_count = OrganizationMemberRepository::count(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Calculate monthly cost based on tier and seats
    let monthly_cost_cents = match org.tier.as_str() {
        "pro" => 1200 * org.seats as i64,
        "team" => 2500 * org.seats as i64,
        _ => 0,
    };

    Ok(Json(BillingDashboardResponse {
        current_tier: org.tier,
        monthly_cost_cents,
        seats_used: members_count,
        seats_total: org.seats,
        billing_period_start: org.current_period_start,
        billing_period_end: org.current_period_end,
        is_past_due: org.subscription_status == "past_due",
        cancel_at_period_end: org.cancel_at_period_end,
    }))
}

#[derive(Serialize)]
pub struct UsageHistoryResponse {
    pub history: Vec<UsageRecord>,
}

/// Get usage history (multiple periods)
pub async fn get_usage_history(
    user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UsageHistoryResponse>, (StatusCode, String)> {
    let org = OrganizationRepository::find_by_user(&state.db, &user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

    let history = UsageRepository::list_all(&state.db, &org.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(UsageHistoryResponse { history }))
}

// ============================================================================
// Helper to add stripe client to AppState
// ============================================================================

pub fn create_stripe_client(config: &crate::config::Config) -> Option<StripeClient> {
    StripeClient::new(config).ok().flatten()
}
