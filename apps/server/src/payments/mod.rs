pub mod challenge;
pub mod store;
pub mod verify;

use axum::{body::Body, extract::State, http::Request, middleware::Next, response::Response};
use serde::Deserialize;

use crate::{AppError, AppState};

#[derive(Debug, Deserialize)]
pub struct PaymentProof {
    pub nonce: String,
    pub tx_hash: String,
}

/// Decodes X-Payment header value (base64-encoded JSON: {"nonce":"...","tx_hash":"..."})
pub fn decode_payment_proof(header_value: &str) -> Result<PaymentProof, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(header_value)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("JSON parse failed: {}", e))
}

/// Verifies an X-Payment proof and, for capacity grants, increments org quota atomically.
/// Returns the payment_type string ("feature_access" | "capacity_grant") on success.
pub async fn verify_and_apply_payment(
    state: &AppState,
    proof: &PaymentProof,
    org_id: &str,
) -> Result<String, AppError> {
    // 1. Atomically claim the pending nonce (sets status = 'verified', checks expiry in SQL)
    let payment = state
        .payment_store
        .claim_pending(&proof.nonce)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
        .ok_or_else(|| {
            AppError::Unauthorized("Payment nonce already used, expired, or not found".to_string())
        })?;

    if payment.organization_id != org_id {
        return Err(AppError::Unauthorized(
            "Payment nonce belongs to different organization".to_string(),
        ));
    }

    // 2. Verify on-chain USDC transfer
    state
        .onchain_verifier
        .verify_usdc_transfer(
            &proof.tx_hash,
            &state.config.x402_wallet_address,
            &state.config.x402_usdc_address,
            u64::try_from(payment.amount_usdc)
                .map_err(|_| AppError::Internal("Invalid payment amount in DB".to_string()))?,
        )
        .await
        .map_err(|e| AppError::PaymentRequired(format!("Payment verification failed: {}", e)))?;

    // 4. For capacity grants: atomically increment org quota
    if payment.payment_type == "capacity_grant" {
        if let (Some(grant_type), Some(quantity)) = (&payment.grant_type, payment.grant_quantity) {
            apply_capacity_grant(&state.db, org_id, grant_type, quantity).await?;
        }
    }

    // 5. Mark consumed
    state
        .payment_store
        .mark_consumed(&payment.nonce)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(payment.payment_type)
}

/// Atomically increments org's x402 capacity column. Retention capped at 365 days.
pub async fn apply_capacity_grant(
    db: &sqlx::PgPool,
    org_id: &str,
    grant_type: &str,
    quantity: i64,
) -> Result<(), AppError> {
    let qty_i32 = i32::try_from(quantity).map_err(|_| {
        AppError::Internal("Grant quantity exceeds maximum allowed value".to_string())
    })?;

    match grant_type {
        "project" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_projects = LEAST(x402_extra_projects + $1, 50) WHERE id = $2"
            )
            .bind(qty_i32)
            .bind(org_id)
            .execute(db)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;
        }
        "monitor" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_monitors = LEAST(x402_extra_monitors + $1, 100) WHERE id = $2"
            )
            .bind(qty_i32)
            .bind(org_id)
            .execute(db)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;
        }
        "storage_bytes" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_storage_bytes = x402_extra_storage_bytes + $1 WHERE id = $2"
            )
            .bind(quantity)
            .bind(org_id)
            .execute(db)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;
        }
        "retention_days" => {
            // Cap at 365 total
            sqlx::query(
                "UPDATE organizations SET x402_extra_retention_days = LEAST(x402_extra_retention_days + $1, 365) WHERE id = $2"
            )
            .bind(qty_i32)
            .bind(org_id)
            .execute(db)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;
        }
        _ => {
            return Err(AppError::Internal(format!(
                "Unknown grant_type: {}",
                grant_type
            )))
        }
    }
    Ok(())
}

