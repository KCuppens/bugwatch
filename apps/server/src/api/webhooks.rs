use std::sync::{Arc, OnceLock};

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::{
    db::repositories::{organizations::BillingEventRepository, OrganizationRepository},
    AppState,
};

static WEBHOOK_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn webhook_semaphore() -> Arc<Semaphore> {
    WEBHOOK_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(64)))
        .clone()
}

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

    // Reject non-UTF-8 payloads explicitly rather than silently replacing
    // invalid bytes via from_utf8_lossy (which could mask a malformed body
    // that fails signature verification but still reaches the JSON parser).
    if std::str::from_utf8(&body).is_err() {
        return Err((StatusCode::BAD_REQUEST, "invalid utf-8".to_string()));
    }

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
            //
            // H4 TOCTOU fix: claim the event ID atomically before spawning via
            // ON CONFLICT DO NOTHING. If another request already claimed it, skip.
            // org_id is not yet known here; we use a sentinel and handlers update it.
            let claimed = match BillingEventRepository::create_idempotent(
                &state.db, "pending", event_type, event_id,
            )
            .await
            {
                Ok(inserted) => inserted,
                Err(e) => {
                    tracing::error!(event_id, "Failed to claim billing event slot: {}", e);
                    // Fall through to spawn anyway — individual handlers have their own guard
                    true
                }
            };
            if !claimed {
                info!(
                    "Duplicate webhook event (pre-spawn guard), skipping: {}",
                    event_id
                );
                return Ok(StatusCode::OK);
            }

            let event_type_owned = event_type.to_string();
            let event_id_owned = event_id.to_string();
            let event_type_for_panic = event_type_owned.clone();
            let event_id_for_panic = event_id_owned.clone();
            let sem = webhook_semaphore();
            let permit = match sem.try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    tracing::warn!(event_id = %event_id_owned, "Webhook processing queue full");
                    return Err((
                        StatusCode::TOO_MANY_REQUESTS,
                        "Webhook queue full".to_string(),
                    ));
                }
            };
            let handle = tokio::spawn(async move {
                let _permit = permit;
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
    // Reject payloads that aren't valid UTF-8 up-front. Stripe signs the raw
    // payload bytes directly, so invalid UTF-8 would never match a legitimate
    // signature — but we also avoid String::from_utf8_lossy, which would
    // silently mangle bytes and could, in theory, produce a payload whose
    // signature happens to match a crafted HMAC.
    if std::str::from_utf8(payload).is_err() {
        return false;
    }

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

    // Build the signed payload. Safe after the UTF-8 check above.
    let payload_str = match std::str::from_utf8(payload) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let signed_payload = format!("{}.{}", timestamp, payload_str);

    // Verify HMAC signature first (constant-time), then check timestamp.
    // This order prevents timing oracles: an attacker cannot distinguish
    // "bad signature" from "valid signature but stale timestamp".
    //
    // We constant-time compare hex strings directly (rather than
    // hex-decode + verify_slice) to avoid a timing oracle on the decode:
    // a malformed hex string would previously short-circuit before the
    // HMAC was computed, leaking info about the input via latency.
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        tracing::error!("Failed to initialize HMAC for webhook signature verification");
        return false;
    };
    mac.update(signed_payload.as_bytes());
    let expected_hex = hex::encode(mac.finalize().into_bytes());

    let sig_valid = if signature.len() == expected_hex.len() {
        bool::from(signature.as_bytes().ct_eq(expected_hex.as_bytes()))
    } else {
        // Still go through the motions to equalize timing.
        let dummy = vec![0u8; expected_hex.len()];
        let _ = bool::from(dummy.ct_eq(expected_hex.as_bytes()));
        false
    };
    if !sig_valid {
        return false;
    }

    // Only after confirming a valid signature, enforce the replay window.
    // Asymmetric bounds: allow up to 5 minutes of skew in the past
    // (Stripe retries may legitimately span this), but only 1 minute in
    // the future (far-future timestamps almost certainly indicate a
    // replay or crafted request; 60s is well above realistic clock drift).
    if let Ok(ts) = timestamp.parse::<i64>() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let delta = now - ts;
        // delta > 0  => event is in the past (allow up to 300s)
        // delta < 0  => event is in the future (allow up to 60s of skew)
        if delta > 300 || delta < -60 {
            tracing::warn!("Stripe webhook rejected: timestamp out of window ({ts})");
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
    let customer_id = match session["customer"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing customer_id");
            return Err((StatusCode::BAD_REQUEST, "Missing customer ID".to_string()));
        }
    };
    let subscription_id = session["subscription"].as_str();

    // Stripe customer IDs always start with "cus_" — reject anything else.
    // This guards against malformed/crafted webhook payloads that slip a
    // value matching some other schema (e.g. a price or account id).
    if !customer_id.starts_with("cus_") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid Stripe customer ID format".to_string(),
        ));
    }
    if let Some(sid) = subscription_id {
        if !sid.starts_with("sub_") {
            return Err((
                StatusCode::BAD_REQUEST,
                "Invalid Stripe subscription ID format".to_string(),
            ));
        }
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
            // H5: guard against unknown price IDs silently downgrading to free
            if tier == "free" {
                let price_id = subscription
                    .items
                    .data
                    .first()
                    .and_then(|item| item.price.as_ref())
                    .map(|p| p.id.to_string())
                    .unwrap_or_default();
                tracing::error!(
                    price_id = %price_id,
                    org_id = %org.id,
                    "Unknown price ID would downgrade org to free tier — skipping update"
                );
                return Ok(());
            }

            let seats = subscription
                .items
                .data
                .first()
                .and_then(|item| item.quantity.and_then(|q| i32::try_from(q).ok()))
                .unwrap_or(1);

            // Get billing interval — use a typed match to avoid Debug-repr producing
            // "month"/"year" instead of the canonical "monthly"/"annual" strings we store.
            let interval = subscription
                .items
                .data
                .first()
                .and_then(|item| item.price.as_ref())
                .and_then(|price| price.recurring.as_ref())
                .map(|r| match r.interval {
                    stripe::RecurringInterval::Year => "annual",
                    stripe::RecurringInterval::Month => "monthly",
                    _ => {
                        tracing::error!(interval = ?r.interval, "Unknown billing interval in checkout.session.completed — defaulting to monthly");
                        "monthly"
                    }
                }.to_string());

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
    let customer_id = match invoice["customer"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing customer_id");
            return Ok(());
        }
    };
    // Stripe customer IDs always start with "cus_" — reject anything else so
    // malformed or crafted payloads never reach the DB.
    if !customer_id.starts_with("cus_") {
        tracing::warn!(
            customer_id,
            "rejecting invoice.paid with malformed customer id"
        );
        return Ok(());
    }
    // Validate amount_paid: reject zero/negative values. A genuine
    // "invoice.paid" should always carry a positive amount — a zero or
    // negative value indicates either a malformed payload or a refund
    // masquerading as a payment, neither of which should be credited.
    let amount_paid_raw = invoice["amount_paid"].as_i64().unwrap_or(0);
    if amount_paid_raw <= 0 {
        tracing::warn!(event_id = %event_id, amount_paid = amount_paid_raw, "rejecting invoice with non-positive amount");
        return Ok(());
    }
    let amount_paid = i32::try_from(amount_paid_raw).unwrap_or(i32::MAX);

    // G1: Atomically claim this event ID before any processing.
    // Uses ON CONFLICT DO NOTHING so concurrent retries from Stripe are deduplicated.
    let claimed =
        BillingEventRepository::create_idempotent(&state.db, "pending", "invoice.paid", event_id)
            .await
            .map_err(|e| {
                tracing::error!(
                    event_id,
                    "Failed to claim billing event slot for invoice.paid: {}",
                    e
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Database error".to_string(),
                )
            })?;
    if !claimed {
        info!(
            "Duplicate invoice.paid event (idempotency guard), skipping: {}",
            event_id
        );
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
    let customer_id = match invoice["customer"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing customer_id");
            return Ok(());
        }
    };
    if !customer_id.starts_with("cus_") {
        tracing::warn!(
            customer_id,
            "rejecting invoice.payment_failed with malformed customer id"
        );
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
            // Set subscription to past_due since payment failed
            if let Err(e) = OrganizationRepository::update_subscription(
                &state.db,
                &org.id,
                &org.tier,
                org.seats,
                org.stripe_subscription_id.as_deref(),
                "past_due",
                org.billing_interval.as_deref(),
                org.current_period_start.map(|t| t.0),
                org.current_period_end.map(|t| t.0),
                org.cancel_at_period_end.0,
            )
            .await
            {
                tracing::warn!(org_id = %org.id, "Failed to set past_due status: {}", e);
            }

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
    let customer_id = match subscription["customer"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing customer_id");
            return Ok(());
        }
    };
    let subscription_id = match subscription["id"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing subscription_id");
            return Ok(());
        }
    };
    let status = match subscription["status"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing subscription status");
            return Ok(());
        }
    };
    // cancel_at_period_end: nice-to-have flag; safe default to false if absent.
    let cancel_at_period_end = subscription["cancel_at_period_end"]
        .as_bool()
        .unwrap_or(false);

    // Reject webhooks whose Stripe identifiers don't match the expected
    // prefixes — helps catch spoofed/mis-routed payloads before they touch
    // the database.
    if !customer_id.starts_with("cus_") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid Stripe customer ID format".to_string(),
        ));
    }
    if !subscription_id.starts_with("sub_") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid Stripe subscription ID format".to_string(),
        ));
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

            // Determine tier — require price_id; empty would silently downgrade users to "free".
            let price_id_str = match subscription["items"]["data"][0]["price"]["id"].as_str() {
                Some(s) if !s.is_empty() => s,
                _ => {
                    tracing::error!(
                        event_id = %event_id,
                        "Webhook payload missing price_id for subscription update"
                    );
                    return Ok(());
                }
            };
            // Reject price IDs that don't look like Stripe price IDs
            // (they should always start with "price_"). Malformed/crafted
            // payloads would otherwise reach determine_tier_from_price_id.
            if !price_id_str.starts_with("price_") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "Invalid Stripe price ID format".to_string(),
                ));
            }
            let tier = determine_tier_from_price_id(&state.config, price_id_str);

            // H5: guard against unknown price IDs silently downgrading to free
            if tier == "free" {
                tracing::error!(
                    price_id = %price_id_str,
                    org_id = %org.id,
                    "Unknown price ID would downgrade org to free tier — skipping update"
                );
                return Ok(());
            }

            // Extract billing interval from the subscription payload (H5: validate value)
            let interval_str = subscription["items"]["data"][0]["price"]["recurring"]["interval"]
                .as_str()
                .unwrap_or("month");
            let billing_interval = match interval_str {
                "year" => "annual",
                "month" => "monthly",
                other => {
                    tracing::error!(interval = %other, "Unknown billing interval in subscription update — defaulting to monthly");
                    "monthly" // safe default
                }
            };
            let interval = Some(billing_interval.to_string());

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
    let customer_id = match subscription["customer"].as_str() {
        Some(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(event_id = %event_id, "Webhook payload missing customer_id");
            return Ok(());
        }
    };

    if !customer_id.starts_with("cus_") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid Stripe customer ID format".to_string(),
        ));
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
