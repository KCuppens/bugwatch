use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
#[cfg(feature = "saas")]
use stripe;

#[cfg(feature = "saas")]
use crate::billing::StripeClient;
#[cfg(feature = "saas")]
use crate::db::models::UsageRecord;
#[cfg(feature = "saas")]
use crate::db::repositories::UsageRepository;
use crate::{
    auth::AuthUser,
    db::{
        models::{Organization, OrganizationMember},
        repositories::{OrganizationMemberRepository, OrganizationRepository, UserRepository},
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

#[cfg(feature = "saas")]
#[derive(Serialize)]
pub struct SubscriptionResponse {
    pub tier: String,
    pub seats: i32,
    pub subscription_status: String,
    pub billing_interval: Option<String>,
    pub current_period_start: Option<chrono::DateTime<chrono::Utc>>,
    pub current_period_end: Option<chrono::DateTime<chrono::Utc>>,
    pub cancel_at_period_end: bool,
    pub has_stripe: bool,
}

#[cfg(feature = "saas")]
#[derive(Serialize)]
pub struct CheckoutResponse {
    pub checkout_url: String,
}

#[cfg(feature = "saas")]
#[derive(Serialize)]
pub struct PortalResponse {
    pub portal_url: String,
}

#[cfg(feature = "saas")]
#[derive(Serialize)]
pub struct UsageResponse {
    pub usage: Vec<UsageRecord>,
    pub period_start: chrono::DateTime<chrono::Utc>,
    pub period_end: chrono::DateTime<chrono::Utc>,
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

#[cfg(feature = "saas")]
#[derive(Deserialize)]
pub struct CreateCheckoutRequest {
    pub tier: String,
    pub seats: Option<i32>,
    pub annual: Option<bool>,
    pub success_url: String,
    pub cancel_url: String,
}

#[cfg(feature = "saas")]
#[derive(Deserialize)]
pub struct CreatePortalRequest {
    pub return_url: String,
}

#[cfg(feature = "saas")]
#[derive(Deserialize)]
pub struct CancelSubscriptionRequest {
    pub immediately: Option<bool>,
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

fn generate_org_slug(name: &str) -> String {
    let base = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>();
    format!("{}-{}", base, &uuid::Uuid::new_v4().to_string()[..8])
}

/// Create a new organization (only if user doesn't have one)
pub async fn create_organization(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateOrganizationRequest>,
) -> Result<Json<OrganizationResponse>, (StatusCode, String)> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 255 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Organization name must be 1–255 characters".to_string(),
        ));
    }

    let slug = generate_org_slug(&name);

    // Atomic create: INSERT WHERE NOT EXISTS prevents TOCTOU if two requests race
    let org = OrganizationRepository::create_if_owner_not_exists(&state.db, &user.id, &name, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            StatusCode::CONFLICT,
            "User already has an organization".to_string(),
        ))?;

    tracing::info!(org_id = %org.id, owner_id = %user.id, org_name = %name, "Organization created");

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
        return Err((
            StatusCode::FORBIDDEN,
            "Only owner can update organization".to_string(),
        ));
    }

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 255 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Organization name must be 1–255 characters".to_string(),
        ));
    }

    let updated = OrganizationRepository::update_name(&state.db, &org.id, &name)
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

    let user_ids: Vec<String> = members.iter().map(|m| m.user_id.clone()).collect();
    let users = UserRepository::find_by_ids(&state.db, &user_ids)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_map: std::collections::HashMap<&str, &crate::db::models::User> =
        users.iter().map(|u| (u.id.as_str(), u)).collect();

    let mut response = Vec::new();
    for member in &members {
        match user_map.get(member.user_id.as_str()) {
            Some(u) => response.push(MemberResponse {
                member: member.clone(),
                user_email: u.email.clone(),
                user_name: u.name.clone(),
            }),
            None => tracing::warn!(
                user_id = %member.user_id,
                "Member has no matching user record — orphaned membership"
            ),
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
    let user_member =
        OrganizationMemberRepository::find_by_user_in_org(&state.db, &org.id, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let can_manage =
        org.owner_id == user.id || user_member.map(|m| m.role == "admin").unwrap_or(false);

    if !can_manage {
        return Err((
            StatusCode::FORBIDDEN,
            "Only owner or admin can add members".to_string(),
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
    if !matches!(role.as_str(), "member" | "admin") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid role. Must be 'member' or 'admin'.".to_string(),
        ));
    }

    // Atomically insert only if the seat limit has not been reached — prevents TOCTOU
    // where two concurrent add_member calls both pass a separate count check.
    let member = OrganizationMemberRepository::add_if_seat_available(
        &state.db,
        &org.id,
        &target_user.id,
        &role,
        org.seats,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((
        StatusCode::PAYMENT_REQUIRED,
        "Seat limit reached. Please upgrade your subscription.".to_string(),
    ))?;

    tracing::info!(
        org_id = %org.id,
        inviter_id = %user.id,
        new_member_id = %target_user.id,
        role = %role,
        "Member added to organization"
    );

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
        return Err((
            StatusCode::FORBIDDEN,
            "Cannot remove organization owner".to_string(),
        ));
    }

    // Only owner/admin can remove members
    let caller_member =
        OrganizationMemberRepository::find_by_user_in_org(&state.db, &org.id, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let can_manage =
        org.owner_id == user.id || caller_member.map(|m| m.role == "admin").unwrap_or(false);

    if !can_manage {
        return Err((
            StatusCode::FORBIDDEN,
            "Only owner or admin can remove members".to_string(),
        ));
    }

    OrganizationMemberRepository::remove(&state.db, &org.id, &member_user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(
        org_id = %org.id,
        removed_by = %user.id,
        removed_user_id = %member_user_id,
        "Member removed from organization"
    );

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
        return Err((
            StatusCode::FORBIDDEN,
            "Only owner can change member roles".to_string(),
        ));
    }

    // Cannot change owner's role
    if member_user_id == org.owner_id {
        return Err((
            StatusCode::FORBIDDEN,
            "Cannot change owner's role".to_string(),
        ));
    }

    if !matches!(req.role.as_str(), "member" | "admin") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid role. Must be 'member' or 'admin'.".to_string(),
        ));
    }

    OrganizationMemberRepository::update_role(&state.db, &org.id, &member_user_id, &req.role)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch the updated member row via point-lookup (avoids full list scan)
    let member =
        OrganizationMemberRepository::find_by_user_in_org(&state.db, &org.id, &member_user_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "Member not found".to_string()))?;

    let target_user = UserRepository::find_by_id(&state.db, &member_user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    tracing::info!(
        org_id = %org.id,
        changed_by = %user.id,
        target_user_id = %member_user_id,
        new_role = %req.role,
        "Member role updated"
    );

    Ok(Json(MemberResponse {
        member,
        user_email: target_user.email,
        user_name: target_user.name,
    }))
}

