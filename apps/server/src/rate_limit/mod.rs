mod token_bucket;

pub use token_bucket::RateLimitResult;
use token_bucket::TokenBucket;

use dashmap::DashMap;
use std::sync::Arc;

use crate::billing::tiers::{self, Tier};
use crate::config::DeploymentMode;
use crate::db::{repositories::OrganizationRepository, DbPool};

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
    pub async fn check_with_tier_lookup(
        &self,
        api_key: &str,
        db: &DbPool,
        deployment_mode: DeploymentMode,
        config_rate_limit: u32,
    ) -> RateLimitResult {
        // Self-hosted mode: use the configured rate limit for all keys
        let rate_limit = if deployment_mode.is_self_hosted() {
            config_rate_limit
        } else {
            // SaaS mode: look up the tier from the database
            let tier = match OrganizationRepository::get_tier_by_api_key(db, api_key).await {
                Ok(tier_str) => Tier::from_str(&tier_str),
                Err(_) => Tier::Free,
            };
            tiers::get_tier_limits(tier).rate_limit_per_minute
        };

        self.check(api_key, rate_limit)
    }

    /// Check if a request should be allowed based on rate limits
    ///
    /// # Arguments
    /// * `key` - Unique identifier for the rate limit bucket (API key or project ID)
    /// * `rate_limit_per_minute` - The rate limit (events per minute)
    ///
    /// # Returns
    /// `RateLimitResult` indicating if the request is allowed and remaining quota
    pub fn check(&self, key: &str, rate_limit_per_minute: u32) -> RateLimitResult {
        let mut bucket = self.buckets.entry(key.to_string()).or_insert_with(|| {
            let burst_capacity = rate_limit_per_minute.min(1000); // Cap burst at 1000
            TokenBucket::new(burst_capacity, rate_limit_per_minute)
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
    fn test_tier_rate_limits_from_billing() {
        let free = tiers::get_tier_limits(Tier::Free);
        assert_eq!(free.rate_limit_per_minute, 100);

        let pro = tiers::get_tier_limits(Tier::Pro);
        assert_eq!(pro.rate_limit_per_minute, 1000);

        let team = tiers::get_tier_limits(Tier::Team);
        assert_eq!(team.rate_limit_per_minute, 5000);

        let enterprise = tiers::get_tier_limits(Tier::Enterprise);
        assert_eq!(enterprise.rate_limit_per_minute, 10000);
    }

    #[test]
    fn test_rate_limiter_allows_requests() {
        let limiter = RateLimiter::new();
        let free_limit = tiers::get_tier_limits(Tier::Free).rate_limit_per_minute;
        let result = limiter.check("test_key", free_limit);
        assert!(result.allowed);
    }

    #[test]
    fn test_rate_limiter_separate_buckets() {
        let limiter = RateLimiter::new();
        let free_limit = tiers::get_tier_limits(Tier::Free).rate_limit_per_minute;

        // Different keys should have separate buckets
        let result1 = limiter.check("key1", free_limit);
        let result2 = limiter.check("key2", free_limit);

        assert!(result1.allowed);
        assert!(result2.allowed);
        assert_eq!(result1.remaining, result2.remaining);
    }
}
