use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tracing::{info, warn};

use crate::{
    db::repositories::{BillingEventRepository, OrganizationRepository},
    AppState,
};

/// Stripe webhook handler
/// Handles subscription lifecycle events and credit purchases
pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    let webhook_secret = state.config.stripe_webhook_secret.as_ref().ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "Webhook secret not configured".to_string(),
    ))?;

    // Get Stripe signature header
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "Missing Stripe signature".to_string(),
        ))?;

    // Verify webhook signature
    if !verify_stripe_signature(&body, signature, webhook_secret) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid signature".to_string()));
    }

    // Parse the webhook payload
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let event_type = payload["type"].as_str().ok_or((
        StatusCode::BAD_REQUEST,
        "Missing event type in webhook payload".to_string(),
    ))?;
    let event_id = payload["id"].as_str().ok_or((
        StatusCode::BAD_REQUEST,
        "Missing event ID in webhook payload".to_string(),
    ))?;

    // Basic schema validation
    if !event_id.starts_with("evt_") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid event ID format".to_string(),
        ));
    }
    if !event_type.contains('.') {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid event type format".to_string(),
        ));
    }

    info!("Received Stripe webhook: {} ({})", event_type, event_id);

    // Check for duplicate events
    let exists = match BillingEventRepository::exists_by_stripe_event(&state.db, event_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(event_id = %event_id, "Failed to check for duplicate webhook: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Database error".to_string(),
            ));
        }
    };
    if exists {
        info!("Duplicate webhook event, skipping: {}", event_id);
        return Ok(StatusCode::OK);
    }

    // invoice.paid and invoice.payment_failed are fast (single DB lookup + INSERT) and must be
    // crash-safe: running them synchronously ensures the billing_events row is persisted before
    // we return 200, so a server crash before the spawn completes cannot cause Stripe to re-fire
    // an event whose duplicate check would pass again (nothing written yet).
    match event_type {
        "invoice.paid" => {
            if let Err((status, msg)) = handle_invoice_paid(&state, &payload, event_id).await {
                tracing::error!(event_id, status = %status, "invoice.paid processing failed: {}", msg);
            }
        }
        "invoice.payment_failed" => {
            if let Err((status, msg)) =
                handle_invoice_payment_failed(&state, &payload, event_id).await
            {
                tracing::error!(event_id, status = %status, "invoice.payment_failed processing failed: {}", msg);
            }
        }
        _ => {
            // Offload heavy operations (Stripe API calls, subscription updates) to background.
            // Stripe retries on 5xx or timeout — an immediate 200 prevents spurious retries.
            let event_type_owned = event_type.to_string();
            let event_id_owned = event_id.to_string();
            let event_type_for_panic = event_type_owned.clone();
            let event_id_for_panic = event_id_owned.clone();
            let handle = tokio::spawn(async move {
                let result = match event_type_owned.as_str() {
                    "checkout.session.completed" => {
                        handle_checkout_completed(&state, &payload, &event_id_owned).await
                    }
                    "customer.subscription.updated" => {
                        handle_subscription_updated(&state, &payload, &event_id_owned).await
                    }
                    "customer.subscription.deleted" => {
                        handle_subscription_deleted(&state, &payload, &event_id_owned).await
                    }
                    _ => {
                        warn!("Unhandled webhook event type: {}", event_type_owned);
                        Ok(())
                    }
                };
                if let Err((status, msg)) = result {
                    tracing::error!(
                        event_type = %event_type_owned,
                        event_id = %event_id_owned,
                        status = %status,
                        "Stripe webhook processing failed: {}", msg
                    );
                }
            });
            // Catch panics in the spawned task — a panic produces JoinError::is_panic().
            tokio::spawn(async move {
                if let Err(e) = handle.await {
                    if e.is_panic() {
                        tracing::error!(
                            event_type = %event_type_for_panic,
                            event_id = %event_id_for_panic,
                            "Stripe webhook task panicked — review handler logic"
                        );
                    }
                }
            });
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
        if let Some((k, v)) = part.split_once('=') {
            match k {
                "t" => timestamp = v,
                "v1" => signature = v,
                _ => {}
            }
        }
    }

    if timestamp.is_empty() || signature.is_empty() {
        return false;
    }

    // Verify HMAC signature first (constant-time), then check timestamp.
    // This order prevents timing oracles: an attacker cannot distinguish
    // "bad signature" from "valid signature but stale timestamp".
    let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(payload));

    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(signed_payload.as_bytes());

    let sig_valid = match hex::decode(signature) {
        Ok(sig_bytes) => mac.verify_slice(&sig_bytes).is_ok(),
        Err(_) => return false,
    };
    if !sig_valid {
        return false;
    }

    // Only after confirming a valid signature, enforce the 5-minute replay window.
    if let Ok(ts) = timestamp.parse::<i64>() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        if (now - ts).abs() > 300 {
            tracing::warn!("Stripe webhook rejected: timestamp too old ({ts})");
            return false;
        }
    } else {
        return false;
    }

    true
}