// ============================================================================
// Subscription & Billing Endpoints (SaaS only)
// ============================================================================
#[cfg(feature = "saas")]
mod saas_billing {
    use super::*;

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
        if !matches!(req.tier.as_str(), "pro" | "team") {
            return Err((
                StatusCode::BAD_REQUEST,
                "Invalid tier. Must be 'pro' or 'team'.".to_string(),
            ));
        }

        let stripe = state.stripe.as_ref().ok_or((
            StatusCode::SERVICE_UNAVAILABLE,
            "Stripe not configured".to_string(),
        ))?;

        // Find or create organization for the user
        let org = match OrganizationRepository::find_by_user(&state.db, &user.id).await {
            Ok(Some(org)) => org,
            Ok(None) => {
                // Auto-create organization for user
                let u = UserRepository::find_by_id(&state.db, &user.id)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                    .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

                let org_name = u
                    .name
                    .clone()
                    .unwrap_or_else(|| u.email.split('@').next().unwrap_or("My").to_string());
                let display_name = format!("{}'s Organization", org_name);
                let slug = generate_org_slug(&org_name);

                // Atomic create: prevents duplicate orgs from concurrent checkout requests
                let new_org = OrganizationRepository::create_if_owner_not_exists(
                    &state.db,
                    &user.id,
                    &display_name,
                    &slug,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| {
                    // Race: another concurrent request already created the org; re-fetch it
                    // The outer match will hit Ok(Some(org)) on retry; return a retriable error.
                    (
                        StatusCode::CONFLICT,
                        "Organization already exists".to_string(),
                    )
                })?;

                OrganizationMemberRepository::add(&state.db, &new_org.id, &user.id, "owner")
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

                new_org
            }
            Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        };

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

