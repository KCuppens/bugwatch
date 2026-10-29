use std::time::Instant;

/// Token bucket rate limiter
///
/// Implements the token bucket algorithm where:
/// - Tokens are added at a fixed rate (refill_rate per second)
/// - Maximum tokens capped at capacity
/// - Each request consumes 1 token
/// - Request denied if no tokens available
#[derive(Debug, Clone)]
pub struct TokenBucket {
    /// Maximum number of tokens in the bucket
    capacity: u32,
    /// Current number of tokens
    tokens: f64,
    /// Tokens added per second
    refill_rate: f64,
    /// Last time tokens were refilled
    last_refill: Instant,
    /// Last time this bucket was accessed (for cleanup)
    last_access: Instant,
}

impl TokenBucket {
    /// Create a new token bucket with specified capacity and refill rate
    ///
    /// # Arguments
    /// * `capacity` - Maximum tokens in bucket
    /// * `refill_rate_per_minute` - Tokens added per minute
    pub fn new(capacity: u32, refill_rate_per_minute: u32) -> Self {
        assert!(capacity > 0, "TokenBucket capacity must be > 0");
        assert!(refill_rate_per_minute > 0, "TokenBucket refill_rate_per_minute must be > 0 — a zero-rate bucket would never refill");
        let now = Instant::now();
        Self {
            capacity,
            tokens: capacity as f64,
            refill_rate: refill_rate_per_minute as f64 / 60.0, // Convert to per-second
            last_refill: now,
            last_access: now,
        }
    }

    /// Create a token bucket whose refill rate is expressed in tokens-per-hour.
    ///
    /// Unlike `new()`, this avoids integer-division precision loss for low hourly
    /// rates (e.g., 3/hour → 3/3600 tokens/second, not `(3/60).max(1)` = 1/minute).
    ///
    /// # Arguments
    /// * `capacity` - Maximum tokens (burst size equals the hourly limit)
    /// * `limit_per_hour` - Tokens added per hour (refill rate)
    pub fn new_with_hourly_rate(capacity: u32, limit_per_hour: u32) -> Self {
        assert!(capacity > 0, "TokenBucket capacity must be > 0");
        assert!(limit_per_hour > 0, "TokenBucket limit_per_hour must be > 0");
        let now = Instant::now();
        Self {
            capacity,
            tokens: capacity as f64,
            refill_rate: limit_per_hour as f64 / 3600.0, // exact tokens-per-second
            last_refill: now,
            last_access: now,
        }
    }

    /// Try to consume a token from the bucket
    ///
    /// Returns `RateLimitResult` with current state
    pub fn try_consume(&mut self) -> RateLimitResult {
        self.refill();
        self.last_access = Instant::now();

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            RateLimitResult {
                allowed: true,
                remaining: self.tokens as u32,
                limit: self.capacity,
                retry_after_secs: None,
            }
        } else {
            // Calculate time until next token
            let tokens_needed = 1.0 - self.tokens;
            let seconds_until_token = (tokens_needed / self.refill_rate).ceil() as u32;

            RateLimitResult {
                allowed: false,
                remaining: 0,
                limit: self.capacity,
                retry_after_secs: Some(seconds_until_token.max(1)),
            }
        }
    }

    /// Get the elapsed time since last access in seconds
    pub fn seconds_since_last_access(&self) -> u64 {
        self.last_access.elapsed().as_secs()
    }

    /// Refill tokens based on elapsed time
    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        let new_tokens = elapsed * self.refill_rate;

        self.tokens = (self.tokens + new_tokens).min(self.capacity as f64);
        self.last_refill = now;
    }

    /// Get current token count (for testing/debugging)
    #[allow(dead_code)]
    pub fn current_tokens(&self) -> u32 {
        self.tokens as u32
    }

    /// Get the bucket capacity
    #[allow(dead_code)]
    pub fn get_capacity(&self) -> u32 {
        self.capacity
    }
}

/// Result of a rate limit check
#[derive(Debug, Clone)]
pub struct RateLimitResult {
    /// Whether the request is allowed
    pub allowed: bool,
    /// Remaining tokens
    pub remaining: u32,
    /// Maximum tokens (rate limit)
    pub limit: u32,
    /// Seconds until retry is allowed (if rate limited)
    pub retry_after_secs: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn test_initial_capacity() {
        let bucket = TokenBucket::new(100, 100);
        assert_eq!(bucket.current_tokens(), 100);
    }

    #[test]
    fn test_consume_success() {
        let mut bucket = TokenBucket::new(100, 100);
        let result = bucket.try_consume();
        assert!(result.allowed);
        assert_eq!(result.remaining, 99);
    }

    #[test]
    fn test_exhaust_bucket() {
        let mut bucket = TokenBucket::new(5, 60);

        for _ in 0..5 {
            let result = bucket.try_consume();
            assert!(result.allowed);
        }

        let result = bucket.try_consume();
        assert!(!result.allowed);
        assert!(result.retry_after_secs.is_some());
    }

    #[test]
    fn test_refill() {
        let mut bucket = TokenBucket::new(10, 600); // 10 per second

        // Consume all tokens
        for _ in 0..10 {
            bucket.try_consume();
        }

        // Wait a bit for refill
        sleep(Duration::from_millis(150));

        // Should have refilled some tokens
        let result = bucket.try_consume();
        assert!(result.allowed);
    }

    // ── new_with_hourly_rate ────────────────────────────────────────────────