/// Handle checkout.session.completed - New subscription created
async fn handle_checkout_completed(
    state: &AppState,
    payload: &serde_json::Value,
    event_id: &str,
) -> Result<(), (StatusCode, String)> {
    let session = &payload["data"]["object"];
    if session.is_null() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing data.object in checkout event".to_string(),
        ));
    }
    let customer_id = session["customer"].as_str().unwrap_or("");
    let subscription_id = session["subscription"].as_str();

    if customer_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Missing customer ID".to_string()));
    }

    // Find organization by Stripe customer ID
    let org = OrganizationRepository::find_by_stripe_customer(&state.db, customer_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            StatusCode::NOT_FOUND,
            "Organization not found for customer".to_string(),
        ))?;

    if let Some(sub_id) = subscription_id {
        // Fetch subscription details from Stripe to get tier and seats
        if let Some(_stripe) = &state.stripe {
            let stripe_key = state.config.stripe_secret_key.as_ref().ok_or((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Stripe secret key not configured".to_string(),
            ))?;
            let subscription = stripe::Subscription::retrieve(
                &stripe::Client::new(stripe_key.clone()),
                &sub_id.parse().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Invalid subscription ID: {}", e),
                    )
                })?,
                &[],
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Determine tier from price ID
            let tier = determine_tier_from_subscription(&state.config, &subscription);
            let seats = subscription
                .items
                .data
                .first()
                .and_then(|item| item.quantity.and_then(|q| i32::try_from(q).ok()))
                .unwrap_or(1);

            // Get billing interval
            let interval = subscription
                .items
                .data
                .first()
                .and_then(|item| item.price.as_ref())
                .and_then(|price| price.recurring.as_ref())
                .map(|r| format!("{:?}", r.interval).to_lowercase());

            // Get period dates
            let period_start =
                chrono::DateTime::from_timestamp(subscription.current_period_start, 0)
                    .map(|dt| dt.with_timezone(&chrono::Utc));
            let period_end = chrono::DateTime::from_timestamp(subscription.current_period_end, 0)
                .map(|dt| dt.with_timezone(&chrono::Utc));

            // Update organization with subscription details
            OrganizationRepository::update_subscription(
                &state.db,
                &org.id,
                &tier,
                seats,
                Some(sub_id),
                "active",
                interval.as_deref(),
                period_start,
                period_end,
                false,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            info!(
                "Subscription created for org {}: tier={}, seats={}",
                org.id, tier, seats
            );

            // Record idempotency so Stripe retries are deduplicated.
            if let Err(e) = BillingEventRepository::create(
                &state.db,
                &org.id,
                "checkout.session.completed",
                Some(event_id),
                None,
                None,
                None,
            )
            .await
            {
                tracing::error!(org_id = %org.id, event_id = %event_id, "Failed to record billing event: {}", e);
            }
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
    if invoice.is_null() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing data.object in invoice event".to_string(),
        ));
    }
    let customer_id = invoice["customer"].as_str().unwrap_or("");
    let amount_paid = invoice["amount_paid"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .unwrap_or(0);

    if customer_id.is_empty() {
        return Ok(());
    }

    // Find organization
    match OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        Err(e) => {
            tracing::error!(
                event_id,
                customer_id,
                "DB error looking up org for invoice.paid: {}",
                e
            );
        }
        Ok(None) => {
            tracing::warn!(
                event_id,
                customer_id,
                "No org found for Stripe customer on invoice.paid"
            );
        }
        Ok(Some(org)) => {
            // Record billing event
            if let Err(e) = BillingEventRepository::create(
                &state.db,
                &org.id,
                "invoice.paid",
                Some(event_id),
                Some(amount_paid),
                Some("usd"),
                None,
            )
            .await
            {
                tracing::error!(org_id = %org.id, event_id = %event_id, "Failed to record billing event: {}", e);
            }

            info!("Invoice paid for org {}: {} cents", org.id, amount_paid);
        }
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
    if invoice.is_null() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing data.object in invoice event".to_string(),
        ));
    }
    let customer_id = invoice["customer"].as_str().unwrap_or("");

    if customer_id.is_empty() {
        return Ok(());
    }

    match OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        Err(e) => {
            tracing::error!(
                event_id,
                customer_id,
                "DB error looking up org for invoice.payment_failed: {}",
                e
            );
        }
        Ok(None) => {
            tracing::warn!(
                event_id,
                customer_id,
                "No org found for Stripe customer on invoice.payment_failed"
            );
        }
        Ok(Some(org)) => {
            // Record billing event
            if let Err(e) = BillingEventRepository::create(
                &state.db,
                &org.id,
                "invoice.payment_failed",
                Some(event_id),
                None,
                None,
                None,
            )
            .await
            {
                tracing::error!(org_id = %org.id, event_id = %event_id, "Failed to record billing event: {}", e);
            }

            warn!("Payment failed for org {}", org.id);
        }
    }

    Ok(())
}

