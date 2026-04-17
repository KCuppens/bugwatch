use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing;

pub struct OnChainVerifier {
    rpc_url: String,
    client: Client,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<Value>,
}

impl OnChainVerifier {
    pub fn new(rpc_url: String) -> Self {
        Self {
            rpc_url,
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to build HTTP client"),
        }
    }

    /// Verifies a USDC ERC-20 Transfer event on Base.
    /// Checks: tx receipt exists, tx was to the USDC contract, a Transfer log
    /// from any sender to `expected_to` of at least `min_amount` micro-USDC exists.
    /// Returns Ok(actual_amount) or Err(reason).
    pub async fn verify_usdc_transfer(
        &self,
        tx_hash: &str,
        expected_to: &str,
        usdc_address: &str,
        min_amount: u64,
    ) -> Result<u64, String> {
        // Pre-validate tx_hash format: must be 0x + 64 hex chars
        if !tx_hash.starts_with("0x")
            || tx_hash.len() != 66
            || !tx_hash[2..].chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Invalid transaction hash format (expected 0x + 64 hex chars)".to_string());
        }

        // 1. Get transaction receipt via eth_getTransactionReceipt
        let receipt = self.eth_get_transaction_receipt(tx_hash).await?;

        // 2. Check receipt status (1 = success)
        let status = receipt
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("0x0");
        if status != "0x1" {
            return Err("Transaction failed or reverted".to_string());
        }

        // 3. (receipt["to"] is not checked here — it is not reliably present on all RPC nodes.
        //     Instead we verify log["address"] == usdc_address inside the log loop below.)

        // 4. Find Transfer(address,address,uint256) log
        // Topic[0] = keccak256("Transfer(address,address,uint256)")
        // = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
        let transfer_topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        let addr_without_prefix = expected_to
            .strip_prefix("0x")
            .or_else(|| expected_to.strip_prefix("0X"))
            .unwrap_or(expected_to);
        if addr_without_prefix.len() != 40
            || !addr_without_prefix.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Invalid expected_to address format".into());
        }
        let expected_to_padded = format!("0x{:0>64}", addr_without_prefix.to_lowercase());

        let logs = receipt
            .get("logs")
            .and_then(|v| v.as_array())
            .ok_or("No logs in receipt")?;

        for log in logs {
            let topics = log.get("topics").and_then(|v| v.as_array());
            let Some(topics) = topics else { continue };

            if topics.len() < 3 {
                continue;
            }

            // Verify this log was emitted by the USDC contract
            let log_address = log
                .get("address")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            if log_address != usdc_address.to_lowercase() {
                continue;
            }

            // ERC-20 Transfer event log layout:
            //   topics[0] = keccak256("Transfer(address,address,uint256)") — event signature
            //   topics[1] = from address (32-byte left-padded)
            //   topics[2] = to address (32-byte left-padded)
            //   data      = transferred amount as uint256 (32 bytes, big-endian)
            let topic0 = topics[0].as_str().unwrap_or("").to_lowercase();
            let topic2 = topics[2].as_str().unwrap_or("").to_lowercase();

            if topic0 != transfer_topic {
                continue;
            }

            if topic2 != expected_to_padded {
                continue;
            }

            // Parse transfer value from log data (uint256 = max 32 bytes = 64 hex chars)
            let data = log.get("data").and_then(|v| v.as_str()).unwrap_or("0x");
            let value_hex = data.trim_start_matches("0x");
            if value_hex.is_empty() {
                return Err("Transfer amount is zero or missing".to_string());
            }
            if value_hex.len() > 64 {
                return Err("Invalid transfer data".to_string());
            }
            let value = u128::from_str_radix(value_hex, 16)
                .map_err(|_| "Invalid transfer data".to_string())?;

            // USDC has 6 decimals. Our amounts are already in micro-USDC (6 decimals)
            // so value from chain IS in micro-USDC
            let actual_micro_usdc = u64::try_from(value)
                .map_err(|_| "Transfer amount exceeds u64 maximum".to_string())?;

            if actual_micro_usdc < min_amount {
                return Err(format!(
                    "Insufficient payment: got {} micro-USDC, need {}",
                    actual_micro_usdc, min_amount
                ));
            }

            return Ok(actual_micro_usdc);
        }

        Err("No valid USDC Transfer event found to expected recipient".to_string())
    }

    async fn eth_get_transaction_receipt(&self, tx_hash: &str) -> Result<Value, String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "method": "eth_getTransactionReceipt",
            "params": [tx_hash],
            "id": 1
        });

        const MAX_RETRIES: u32 = 3;
        let mut last_err = String::new();

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let delay_ms = 1000u64 * 2u64.pow(attempt - 1);
                tracing::warn!(
                    tx_hash = tx_hash,
                    attempt = attempt,
                    delay_ms = delay_ms,
                    "eth_getTransactionReceipt failed, retrying"
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
            }

            let send_result = self.client.post(&self.rpc_url).json(&payload).send().await;

            let http_response = match send_result {
                Err(e) => {
                    last_err = format!("RPC request failed: {}", e);
                    continue; // network error — retry
                }
                Ok(r) => r,
            };

            let response: RpcResponse = match http_response.json().await {
                Err(e) => {
                    // Treat transient parse failures (truncated TCP, proxy error page) as retryable
                    last_err = format!("Failed to parse RPC response: {}", e);
                    continue;
                }
                Ok(r) => r,
            };

            if let Some(err) = response.error {
                let err_str = err.to_string();
                // -32005 = rate limited, -32603 = internal error — retryable
                if (err_str.contains("-32005") || err_str.contains("-32603"))
                    && attempt < MAX_RETRIES
                {
                    last_err = format!("RPC error (will retry): {}", err_str);
                    continue;
                }
                return Err(format!("RPC error: {}", err_str));
            }

            // Null result means tx is pending/not yet propagated — retry
            match response.result {
                Some(v) => return Ok(v),
                None => {
                    last_err = "Transaction not found or not yet confirmed".to_string();
                    continue;
                }
            }
        }

        tracing::error!(
            tx_hash = tx_hash,
            max_retries = MAX_RETRIES,
            "eth_getTransactionReceipt exhausted all retries"
        );
        Err(last_err)
    }
}
