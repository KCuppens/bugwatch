use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tracing::{error, info, warn};

use crate::{
    db::repositories::{
        BillingEventRepository, CreditPurchaseRepository, OrganizationRepository, UserRepository,
    },
    AppState,
};

/// Stripe webhook handler
/// Handles subscription lifecycle events and credit purchases
pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    let webhook_secret = state
        .config
        .stripe_webhook_secret
        .as_ref()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Webhook secret not configured".to_string()))?;

    // Get Stripe signature header
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::BAD_REQUEST, "Missing Stripe signature".to_string()))?;

    // Verify webhook signature
    if !verify_stripe_signature(&body, signature, webhook_secret) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid signature".to_string()));
    }

    // Parse the webhook payload
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let event_type = payload["type"].as_str().unwrap_or("unknown");
    let event_id = payload["id"].as_str().unwrap_or("unknown");

    info!("Received Stripe webhook: {} ({})", event_type, event_id);

    // Check for duplicate events
    if let Ok(exists) = BillingEventRepository::exists_by_stripe_event(&state.db, event_id).await {
        if exists {
            info!("Duplicate webhook event, skipping: {}", event_id);
            return Ok(StatusCode::OK);
        }
    }

    // Handle different event types
    match event_type {
        "checkout.session.completed" => {
            handle_checkout_completed(&state, &payload).await?;
        }
        "invoice.paid" => {
            handle_invoice_paid(&state, &payload, event_id).await?;
        }
        "invoice.payment_failed" => {
            handle_invoice_payment_failed(&state, &payload, event_id).await?;
        }
        "customer.subscription.updated" => {
            handle_subscription_updated(&state, &payload).await?;
        }
        "customer.subscription.deleted" => {
            handle_subscription_deleted(&state, &payload).await?;
        }
        "payment_intent.succeeded" => {
            handle_payment_intent_succeeded(&state, &payload).await?;
        }
        _ => {
            warn!("Unhandled webhook event type: {}", event_type);
        }
    }

    Ok(StatusCode::OK)
}

/// Verify Stripe webhook signature
fn verify_stripe_signature(payload: &[u8], signature_header: &str, secret: &str) -> bool {
    // Parse the signature header
    let mut timestamp = "";
    let mut signature = "";

    for part in signature_header.split(',') {
        let kv: Vec<&str> = part.split('=').collect();
        if kv.len() == 2 {
            match kv[0] {
                "t" => timestamp = kv[1],
                "v1" => signature = kv[1],
                _ => {}
            }
        }
    }

    if timestamp.is_empty() || signature.is_empty() {
        return false;
    }

    // Build the signed payload
    let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(payload));

    // Compute expected signature
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(signed_payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    // Constant-time comparison
    expected == signature
}

/// Handle checkout.session.completed - New subscription created
async fn handle_checkout_completed(
    state: &AppState,
    payload: &serde_json::Value,
) -> Result<(), (StatusCode, String)> {
    let session = &payload["data"]["object"];
    let customer_id = session["customer"].as_str().unwrap_or("");
    let subscription_id = session["subscription"].as_str();

    if customer_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Missing customer ID".to_string()));
    }

    // Find organization by Stripe customer ID
    let org = OrganizationRepository::find_by_stripe_customer(&state.db, customer_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Organization not found for customer".to_string()))?;

    if let Some(sub_id) = subscription_id {
        // Fetch subscription details from Stripe to get tier and seats
        if let Some(stripe) = &state.stripe {
            let subscription = stripe::Subscription::retrieve(
                &stripe::Client::new(state.config.stripe_secret_key.clone().unwrap_or_default()),
                &sub_id.parse().unwrap(),
                &[],
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Determine tier from price ID
            let tier = determine_tier_from_subscription(&state.config, &subscription);
            let seats = subscription.items.data.first()
                .map(|item| item.quantity.unwrap_or(1) as i32)
                .unwrap_or(1);

            // Get billing interval
            let interval = subscription.items.data.first()
                .and_then(|item| item.price.as_ref())
                .and_then(|price| price.recurring.as_ref())
                .map(|r| format!("{:?}", r.interval).to_lowercase());

            // Get period dates
            let period_start = chrono::DateTime::from_timestamp(subscription.current_period_start, 0)
                .map(|dt| dt.to_rfc3339());
            let period_end = chrono::DateTime::from_timestamp(subscription.current_period_end, 0)
                .map(|dt| dt.to_rfc3339());

            // Update organization with subscription details
            OrganizationRepository::update_subscription(
                &state.db,
                &org.id,
                &tier,
                seats,
                Some(sub_id),
                "active",
                interval.as_deref(),
                period_start.as_deref(),
                period_end.as_deref(),
                false,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            info!(
                "Subscription created for org {}: tier={}, seats={}",
                org.id, tier, seats
            );
        }
    }

    Ok(())
}

/// Handle invoice.paid - Subscription renewed successfully
async fn handle_invoice_paid(
    state: &AppState,
    payload: &serde_json::Value,
    event_id: &str,
) -> Result<(), (StatusCode, String)> {
    let invoice = &payload["data"]["object"];
    let customer_id = invoice["customer"].as_str().unwrap_or("");
    let amount_paid = invoice["amount_paid"].as_i64().unwrap_or(0) as i32;

    if customer_id.is_empty() {
        return Ok(());
    }

    // Find organization
    if let Ok(Some(org)) = OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        // Record billing event
        BillingEventRepository::create(
            &state.db,
            &org.id,
            "invoice.paid",
            Some(event_id),
            Some(amount_paid),
            Some("usd"),
            None,
        )
        .await
        .ok();

        info!("Invoice paid for org {}: {} cents", org.id, amount_paid);
    }

    Ok(())
}

/// Handle invoice.payment_failed
async fn handle_invoice_payment_failed(
    state: &AppState,
    payload: &serde_json::Value,
    event_id: &str,
) -> Result<(), (StatusCode, String)> {
    let invoice = &payload["data"]["object"];
    let customer_id = invoice["customer"].as_str().unwrap_or("");

    if customer_id.is_empty() {
        return Ok(());
    }

    if let Ok(Some(org)) = OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        // Record billing event
        BillingEventRepository::create(
            &state.db,
            &org.id,
            "invoice.payment_failed",
            Some(event_id),
            None,
            None,
            None,
        )
        .await
        .ok();

        // Update subscription status to past_due
        // Note: In production, you might want to send a notification email here
        warn!("Payment failed for org {}", org.id);
    }

    Ok(())
}

