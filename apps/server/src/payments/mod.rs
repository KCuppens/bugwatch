#![allow(dead_code)]

pub mod challenge;
pub mod store;
pub mod verify;

use axum::{body::Body, http::Request, middleware::Next, response::Response};
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
/// Returns the payment_type and, for capacity grants, the grant details.
/// The grant details can be passed through Axum extensions to avoid a stale DB re-read.
pub async fn verify_and_apply_payment(
    state: &AppState,
    proof: &PaymentProof,
    org_id: &str,
    request_path: &str,
) -> Result<(String, Option<X402CapacityGrantApplied>), AppError> {
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
        // Do NOT unclaim on org mismatch — restoring the nonce to pending would allow
        // a different org to claim the same nonce (cross-org replay attack).
        tracing::warn!(
            nonce = %payment.nonce,
            expected_org = %payment.organization_id,
            actual_org = %org_id,
            "Payment nonce org mismatch — nonce invalidated"
        );
        return Err(AppError::Unauthorized(
            "Payment nonce belongs to different organization".to_string(),
        ));
    }

    // Check that the payment nonce was issued for this resource
    if !payment.resource.is_empty() && payment.resource != request_path {
        // Do NOT unclaim on resource mismatch for the same cross-org replay reason.
        tracing::warn!(
            nonce = %payment.nonce,
            expected_resource = %payment.resource,
            actual_resource = %request_path,
            "Payment nonce resource mismatch — nonce invalidated"
        );
        return Err(AppError::Unauthorized(
            "Payment challenge was issued for a different resource".to_string(),
        ));
    }

    // 2. Verify on-chain USDC transfer
    if let Err(e) = state
        .onchain_verifier
        .verify_usdc_transfer(
            &proof.tx_hash,
            &state.config.x402_wallet_address,
            &state.config.x402_usdc_address,
            u64::try_from(payment.amount_usdc)
                .map_err(|_| AppError::Internal("Invalid payment amount in DB".to_string()))?,
        )
        .await
    {
        tracing::warn!(
            nonce = %payment.nonce,
            tx_hash = %proof.tx_hash,
            "x402 on-chain verification failed: {}", e
        );
        // Roll back to pending: the tx may not be confirmed yet and the agent can retry.
        if let Err(ue) = state.payment_store.unclaim(&payment.nonce).await {
            tracing::error!(nonce = %payment.nonce, tx_hash = %proof.tx_hash, error = %ue, "Failed to unclaim nonce after on-chain verification failure");
        }
        return Err(AppError::PaymentRequired(
            "Payment verification failed. Ensure the transaction is confirmed on Base mainnet."
                .to_string(),
        ));
    }

    // 3a. Record tx_hash now (outside the transaction) so a crash between on-chain
    // verification and the commit below leaves a 'verified' row with a non-null tx_hash —
    // enough for operators to manually recover the grant. expire_old() will eventually
    // clean up any stuck 'verified' rows.
    sqlx::query("UPDATE agent_payments SET tx_hash = $1 WHERE nonce = $2 AND status = 'verified'")
        .bind(&proof.tx_hash)
        .bind(&payment.nonce)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to record tx_hash: {}", e)))?;

    // 3b. Begin DB transaction: capacity grant + mark_consumed are atomic.
    // If mark_consumed fails (e.g. tx_hash unique constraint), the grant rolls back too.
    let mut db_tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    // 4. For capacity grants: atomically increment org quota inside the transaction
    if payment.payment_type == "capacity_grant" {
        if let (Some(grant_type), Some(quantity)) = (&payment.grant_type, payment.grant_quantity) {
            apply_capacity_grant_in_tx(&mut db_tx, org_id, grant_type, quantity).await?;
        }
    }

    // 5. Mark consumed inside the same transaction, recording the verified tx_hash for audit.
    // The UNIQUE index on tx_hash prevents the same on-chain tx from satisfying two nonces.
    sqlx::query(
        "UPDATE agent_payments SET status = 'consumed', consumed_at = NOW(), tx_hash = $1 WHERE nonce = $2",
    )
    .bind(&proof.tx_hash)
    .bind(&payment.nonce)
    .execute(&mut *db_tx)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23505") {
                return AppError::Unauthorized(
                    "Transaction hash already used for another payment".to_string(),
                );
            }
        }
        AppError::Internal(format!("DB error: {}", e))
    })?;

    if let Err(e) = db_tx.commit().await {
        // The transaction rolled back — capacity was NOT granted but on-chain payment is real.
        // Log enough info for manual operator recovery.
        tracing::error!(
            nonce = %payment.nonce,
            tx_hash = %proof.tx_hash,
            org_id = %org_id,
            payment_type = %payment.payment_type,
            grant_type = ?payment.grant_type,
            grant_quantity = ?payment.grant_quantity,
            error = %e,
            "CRITICAL: x402 payment verified on-chain but DB commit failed. \
             Manual recovery required: apply capacity grant for this org."
        );
        return Err(AppError::Internal(
            "Payment was confirmed on-chain but could not be recorded. \
             Please contact support with your transaction hash for manual recovery."
                .to_string(),
        ));
    }

    // Build grant info for the extension (lets handlers skip a DB re-read for limit checks).
    let grant_info = if payment.payment_type == "capacity_grant" {
        payment
            .grant_type
            .as_ref()
            .zip(payment.grant_quantity)
            .map(|(grant_type, quantity)| X402CapacityGrantApplied {
                grant_type: grant_type.clone(),
                quantity,
            })
    } else {
        None
    };

    Ok((payment.payment_type, grant_info))
}