/// Handle customer.subscription.updated
async fn handle_subscription_updated(
    state: &AppState,
    payload: &serde_json::Value,
    event_id: &str,
) -> Result<(), (StatusCode, String)> {
    let subscription = &payload["data"]["object"];
    if subscription.is_null() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing data.object in subscription event".to_string(),
        ));
    }
    let customer_id = subscription["customer"].as_str().unwrap_or("");
    let subscription_id = subscription["id"].as_str().unwrap_or("");
    let status = subscription["status"].as_str().unwrap_or("active");
    let cancel_at_period_end = subscription["cancel_at_period_end"]
        .as_bool()
        .unwrap_or(false);

    if customer_id.is_empty() {
        return Ok(());
    }

    match OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        Err(e) => {
            tracing::error!(
                customer_id,
                "DB error looking up org for customer.subscription.updated: {}",
                e
            );
        }
        Ok(None) => {
            tracing::warn!(
                customer_id,
                "No org found for Stripe customer on subscription.updated — skipping"
            );
        }
        Ok(Some(org)) => {
            // Get quantity (seats) from subscription items
            let seats = subscription["items"]["data"][0]["quantity"]
                .as_i64()
                .and_then(|q| i32::try_from(q).ok())
                .unwrap_or(1);

            // Get period dates
            let period_start = subscription["current_period_start"]
                .as_i64()
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                .map(|dt| dt.with_timezone(&chrono::Utc));
            let period_end = subscription["current_period_end"]
                .as_i64()
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                .map(|dt| dt.with_timezone(&chrono::Utc));

            // Determine tier
            let tier = determine_tier_from_price_id(
                &state.config,
                subscription["items"]["data"][0]["price"]["id"]
                    .as_str()
                    .unwrap_or(""),
            );

            // Extract billing interval from the subscription payload
            let interval = subscription["items"]["data"][0]["price"]["recurring"]["interval"]
                .as_str()
                .map(|s| if s == "year" { "annual" } else { "monthly" }.to_string());

            OrganizationRepository::update_subscription(
                &state.db,
                &org.id,
                &tier,
                seats,
                Some(subscription_id),
                status,
                interval.as_deref(),
                period_start,
                period_end,
                cancel_at_period_end,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Record idempotency so Stripe retries are deduplicated.
            if let Err(e) = BillingEventRepository::create(
                &state.db,
                &org.id,
                "customer.subscription.updated",
                Some(event_id),
                None,
                None,
                None,
            )
            .await
            {
                tracing::error!(org_id = %org.id, event_id = %event_id, "Failed to record billing event: {}", e);
            }

            info!(
                "Subscription updated for org {}: status={}, seats={}, cancel_at_period_end={}",
                org.id, status, seats, cancel_at_period_end
            );
        }
    }

    Ok(())
}

/// Handle customer.subscription.deleted
async fn handle_subscription_deleted(
    state: &AppState,
    payload: &serde_json::Value,
    event_id: &str,
) -> Result<(), (StatusCode, String)> {
    let subscription = &payload["data"]["object"];
    if subscription.is_null() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing data.object in subscription event".to_string(),
        ));
    }
    let customer_id = subscription["customer"].as_str().unwrap_or("");

    if customer_id.is_empty() {
        return Ok(());
    }

    match OrganizationRepository::find_by_stripe_customer(&state.db, customer_id).await {
        Err(e) => {
            tracing::error!(
                customer_id,
                "DB error looking up org for customer.subscription.deleted: {}",
                e
            );
        }
        Ok(None) => {
            tracing::warn!(
                customer_id,
                "No org found for Stripe customer on subscription.deleted"
            );
        }
        Ok(Some(org)) => {
            // Downgrade to free tier
            OrganizationRepository::update_subscription(
                &state.db,
                &org.id,
                "free",
                org.seats.max(1),
                None::<&str>,
                "canceled",
                None,
                None,
                None,
                false,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Record idempotency so Stripe retries are deduplicated.
            if let Err(e) = BillingEventRepository::create(
                &state.db,
                &org.id,
                "customer.subscription.deleted",
                Some(event_id),
                None,
                None,
                None,
            )
            .await
            {
                tracing::error!(org_id = %org.id, event_id = %event_id, "Failed to record billing event: {}", e);
            }

            info!(
                "Subscription canceled for org {}, downgraded to free",
                org.id
            );
        }
    }

    Ok(())
}

/// Determine tier from Stripe subscription object
fn determine_tier_from_subscription(
    config: &crate::config::Config,
    subscription: &stripe::Subscription,
) -> String {
    let price_id = subscription
        .items
        .data
        .first()
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