/// Handle customer.subscription.updated
async fn handle_subscription_updated(
    state: &AppState,
    payload: &serde_json::Value,
) -> Result<(), (StatusCode, String)> {
    let subscription = &payload["data"]["object"];
    let customer_id = subscription["customer"].as_str().unwrap_or("");
    let subscription_id = subscription["id"].as_str().unwrap_or("");
    let status = subscription["status"].as_str().unwrap_or("active");
    let cancel_at_period_end = subscription["cancel_at_period_end"].as_bool().unwrap_or(false);

    if customer_id.is_empty() {
        return Ok(());
    }

    if let Ok(Some(org)) = OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        // Get quantity (seats) from subscription items
        let seats = subscription["items"]["data"][0]["quantity"]
            .as_i64()
            .unwrap_or(1) as i32;

        // Get period dates
        let period_start = subscription["current_period_start"]
            .as_i64()
            .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
            .map(|dt| dt.to_rfc3339());
        let period_end = subscription["current_period_end"]
            .as_i64()
            .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
            .map(|dt| dt.to_rfc3339());

        // Determine tier
        let tier = determine_tier_from_price_id(
            &state.config,
            subscription["items"]["data"][0]["price"]["id"].as_str().unwrap_or(""),
        );

        OrganizationRepository::update_subscription(
            &state.db,
            &org.id,
            &tier,
            seats,
            Some(subscription_id),
            status,
            None,
            period_start.as_deref(),
            period_end.as_deref(),
            cancel_at_period_end,
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        info!(
            "Subscription updated for org {}: status={}, seats={}, cancel_at_period_end={}",
            org.id, status, seats, cancel_at_period_end
        );
    }

    Ok(())
}

/// Handle customer.subscription.deleted
async fn handle_subscription_deleted(
    state: &AppState,
    payload: &serde_json::Value,
) -> Result<(), (StatusCode, String)> {
    let subscription = &payload["data"]["object"];
    let customer_id = subscription["customer"].as_str().unwrap_or("");

    if customer_id.is_empty() {
        return Ok(());
    }

    if let Ok(Some(org)) = OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        // Downgrade to free tier
        OrganizationRepository::update_subscription(
            &state.db,
            &org.id,
            "free",
            1,
            None::<&str>,
            "canceled",
            None,
            None,
            None,
            false,
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        info!("Subscription canceled for org {}, downgraded to free", org.id);
    }

    Ok(())
}

/// Handle payment_intent.succeeded - Credit purchase completed
async fn handle_payment_intent_succeeded(
    state: &AppState,
    payload: &serde_json::Value,
) -> Result<(), (StatusCode, String)> {
    let intent = &payload["data"]["object"];
    let payment_intent_id = intent["id"].as_str().unwrap_or("");

    // Check if this is a credit purchase
    let intent_type = intent["metadata"]["type"].as_str().unwrap_or("");
    if intent_type != "credit_purchase" {
        return Ok(());
    }

    // Find the credit purchase by payment intent
    let purchase = CreditPurchaseRepository::find_by_payment_intent(&state.db, payment_intent_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(purchase) = purchase {
        if purchase.status == "pending" {
            // Complete the purchase
            let completed = CreditPurchaseRepository::complete(&state.db, &purchase.id)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Add credits to user
            UserRepository::add_credits(&state.db, &completed.user_id, completed.credits)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            info!(
                "Credit purchase completed: {} credits for user {}",
                completed.credits, completed.user_id
            );
        }
    }

    Ok(())
}

/// Determine tier from Stripe subscription object
fn determine_tier_from_subscription(config: &crate::config::Config, subscription: &stripe::Subscription) -> String {
    let price_id = subscription.items.data.first()
        .and_then(|item| item.price.as_ref())
        .map(|price| price.id.to_string())
        .unwrap_or_default();

    determine_tier_from_price_id(config, &price_id)
}

/// Determine tier from Stripe price ID
fn determine_tier_from_price_id(config: &crate::config::Config, price_id: &str) -> String {
    if config.stripe_price_id_pro_monthly.as_deref() == Some(price_id)
        || config.stripe_price_id_pro_annual.as_deref() == Some(price_id)
    {
        "pro".to_string()
    } else if config.stripe_price_id_team_monthly.as_deref() == Some(price_id)
        || config.stripe_price_id_team_annual.as_deref() == Some(price_id)
    {
        "team".to_string()
    } else {
        "free".to_string()
    }
}