/// Atomically increments org's x402 capacity column inside an existing sqlx transaction.
pub async fn apply_capacity_grant_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: &str,
    grant_type: &str,
    quantity: i64,
) -> Result<(), AppError> {
    let qty_i32 = i32::try_from(quantity).map_err(|_| {
        AppError::Internal("Grant quantity exceeds maximum allowed value".to_string())
    })?;

    let rows = match grant_type {
        "project" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_projects = LEAST(x402_extra_projects + $1, 50) WHERE id = $2"
            )
            .bind(qty_i32)
            .bind(org_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
            .rows_affected()
        }
        "monitor" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_monitors = LEAST(x402_extra_monitors + $1, 100) WHERE id = $2"
            )
            .bind(qty_i32)
            .bind(org_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
            .rows_affected()
        }
        "storage_bytes" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_storage_bytes = LEAST(x402_extra_storage_bytes + $1, 107374182400) WHERE id = $2"
            )
            .bind(quantity)
            .bind(org_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
            .rows_affected()
        }
        "retention_days" => {
            sqlx::query(
                "UPDATE organizations SET x402_extra_retention_days = LEAST(x402_extra_retention_days + $1, 365) WHERE id = $2"
            )
            .bind(qty_i32)
            .bind(org_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
            .rows_affected()
        }
        _ => {
            return Err(AppError::Internal(format!(
                "Unknown grant_type: {}",
                grant_type
            )))
        }
    };

    if rows == 0 {
        return Err(AppError::Internal(format!(
            "Capacity grant failed: organization '{}' not found in database",
            org_id
        )));
    }

    Ok(())
}

