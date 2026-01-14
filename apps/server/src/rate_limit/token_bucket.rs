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
        let now = Instant::now();
        Self {
            capacity,
            tokens: capacity as f64,
            refill_rate: refill_rate_per_minute as f64 / 60.0, // Convert to per-second
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
}