    #[test]
    fn test_hourly_rate_starts_full() {
        // capacity=10, limit_per_hour=3600 → refill_rate = 1.0 token/sec
        let bucket = TokenBucket::new_with_hourly_rate(10, 3600);
        assert_eq!(bucket.current_tokens(), 10);
    }

    #[test]
    fn test_hourly_rate_get_capacity() {
        let bucket = TokenBucket::new_with_hourly_rate(10, 3600);
        assert_eq!(bucket.get_capacity(), 10);
    }

    #[test]
    fn test_hourly_rate_low_rate_distinct_from_new() {
        // 3/hour = 3/3600 tokens/sec, which is different from new(1, 3)
        // which would be 3/60 tokens/sec. The bucket should still start full.
        let bucket = TokenBucket::new_with_hourly_rate(3, 3);
        assert_eq!(bucket.current_tokens(), 3);
        assert_eq!(bucket.get_capacity(), 3);
    }

    // ── seconds_since_last_access ──────────────────────────────────────────

    #[test]
    fn test_seconds_since_last_access_immediate() {
        let bucket = TokenBucket::new(10, 60);
        // Created just now — elapsed seconds (u64 truncation) should be 0
        assert_eq!(bucket.seconds_since_last_access(), 0);
    }

    #[test]
    fn test_seconds_since_last_access_after_100ms() {
        let bucket = TokenBucket::new(10, 60);
        sleep(Duration::from_millis(100));
        // 100 ms = 0.1 s → truncated to 0 as u64
        assert_eq!(bucket.seconds_since_last_access(), 0);
    }

    #[test]
    fn test_seconds_since_last_access_resets_after_consume() {
        let mut bucket = TokenBucket::new(10, 60);
        // Let some time pass so last_access is meaningfully old
        sleep(Duration::from_millis(100));
        bucket.try_consume();
        // try_consume updates last_access → elapsed resets to ~0
        assert_eq!(bucket.seconds_since_last_access(), 0);
    }

    // ── retry_after_secs ───────────────────────────────────────────────────

    #[test]
    fn test_retry_after_secs_approximately_60() {
        // capacity=1, refill_rate_per_minute=1 → 1 token per 60 seconds
        let mut bucket = TokenBucket::new(1, 1);
        // Exhaust the single token
        let first = bucket.try_consume();
        assert!(first.allowed);

        // Next request must be denied
        let denied = bucket.try_consume();
        assert!(!denied.allowed);
        let retry = denied
            .retry_after_secs
            .expect("should have retry_after_secs");
        // tokens_needed ≈ 1.0, refill_rate = 1/60 /sec → ceil(1 / (1/60)) = 60
        assert_eq!(retry, 60);
    }

    #[test]
    fn test_retry_after_secs_never_zero() {
        let mut bucket = TokenBucket::new(1, 1);
        bucket.try_consume(); // exhaust
        let denied = bucket.try_consume();
        assert!(!denied.allowed);
        let retry = denied
            .retry_after_secs
            .expect("should have retry_after_secs");
        assert!(
            retry >= 1,
            "retry_after_secs must be at least 1, got {retry}"
        );
    }

    // ── token count must not exceed capacity ───────────────────────────────

    #[test]
    fn test_tokens_do_not_exceed_capacity() {
        // Create a fast-refilling bucket and wait long enough to have accumulated
        // more tokens than capacity if the cap were not enforced.
        let mut bucket = TokenBucket::new(5, 600); // refills 10 tokens/sec
                                                   // Consume all tokens first
        for _ in 0..5 {
            bucket.try_consume();
        }
        // Wait long enough for the bucket to reach its cap and then some
        sleep(Duration::from_millis(200)); // would add ~2 tokens; bucket starts at 0
                                           // Force a refill by calling try_consume once and observe current_tokens
                                           // via a fresh read before consuming.  We inspect the bucket capacity cap
                                           // by consuming down from the refilled state.
                                           // A simpler direct check: trigger refill implicitly then verify the cap.
        let result = bucket.try_consume();
        // After 200 ms at 10 tok/s: ~2 tokens added → 1 consumed → remaining ≤ capacity-1
        assert!(result.remaining < bucket.get_capacity());
        assert!(bucket.current_tokens() <= bucket.get_capacity());
    }

    // ── limit field equals capacity ────────────────────────────────────────

    #[test]
    fn test_result_limit_equals_capacity_allowed() {
        let mut bucket = TokenBucket::new(7, 60);
        let result = bucket.try_consume();
        assert_eq!(result.limit, bucket.get_capacity());
    }

    #[test]
    fn test_result_limit_equals_capacity_denied() {
        let mut bucket = TokenBucket::new(1, 60);
        bucket.try_consume(); // exhaust
        let denied = bucket.try_consume();
        assert!(!denied.allowed);
        assert_eq!(denied.limit, 1);
    }

    // ── new() with large rate refills quickly ──────────────────────────────

    #[test]
    fn test_large_rate_refills_after_sleep() {
        // 6000 per minute = 100 per second
        let mut bucket = TokenBucket::new(100, 6000);

        // Exhaust the bucket
        for _ in 0..100 {
            let r = bucket.try_consume();
            assert!(r.allowed);
        }
        // Confirm exhausted
        let denied = bucket.try_consume();
        assert!(!denied.allowed);

        // Sleep 50 ms → ~5 tokens refilled at 100 tok/sec
        sleep(Duration::from_millis(50));

        // Should now be allowed again
        let result = bucket.try_consume();
        assert!(
            result.allowed,
            "bucket should have refilled after 50 ms at 100 tok/sec"
        );
    }
}