/// Axum middleware: checks X-Payment header on every request.
/// - FeatureAccess: verifies, applies, and SHORT-CIRCUITS (skips tier guard)
/// - CapacityGrant: verifies, applies capacity to org, then FALLS THROUGH to handler
pub async fn x402_payment_middleware(state: AppState, req: Request<Body>, next: Next) -> Response {
    // Only process if x402 is enabled and X-Payment header is present
    if state.config.x402_enabled {
        if let Some(payment_header) = req.headers().get("X-Payment") {
            if let Ok(header_str) = payment_header.to_str() {
                if let Ok(proof) = decode_payment_proof(header_str) {
                    // Try to find org_id from request headers (X-API-Key agent auth)
                    // We look it up from the DB via the API key
                    // DB lookup only happens after X-Payment header is present AND decoded successfully
                    let request_path = req.uri().path().to_string();
                    // Extract the API key into an owned value BEFORE the await so the
                    // middleware future does not hold a `&Request<Body>` across it
                    // (`&Request<Body>` is not `Send`, which `Router::layer` requires).
                    let api_key = req
                        .headers()
                        .get("X-API-Key")
                        .or_else(|| req.headers().get("Authorization"))
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());
                    let org_id = match api_key.as_deref() {
                        Some(k) => get_org_id_from_api_key(&state, k).await,
                        None => None,
                    };
                    if let Some(org_id) = org_id {
                        match verify_and_apply_payment(&state, &proof, &org_id, &request_path).await
                        {
                            Ok((ref pt, _)) if pt == "feature_access" => {
                                // Feature payment verified: bypass tier checks
                                let mut req = req;
                                req.extensions_mut().insert(X402PaymentVerified);
                                return next.run(req).await;
                            }
                            Ok((ref pt, grant_info)) if pt == "capacity_grant" => {
                                // Capacity grant applied: attach grant info so the handler can
                                // skip a stale DB re-read for limit checks (H29-B).
                                let mut req = req;
                                if let Some(info) = grant_info {
                                    req.extensions_mut().insert(info);
                                }
                                return next.run(req).await;
                            }
                            Ok((ref pt, _)) => {
                                tracing::warn!(
                                    payment_type = %pt,
                                    "x402 payment verified with unrecognized payment_type; falling through to handler"
                                );
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

/// Inserted into request extensions when a capacity_grant payment was verified and applied.
/// Handlers can read this to avoid a second DB round-trip to check the newly-granted capacity.
#[derive(Clone)]
pub struct X402CapacityGrantApplied {
    pub grant_type: String,
    pub quantity: i64,
}

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
    match state
        .payment_store
        .create_feature_challenge(&nonce, org_id, agent_key_id, resource, feature, amount, 300)
        .await
    {
        Ok(_) => crate::AppError::PaymentRequiredWithChallenge {
            message: error_msg.to_string(),
            challenge: serde_json::json!(challenge),
        },
        Err(e) => {
            tracing::warn!(
                "Failed to persist x402 challenge for nonce {}: {}",
                nonce,
                e
            );
            crate::AppError::PaymentRequired(error_msg.to_string())
        }
    }
}

/// Extracts org_id from request using the X-API-Key agent auth header
async fn get_org_id_from_api_key(state: &AppState, api_key: &str) -> Option<String> {
    use crate::auth::agent::hash_agent_key;
    use crate::db::repositories::AgentKeyRepository;

    let key = api_key.trim_start_matches("Bearer ").trim();
    if !key.starts_with("bw_agent_") {
        return None;
    }

    let key_hash = hash_agent_key(key, state.config.jwt_secret.as_bytes());
    let agent_key = AgentKeyRepository::find_by_hash(&state.db, &key_hash)
        .await
        .ok()??;
    Some(agent_key.organization_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};

    fn b64(s: &str) -> String {
        STANDARD.encode(s.as_bytes())
    }

    #[test]
    fn valid_proof_decoded() {
        let encoded = b64(r#"{"nonce":"abc-123","tx_hash":"0xdeadbeef"}"#);
        let proof = decode_payment_proof(&encoded).unwrap();
        assert_eq!(proof.nonce, "abc-123");
        assert_eq!(proof.tx_hash, "0xdeadbeef");
    }

    #[test]
    fn invalid_base64_returns_error() {
        let err = decode_payment_proof("not!valid!base64!!!").unwrap_err();
        assert!(err.contains("Base64 decode failed"), "got: {}", err);
    }

    #[test]
    fn valid_base64_invalid_json_returns_error() {
        let err = decode_payment_proof(&b64("not json")).unwrap_err();
        assert!(err.contains("JSON parse failed"), "got: {}", err);
    }

    #[test]
    fn missing_tx_hash_field_returns_error() {
        let err = decode_payment_proof(&b64(r#"{"nonce":"only-nonce"}"#)).unwrap_err();
        assert!(err.contains("JSON parse failed"), "got: {}", err);
    }
}
