pub mod crypto;

use crate::AppError;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Validate that a monitor URL is safe (no SSRF to internal networks)
pub fn validate_monitor_url(url_str: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url_str)
        .map_err(|_| AppError::BadRequest("Invalid URL format".to_string()))?;

    // Require http or https scheme
    match parsed.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(AppError::BadRequest(
                "URL must use http or https scheme".to_string(),
            ))
        }
    }

    // Get the host
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::BadRequest("URL must have a host".to_string()))?;

    // Block localhost and loopback
    let blocked_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"];
    if blocked_hosts.iter().any(|&h| host.eq_ignore_ascii_case(h)) {
        return Err(AppError::BadRequest(
            "URL cannot target localhost or loopback addresses".to_string(),
        ));
    }

    // Try to parse as IP and block private/reserved ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let is_blocked = match ip {
            std::net::IpAddr::V4(ipv4) => {
                ipv4.is_loopback()           // 127.0.0.0/8
                || ipv4.is_private()         // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || ipv4.is_link_local()      // 169.254.0.0/16
                || ipv4.is_unspecified()     // 0.0.0.0
                || ipv4.octets()[0] == 169 && ipv4.octets()[1] == 254 // link-local / cloud metadata
            }
            std::net::IpAddr::V6(ipv6) => ipv6.is_loopback() || ipv6.is_unspecified(),
        };
        if is_blocked {
            return Err(AppError::BadRequest(
                "URL cannot target private, loopback, or link-local addresses".to_string(),
            ));
        }
    }

    // Block well-known cloud metadata endpoints
    if host == "169.254.169.254" || host == "metadata.google.internal" {
        return Err(AppError::BadRequest(
            "URL cannot target cloud metadata endpoints".to_string(),
        ));
    }

    Ok(())
}

// ============================================================================
// Circuit Breaker
// ============================================================================

/// Lightweight circuit breaker for external service calls.
///
/// States:
/// - Closed: requests flow through normally
/// - Open: requests are rejected immediately (service assumed down)
/// - HalfOpen: one probe request allowed to test recovery
///
/// A per-open-event jitter (0–20s) is applied to the reset window so that
/// multiple instances don't all probe the external service at exactly the
/// same instant (thundering herd prevention).
pub struct CircuitBreaker {
    name: String,
    failure_threshold: u32,
    reset_timeout_secs: u64,
    failure_count: AtomicU32,
    last_failure_at: AtomicU64,
    /// Jitter offset (0–20s) sampled when the circuit first opens.
    /// Stored so it stays stable across repeated `allow_request` checks
    /// within the same open episode.
    open_jitter_secs: AtomicU64,
    state: AtomicU32, // 0=Closed, 1=Open, 2=HalfOpen
}

const CB_CLOSED: u32 = 0;
const CB_OPEN: u32 = 1;
const CB_HALF_OPEN: u32 = 2;

impl CircuitBreaker {
    pub fn new(name: &str, failure_threshold: u32, reset_timeout_secs: u64) -> Self {
        Self {
            name: name.to_string(),
            failure_threshold,
            reset_timeout_secs,
            failure_count: AtomicU32::new(0),
            last_failure_at: AtomicU64::new(0),
            open_jitter_secs: AtomicU64::new(0),
            state: AtomicU32::new(CB_CLOSED),
        }
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Check if a request is allowed. Returns false if the circuit is open.
    pub fn allow_request(&self) -> bool {
        let state = self.state.load(Ordering::Relaxed);
        match state {
            CB_CLOSED => true,
            CB_OPEN => {
                let last_failure = self.last_failure_at.load(Ordering::Relaxed);
                let jitter = self.open_jitter_secs.load(Ordering::Relaxed);
                let elapsed = Self::now_secs().saturating_sub(last_failure);
                if elapsed >= self.reset_timeout_secs + jitter {
                    // Try half-open
                    self.state
                        .compare_exchange(
                            CB_OPEN,
                            CB_HALF_OPEN,
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        )
                        .ok();
                    true
                } else {
                    false
                }
            }
            CB_HALF_OPEN => true, // Allow probe request
            _ => true,
        }
    }

    /// Record a successful call.
    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
        self.state.store(CB_CLOSED, Ordering::Relaxed);
    }

    /// Record a failed call.
    pub fn record_failure(&self) {
        let count = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
        self.last_failure_at
            .store(Self::now_secs(), Ordering::Relaxed);
        if count >= self.failure_threshold {
            let prev = self.state.swap(CB_OPEN, Ordering::Relaxed);
            if prev != CB_OPEN {
                // Sample jitter once per open-episode (0–20s) so all concurrent
                // callers see the same window but different instances/pods differ.
                let jitter = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_nanos() as u64
                    % 21;
                self.open_jitter_secs.store(jitter, Ordering::Relaxed);
                tracing::warn!(
                    reset_in_secs = self.reset_timeout_secs + jitter,
                    "Circuit breaker '{}' opened after {} failures",
                    self.name,
                    count
                );
            }
        }
    }

    /// Check if the circuit is currently open (for logging purposes).
    pub fn is_open(&self) -> bool {
        self.state.load(Ordering::Relaxed) == CB_OPEN
    }
}
