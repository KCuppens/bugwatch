mod token_bucket;

pub use token_bucket::RateLimitResult;
use token_bucket::TokenBucket;

use dashmap::DashMap;
use std::sync::Arc;

use crate::db::{repositories::OrganizationRepository, DbPool};

/// Tier-based rate limits (events per minute)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    /// Free tier: 5 events/minute (hobby projects, evaluation)
    Free,
    /// Pro tier: 60 events/minute (small startups, indie developers)
    Pro,
    /// Team tier: 300 events/minute (growing startups, SMBs)
    Team,
    /// Enterprise tier: 3,000 events/minute (large companies)
    Enterprise,
}

impl Tier {
    /// Get the rate limit (events per minute) for this tier
    pub fn rate_limit(&self) -> u32 {
        match self {
            Tier::Free => 5,
            Tier::Pro => 60,
            Tier::Team => 300,
            Tier::Enterprise => 3_000,
        }
    }

    /// Parse tier from string (database value)
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "pro" => Tier::Pro,
            "team" => Tier::Team,
            "enterprise" => Tier::Enterprise,
            _ => Tier::Free,
        }
    }
}

/// Thread-safe rate limiter using token bucket algorithm
///
/// Maintains separate buckets per key (typically API key or project ID)
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<DashMap<String, TokenBucket>>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    /// Create a new rate limiter
    pub fn new() -> Self {
        Self {
            buckets: Arc::new(DashMap::new()),
        }
    }

    /// Check if a request should be allowed, looking up tier from database
    ///
    /// This method queries the database to get the organization's tier based on the API key,
    /// then applies the appropriate rate limit.
    ///
    /// # Arguments
    /// * `api_key` - The project API key
    /// * `db` - Database connection pool
    ///
    /// # Returns
    /// `RateLimitResult` indicating if the request is allowed and remaining quota
    pub async fn check_with_tier_lookup(&self, api_key: &str, db: &DbPool) -> RateLimitResult {
        // Look up the tier from the database
        let tier = match OrganizationRepository::get_tier_by_api_key(db, api_key).await {
            Ok(tier_str) => Tier::from_str(&tier_str),
            Err(_) => Tier::Free, // Default to free tier on error
        };

        self.check(api_key, tier)
    }

    /// Check if a request should be allowed based on rate limits
    ///
    /// # Arguments
    /// * `key` - Unique identifier for the rate limit bucket (API key or project ID)
    /// * `tier` - The tier determining the rate limit
    ///
    /// # Returns
    /// `RateLimitResult` indicating if the request is allowed and remaining quota
    pub fn check(&self, key: &str, tier: Tier) -> RateLimitResult {
        let rate_limit = tier.rate_limit();

        let mut bucket = self.buckets.entry(key.to_string()).or_insert_with(|| {
            // Allow burst up to 2x the per-minute rate, but rate limited to tier.rate_limit/min
            let burst_capacity = rate_limit.min(1000); // Cap burst at 1000
            TokenBucket::new(burst_capacity, rate_limit)
        });

        bucket.try_consume()
    }

    /// Get current stats for a key (for debugging/monitoring)
    #[allow(dead_code)]
    pub fn get_stats(&self, key: &str) -> Option<(u32, u32)> {
        self.buckets.get(key).map(|bucket| {
            let result = RateLimitResult {
                allowed: true,
                remaining: bucket.current_tokens(),
                limit: bucket.current_tokens(), // This is a simplified view
                retry_after_secs: None,
            };
            (result.remaining, result.limit)
        })
    }

    /// Remove expired/inactive buckets (cleanup)
    /// Should be called periodically to prevent memory growth
    ///
    /// # Arguments
    /// * `max_age_secs` - Remove buckets that haven't been accessed in this many seconds
    ///
    /// # Returns
    /// Number of buckets removed
    pub fn cleanup_inactive(&self, max_age_secs: u64) -> usize {
        let mut removed = 0;
        let keys_to_remove: Vec<String> = self
            .buckets
            .iter()
            .filter(|entry| entry.value().seconds_since_last_access() > max_age_secs)
            .map(|entry| entry.key().clone())
            .collect();

        for key in keys_to_remove {
            self.buckets.remove(&key);
            removed += 1;
        }

        removed
    }

    /// Get the current number of buckets (for monitoring)
    pub fn bucket_count(&self) -> usize {
        self.buckets.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_rate_limits() {
        assert_eq!(Tier::Free.rate_limit(), 5);
        assert_eq!(Tier::Pro.rate_limit(), 60);
        assert_eq!(Tier::Team.rate_limit(), 300);
        assert_eq!(Tier::Enterprise.rate_limit(), 3_000);
    }

    #[test]
    fn test_tier_from_str() {
        assert_eq!(Tier::from_str("free"), Tier::Free);
        assert_eq!(Tier::from_str("pro"), Tier::Pro);
        assert_eq!(Tier::from_str("Pro"), Tier::Pro);
        assert_eq!(Tier::from_str("enterprise"), Tier::Enterprise);
        assert_eq!(Tier::from_str("unknown"), Tier::Free);
    }

    #[test]
    fn test_rate_limiter_allows_requests() {
        let limiter = RateLimiter::new();
        let result = limiter.check("test_key", Tier::Free);
        assert!(result.allowed);
    }

    #[test]
    fn test_rate_limiter_separate_buckets() {
        let limiter = RateLimiter::new();

        // Different keys should have separate buckets
        let result1 = limiter.check("key1", Tier::Free);
        let result2 = limiter.check("key2", Tier::Free);

        assert!(result1.allowed);
        assert!(result2.allowed);
        // Both should have similar remaining (accounting for the one consumed)
        assert_eq!(result1.remaining, result2.remaining);
    }
}