/// Axum middleware: checks X-Payment header on every request.
/// - FeatureAccess: verifies, applies, and SHORT-CIRCUITS (skips tier guard)
/// - CapacityGrant: verifies, applies capacity to org, then FALLS THROUGH to handler
pub async fn x402_payment_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Only process if x402 is enabled and X-Payment header is present
    if state.config.x402_enabled {
        if let Some(payment_header) = req.headers().get("X-Payment") {
            if let Ok(header_str) = payment_header.to_str() {
                if let Ok(proof) = decode_payment_proof(header_str) {
                    // Try to find org_id from request headers (X-API-Key agent auth)
                    // We look it up from the DB via the API key
                    // DB lookup only happens after X-Payment header is present AND decoded successfully
                    let org_id = get_org_id_from_request(&state, &req).await;
                    if let Some(org_id) = org_id {
                        match verify_and_apply_payment(&state, &proof, &org_id).await {
                            Ok(payment_type) if payment_type == "feature_access" => {
                                // Feature payment verified: bypass tier checks
                                // Add a flag to request extensions so tier_guard can detect bypass
                                let mut req = req;
                                req.extensions_mut().insert(X402PaymentVerified);
                                return next.run(req).await;
                            }
                            Ok(_) => {
                                // Capacity grant applied: fall through to handler normally
                                // (the limit check will now pass)
                            }
                            Err(e) => {
                                tracing::warn!("Invalid X-Payment proof: {:?}", e);
                                // Fall through to normal request handling (will return a new 402 challenge)
                            }
                        }
                    }
                }
            }
        }
    }
    next.run(req).await
}

/// Marker type inserted into request extensions when a valid feature_access payment was verified
#[derive(Clone)]
pub struct X402PaymentVerified;

/// Builds a 402 response body enriched with an x402 payment challenge.
/// Used by API handlers when returning feature-gated 402 errors.
/// Falls back to plain 402 error message if x402 is disabled or in self-hosted mode.
pub async fn x402_feature_response(
    state: &AppState,
    feature: &str,
    resource: &str,
    org_id: &str,
    agent_key_id: Option<&str>,
    error_msg: &str,
) -> crate::AppError {
    if !state.config.x402_enabled || state.config.deployment_mode.is_self_hosted() {
        return crate::AppError::PaymentRequired(error_msg.to_string());
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    let challenge = crate::payments::challenge::build_feature_challenge(
        &state.config.x402_wallet_address,
        &state.config.x402_usdc_address,
        resource,
        feature,
        &nonce,
    );
    let amount = crate::payments::challenge::PaymentPricing::for_feature(feature) as i64;
    // Store the challenge in background (non-blocking)
    let store = state.payment_store.clone();
    let nonce_clone = nonce.clone();
    let org_id_owned = org_id.to_string();
    let resource_owned = resource.to_string();
    let feature_owned = feature.to_string();
    let agent_key_id_owned = agent_key_id.map(|s| s.to_string());
    tokio::spawn(async move {
        if let Err(e) = store
            .create_feature_challenge(
                &nonce_clone,
                &org_id_owned,
                agent_key_id_owned.as_deref(),
                &resource_owned,
                &feature_owned,
                amount,
                300,
            )
            .await
        {
            tracing::warn!("Failed to store x402 challenge: {}", e);
        }
    });
    crate::AppError::PaymentRequiredWithChallenge {
        message: error_msg.to_string(),
        challenge: serde_json::json!(challenge),
    }
}

/// Extracts org_id from request using the X-API-Key agent auth header
async fn get_org_id_from_request(state: &AppState, req: &Request<Body>) -> Option<String> {
    use crate::auth::agent::hash_agent_key;
    use crate::db::repositories::AgentKeyRepository;

    let api_key = req
        .headers()
        .get("X-API-Key")
        .or_else(|| req.headers().get("Authorization"))
        .and_then(|v| v.to_str().ok())?;

    let key = api_key.trim_start_matches("Bearer ").trim();
    if !key.starts_with("bw_agent_") {
        return None;
    }

    let key_hash = hash_agent_key(key);
    let agent_key = AgentKeyRepository::find_by_hash(&state.db, &key_hash)
        .await
        .ok()??;
    Some(agent_key.organization_id)
}