                // Save customer ID — if this DB write fails the Stripe customer is orphaned;
                // log the ID prominently so it can be manually reconciled.
                OrganizationRepository::set_stripe_customer(
                    &state.db,
                    &org.id,
                    &customer.id.to_string(),
                )
                .await
                .map_err(|e| {
                    tracing::error!(
                        org_id = %org.id,
                        stripe_customer_id = %customer.id,
                        "CRITICAL: Stripe customer created but DB persist failed — orphaned customer: {}",
                        e
                    );
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save billing information".to_string())
                })?;

                customer.id.to_string()
            }
        };

        let seats = req.seats.unwrap_or(1).max(1) as i64;
        let annual = req.annual.unwrap_or(false);

        // Validate redirect URLs — require exact origin prefix with trailing slash to prevent
        // subdomain spoofing (e.g. app.example.com.evil.com passing a bare starts_with check).
        let allowed_origin = format!("{}/", state.config.app_url.trim_end_matches('/'));
        if !req.success_url.starts_with(&allowed_origin)
            || !req.cancel_url.starts_with(&allowed_origin)
        {
            return Err((StatusCode::BAD_REQUEST, "Invalid redirect URL".to_string()));
        }

        let session = stripe
            .create_checkout_session(
                &customer_id,
                &req.tier,
                seats,
                annual,
                &req.success_url,
                &req.cancel_url,
            )
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, tier = %req.tier, "Stripe checkout session creation failed: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create checkout session. Please try again.".to_string())
            })?;

        let url = session.url.ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "No checkout URL".to_string(),
        ))?;

        tracing::info!(
            org_id = %org.id,
            user_id = %user.id,
            tier = %req.tier,
            seats = seats,
            annual = annual,
            session_id = %session.id,
            "Checkout session created"
        );

        Ok(Json(CheckoutResponse { checkout_url: url }))
    }

    // ============================================================================
    // Checkout Verification
    // ============================================================================

    #[derive(Deserialize)]
    pub struct VerifyCheckoutRequest {
        pub session_id: String,
    }

    #[derive(Serialize)]
    pub struct VerifyCheckoutResponse {
        pub success: bool,
        pub subscription: Option<SubscriptionResponse>,
        pub message: String,
        pub already_processed: bool,
    }

    /// Verify a checkout session and update subscription immediately
    pub async fn verify_checkout(
        user: AuthUser,
        State(state): State<AppState>,
        Json(req): Json<VerifyCheckoutRequest>,
    ) -> Result<Json<VerifyCheckoutResponse>, (StatusCode, String)> {
        let stripe = state.stripe.as_ref().ok_or((
            StatusCode::SERVICE_UNAVAILABLE,
            "Stripe not configured".to_string(),
        ))?;

        // Get user's organization
        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

        // Retrieve the checkout session from Stripe
        let session = stripe
            .retrieve_checkout_session(&req.session_id)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid session: {}", e)))?;

        // Verify the session belongs to this organization's customer
        let session_customer_id = session
            .customer
            .as_ref()
            .map(|c| c.id().to_string())
            .ok_or((
                StatusCode::BAD_REQUEST,
                "Session has no customer".to_string(),
            ))?;

        if org.stripe_customer_id.as_ref() != Some(&session_customer_id) {
            return Err((
                StatusCode::FORBIDDEN,
                "Session does not belong to your organization".to_string(),
            ));
        }

        // Check session status using the typed enum to avoid Debug-repr fragility
        match session.status {
            Some(stripe::CheckoutSessionStatus::Complete) => {
                // Session completed successfully - extract subscription details
                let subscription_id = session
                    .subscription
                    .as_ref()
                    .map(|s| s.id().to_string())
                    .ok_or((
                        StatusCode::BAD_REQUEST,
                        "No subscription in completed session".to_string(),
                    ))?;

                // Idempotency check (snapshot-based; the atomic write below is the true guard)
                if org.stripe_subscription_id.as_ref() == Some(&subscription_id) {
                    return Ok(Json(VerifyCheckoutResponse {
                        success: true,
                        subscription: Some(SubscriptionResponse {
                            tier: org.tier,
                            seats: org.seats,
                            subscription_status: org.subscription_status,
                            billing_interval: org.billing_interval,
                            current_period_start: org.current_period_start,
                            current_period_end: org.current_period_end,
                            cancel_at_period_end: org.cancel_at_period_end,
                            has_stripe: true,
                        }),
                        message: "Subscription already active".to_string(),
                        already_processed: true,
                    }));
                }

                // Get the subscription details from Stripe
                let stripe_subscription = stripe
                    .retrieve_subscription(&subscription_id)
                    .await
                    .map_err(|e| {
                        tracing::error!(
                            org_id = %org.id,
                            subscription_id = %subscription_id,
                            "Failed to retrieve Stripe subscription: {}",
                            e
                        );
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Subscription verification failed. Please contact support.".to_string(),
                        )
                    })?;

                // Extract tier from the subscription price ID or session metadata
                let price_id = stripe_subscription
                    .items
                    .data
                    .first()
                    .and_then(|item| item.price.as_ref())
                    .map(|price| price.id.to_string());
                let tier = price_id
                    .as_deref()
                    .and_then(|pid| stripe.get_tier_from_price_id(pid))
                    .or_else(|| extract_tier_from_session(&session))
                    .ok_or_else(|| {
                        tracing::error!(
                            org_id = %org.id,
                            subscription_id = %subscription_id,
                            price_id = ?price_id,
                            "Could not determine tier from price ID or session metadata"
                        );
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Unable to determine subscription tier. Please contact support."
                                .to_string(),
                        )
                    })?;

                // Calculate seats from quantity
                let seats = stripe_subscription
                    .items
                    .data
                    .first()
                    .and_then(|item| item.quantity)
                    .unwrap_or(1) as i32;

                // Determine billing interval
                let billing_interval = stripe_subscription
                    .items
                    .data
                    .first()
                    .and_then(|item| item.price.as_ref())
                    .and_then(|price| price.recurring.as_ref())
                    .map(|r| match r.interval {
                        stripe::RecurringInterval::Year => "annual".to_string(),
                        _ => "monthly".to_string(),
                    })
                    .unwrap_or_else(|| "monthly".to_string());

                // Convert timestamps
                let period_start =
                    chrono::DateTime::from_timestamp(stripe_subscription.current_period_start, 0)
                        .map(|dt| dt.with_timezone(&chrono::Utc));
                let period_end =
                    chrono::DateTime::from_timestamp(stripe_subscription.current_period_end, 0)
                        .map(|dt| dt.with_timezone(&chrono::Utc));

                // Atomically activate only if not already recorded — prevents concurrent
                // verify_checkout calls from double-processing the same session.
                let updated = OrganizationRepository::activate_subscription_if_new(
                    &state.db,
                    &org.id,
                    &subscription_id,
                    &tier,
                    seats,
                    "active",
                    Some(&billing_interval),
                    period_start,
                    period_end,
                    stripe_subscription.cancel_at_period_end,
                )
                .await
                .map_err(|e| {
                    tracing::error!(org_id = %org.id, "Failed to activate subscription: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to update subscription. Please contact support.".to_string(),
                    )
                })?;

                if !updated {
                    // A concurrent request already activated this subscription
                    return Ok(Json(VerifyCheckoutResponse {
                        success: true,
                        subscription: None,
                        message: "Subscription already active".to_string(),
                        already_processed: true,
                    }));
                }

                tracing::info!(
                    session_id = %req.session_id,
                    org_id = %org.id,
                    tier = %tier,
                    seats = seats,
                    subscription_id = %subscription_id,
                    "Checkout session verified successfully"
                );

                Ok(Json(VerifyCheckoutResponse {
                    success: true,
                    subscription: Some(SubscriptionResponse {
                        tier: tier.clone(),
                        seats,
                        subscription_status: "active".to_string(),
                        billing_interval: Some(billing_interval),
                        current_period_start: period_start,
                        current_period_end: period_end,
                        cancel_at_period_end: stripe_subscription.cancel_at_period_end,
                        has_stripe: true,
                    }),
                    message: "Subscription activated successfully".to_string(),
                    already_processed: false,
                }))
            }
            Some(stripe::CheckoutSessionStatus::Expired) => {
                tracing::info!(session_id = %req.session_id, org_id = %org.id, "Checkout session expired");
                Ok(Json(VerifyCheckoutResponse {
                    success: false,
                    subscription: None,
                    message: "Checkout session has expired".to_string(),
                    already_processed: false,
                }))
            }
            Some(stripe::CheckoutSessionStatus::Open) => {
                tracing::debug!(session_id = %req.session_id, "Checkout session still open");
                Ok(Json(VerifyCheckoutResponse {
                    success: false,
                    subscription: None,
                    message: "Checkout is still in progress".to_string(),
                    already_processed: false,
                }))
            }
            status => {
                tracing::warn!(session_id = %req.session_id, ?status, "Unknown checkout session status");
                Ok(Json(VerifyCheckoutResponse {
                    success: false,
                    subscription: None,
                    message: "Unknown session status".to_string(),
                    already_processed: false,
                }))
            }
        }
    }

    /// Extract tier from checkout session based on price ID or metadata
    fn extract_tier_from_session(session: &stripe::CheckoutSession) -> Option<String> {
        // Try to get from metadata first
        if let Some(metadata) = &session.metadata {
            if let Some(tier) = metadata.get("tier") {
                return Some(tier.clone());
            }
        }

        // Otherwise, we'll default to determining by price later in the webhook
        // For now, return None and let the caller default to "pro"
        None
    }

    /// Create a Stripe billing portal session
    pub async fn create_portal(
        user: AuthUser,
        State(state): State<AppState>,
        Json(req): Json<CreatePortalRequest>,
    ) -> Result<Json<PortalResponse>, (StatusCode, String)> {
        let stripe = state.stripe.as_ref().ok_or((
            StatusCode::SERVICE_UNAVAILABLE,
            "Stripe not configured".to_string(),
        ))?;

        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

        let customer_id = org.stripe_customer_id.ok_or((
            StatusCode::BAD_REQUEST,
            "No Stripe customer. Please upgrade first.".to_string(),
        ))?;

        // Validate return_url — require exact origin prefix with trailing slash to prevent
        // subdomain spoofing (e.g. app.example.com.evil.com passing a bare starts_with check).
        let allowed_origin = format!("{}/", state.config.app_url.trim_end_matches('/'));
        if !req.return_url.starts_with(&allowed_origin) {
            return Err((StatusCode::BAD_REQUEST, "Invalid redirect URL".to_string()));
        }

        let session = stripe
            .create_billing_portal_session(&customer_id, &req.return_url)
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, "Stripe billing portal session creation failed: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create billing portal session. Please try again.".to_string())
            })?;

        tracing::info!(org_id = %org.id, user_id = %user.id, "Billing portal session created");

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
        let stripe = state.stripe.as_ref().ok_or((
            StatusCode::SERVICE_UNAVAILABLE,
            "Stripe not configured".to_string(),
        ))?;

        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

        // Only owner can cancel
        if org.owner_id != user.id {
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can cancel subscription".to_string(),
            ));
        }

        let subscription_id = org.stripe_subscription_id.ok_or((
            StatusCode::BAD_REQUEST,
            "No active subscription".to_string(),
        ))?;

        let immediately = req.immediately.unwrap_or(false);
        stripe
            .cancel_subscription(&subscription_id, immediately)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        tracing::info!(
            org_id = %org.id,
            subscription_id = %subscription_id,
            immediately = immediately,
            "Subscription cancelled"
        );

        Ok(StatusCode::NO_CONTENT)
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
        let (period_start, period_end) = match (&org.current_period_start, &org.current_period_end)
        {
            (Some(start), Some(end)) => (*start, *end),
            _ => {
                // Default to current calendar month - use beginning of current month
                use chrono::{Datelike, TimeZone};
                let start = chrono::Utc
                    .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
                    .single()
                    .unwrap_or(now);
                // Compute first day of next month as the exclusive period end
                let next_month = if now.month() == 12 {
                    1
                } else {
                    now.month() + 1
                };
                let next_year = if now.month() == 12 {
                    now.year() + 1
                } else {
                    now.year()
                };
                let end = chrono::Utc
                    .with_ymd_and_hms(next_year, next_month, 1, 0, 0, 0)
                    .single()
                    .unwrap_or(now);
                (start, end)
            }
        };

        let usage = UsageRepository::list_current(&state.db, &org.id, period_start)
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
        if !matches!(req.tier.as_str(), "pro" | "team") {
            return Err((
                StatusCode::BAD_REQUEST,
                "Invalid tier. Must be 'pro' or 'team'.".to_string(),
            ));
        }

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
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can change plan".to_string(),
            ));
        }

        // Need an active subscription
        let subscription_id = org.stripe_subscription_id.as_ref().ok_or((
            StatusCode::BAD_REQUEST,
            "No active subscription to modify".to_string(),
        ))?;

        let seats = req.seats.unwrap_or(org.seats) as i64;
        let annual = req
            .annual
            .unwrap_or(org.billing_interval.as_deref() == Some("annual"));

        // Update subscription in Stripe
        let subscription = stripe
            .update_subscription_tier(subscription_id, &req.tier, annual, seats)
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, tier = %req.tier, "Stripe plan update failed: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update plan. Please try again or contact support.".to_string())
            })?;

        // Update local database
        let period_start = chrono::DateTime::from_timestamp(subscription.current_period_start, 0)
            .map(|dt| dt.with_timezone(&chrono::Utc));
        let period_end = chrono::DateTime::from_timestamp(subscription.current_period_end, 0)
            .map(|dt| dt.with_timezone(&chrono::Utc));

        OrganizationRepository::update_subscription(
            &state.db,
            &org.id,
            &req.tier,
            seats as i32,
            Some(&subscription.id.to_string()),
            "active",
            Some(if annual { "annual" } else { "monthly" }),
            period_start,
            period_end,
            subscription.cancel_at_period_end,
        )
        .await
        .map_err(|e| {
            tracing::error!(
                org_id = %org.id,
                subscription_id = %subscription.id,
                new_tier = %req.tier,
                "CRITICAL: Stripe plan updated but local DB sync failed — manual reconciliation needed: {}",
                e
            );
            (StatusCode::INTERNAL_SERVER_ERROR, "Plan updated in Stripe but failed to sync locally. Please contact support.".to_string())
        })?;

        tracing::info!(
            org_id = %org.id,
            user_id = %user.id,
            new_tier = %req.tier,
            seats = seats,
            annual = annual,
            subscription_id = %subscription.id,
            "Subscription plan changed"
        );

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
        if !matches!(req.tier.as_str(), "pro" | "team") {
            return Err((
                StatusCode::BAD_REQUEST,
                "Invalid tier. Must be 'pro' or 'team'.".to_string(),
            ));
        }

        let stripe = state.stripe.as_ref().ok_or((
            StatusCode::SERVICE_UNAVAILABLE,
            "Stripe not configured".to_string(),
        ))?;

        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

        if org.owner_id != user.id {
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can preview plan changes".to_string(),
            ));
        }

        let subscription_id = org.stripe_subscription_id.as_ref().ok_or((
            StatusCode::BAD_REQUEST,
            "No active subscription".to_string(),
        ))?;

        let seats = req.seats.unwrap_or(org.seats) as i64;
        // Mirror change_plan: inherit the current billing interval rather than defaulting to monthly
        let annual = req
            .annual
            .unwrap_or(org.billing_interval.as_deref() == Some("annual"));

        let preview = stripe
            .preview_proration(subscription_id, &req.tier, annual, seats)
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, "Proration preview failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to calculate proration preview. Please try again.".to_string(),
                )
            })?;

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
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can update seats".to_string(),
            ));
        }

        let subscription_id = org.stripe_subscription_id.as_ref().ok_or((
            StatusCode::BAD_REQUEST,
            "No active subscription".to_string(),
        ))?;

        if req.seats < 1 {
            return Err((
                StatusCode::BAD_REQUEST,
                "Seats must be at least 1".to_string(),
            ));
        }

        // Guard: cannot reduce seats below occupied count
        let current_count = OrganizationMemberRepository::count(&state.db, &org.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if req.seats < current_count {
            return Err((
                StatusCode::BAD_REQUEST,
                format!(
                    "Cannot reduce seats below current member count ({})",
                    current_count
                ),
            ));
        }

        // Update in Stripe
        stripe
            .update_subscription_seats(subscription_id, req.seats as i64)
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, seats = req.seats, "Stripe seat update failed: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update seats. Please try again.".to_string())
            })?;

        // Update local database — if this fails Stripe and DB are out of sync
        OrganizationRepository::update_seats(&state.db, &org.id, req.seats)
            .await
            .map_err(|e| {
                tracing::error!(
                    org_id = %org.id,
                    subscription_id = %subscription_id,
                    new_seats = req.seats,
                    "CRITICAL: Stripe seats updated but local DB sync failed — manual reconciliation needed: {}",
                    e
                );
                (StatusCode::INTERNAL_SERVER_ERROR, "Seats updated in Stripe but failed to sync locally. Please contact support.".to_string())
            })?;

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

    use crate::billing::stripe::{InvoiceDetail, InvoiceSummary};

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

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::NOT_FOUND, "No billing history".to_string()))?;

        let invoices = stripe
            .list_invoices(customer_id, Some(100))
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, "Failed to list invoices: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to retrieve invoices. Please try again.".to_string(),
                )
            })?;

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

        let org = OrganizationRepository::find_by_user(&state.db, &user.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "No organization found".to_string()))?;

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::NOT_FOUND, "No billing history".to_string()))?;

        let invoice = stripe
            .get_invoice(&invoice_id)
            .await
            .map_err(|e| {
                tracing::error!(org_id = %org.id, invoice_id = %invoice_id, "Failed to fetch invoice: {}", e);
                (StatusCode::NOT_FOUND, "Invoice not found".to_string())
            })?;

        // Verify the invoice belongs to this org's Stripe customer (prevents IDOR)
        if invoice.customer_id.as_deref() != Some(customer_id.as_str()) {
            return Err((StatusCode::NOT_FOUND, "Invoice not found".to_string()));
        }

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

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::NOT_FOUND, "No payment methods".to_string()))?;

        let methods = stripe
            .list_payment_methods(customer_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // Get default payment method from customer
        let customer = stripe
            .get_customer(customer_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let default_pm = customer
            .invoice_settings
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

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::BAD_REQUEST, "No Stripe customer".to_string()))?;

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
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can update payment methods".to_string(),
            ));
        }

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::BAD_REQUEST, "No Stripe customer".to_string()))?;

        // IDOR guard: verify the payment method belongs to this org's Stripe customer
        // before setting it as default (prevents cross-customer payment method hijacking).
        let pm = stripe
            .get_payment_method(&req.payment_method_id)
            .await
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    "Payment method not found".to_string(),
                )
            })?;
        let pm_customer = pm.customer.as_ref().map(|c| c.id().to_string());
        if pm_customer.as_deref() != Some(customer_id.as_str()) {
            return Err((
                StatusCode::NOT_FOUND,
                "Payment method not found".to_string(),
            ));
        }

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
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can delete payment methods".to_string(),
            ));
        }

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::BAD_REQUEST, "No Stripe customer".to_string()))?;

        // IDOR guard: verify the payment method belongs to this org's Stripe customer
        // before detaching (prevents cross-customer payment method deletion).
        let pm = stripe
            .get_payment_method(&payment_method_id)
            .await
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    "Payment method not found".to_string(),
                )
            })?;
        let pm_customer = pm.customer.as_ref().map(|c| c.id().to_string());
        if pm_customer.as_deref() != Some(customer_id.as_str()) {
            return Err((
                StatusCode::NOT_FOUND,
                "Payment method not found".to_string(),
            ));
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

        let coupon = stripe.validate_coupon(&req.code).await.map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                "Coupon not found or invalid".to_string(),
            )
        })?;

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

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::NOT_FOUND, "No billing setup".to_string()))?;

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
            return Err((
                StatusCode::FORBIDDEN,
                "Only owner can add tax ID".to_string(),
            ));
        }

        let customer_id = org
            .stripe_customer_id
            .as_ref()
            .ok_or((StatusCode::BAD_REQUEST, "No Stripe customer".to_string()))?;

        // Tax ID management requires async-stripe 0.39+ — not yet available.
        // Return 501 so the frontend can show a "coming soon" message.
        let _ = (stripe, customer_id, req);
        Err((
            StatusCode::NOT_IMPLEMENTED,
            "Tax ID management is not yet available.".to_string(),
        ))
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
        pub billing_period_start: Option<chrono::DateTime<chrono::Utc>>,
        pub billing_period_end: Option<chrono::DateTime<chrono::Utc>>,
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

        // WARNING: these unit prices must stay in sync with the Stripe price objects
        // identified by STRIPE_PRICE_ID_PRO_MONTHLY / STRIPE_PRICE_ID_TEAM_MONTHLY.
        // Update these constants if prices change in Stripe.
        const PRICE_PRO_MONTHLY_CENTS: i64 = 1200; // $12/seat/month
        const PRICE_TEAM_MONTHLY_CENTS: i64 = 2100; // $21/seat/month
        let monthly_cost_cents = match org.tier.as_str() {
            "pro" => PRICE_PRO_MONTHLY_CENTS * org.seats as i64,
            "team" => PRICE_TEAM_MONTHLY_CENTS * org.seats as i64,
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
} // end mod saas_billing

#[cfg(feature = "saas")]
pub use saas_billing::*;
