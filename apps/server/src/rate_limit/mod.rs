mod token_bucket;

pub use token_bucket::RateLimitResult;
use token_bucket::TokenBucket;

use dashmap::DashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use crate::billing::tiers::{self, Tier};
use crate::config::DeploymentMode;
use crate::db::{repositories::OrganizationRepository, DbPool};

// 60s TTL ensures tier upgrades take effect within 1 minute without requiring
// explicit cache invalidation on every billing code path.
const TIER_CACHE_TTL: Duration = Duration::from_secs(60);

fn tier_cache() -> &'static DashMap<String, (u32, Instant)> {
    static CACHE: OnceLock<DashMap<String, (u32, Instant)>> = OnceLock::new();
    CACHE.get_or_init(DashMap::new)
}

/// Thread-safe rate limiter using token bucket algorithm
///
/// Maintains separate buckets per key (typically API key or project ID).
/// Per-minute and per-hour buckets live in separate DashMaps so that
/// the hourly cleanup pass (`cleanup_inactive`) never evicts hourly buckets
/// (which would reset the counter and allow rate-limit bypass).
#[derive(Clone)]
pub struct RateLimiter {
    /// Per-minute token buckets (auth IPs, API keys, …)
    buckets: Arc<DashMap<String, TokenBucket>>,
    /// Per-hour token buckets (password reset per email, …).
    /// Uses a 4-hour inactivity TTL in cleanup so counters are not reset within the hour.
    hourly_buckets: Arc<DashMap<String, TokenBucket>>,
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
            hourly_buckets: Arc::new(DashMap::new()),
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
            // SaaS mode: check tier cache first, then DB
            if let Some(entry) = tier_cache().get(api_key) {
                let (cached_limit, inserted_at) = entry.value();
                if inserted_at.elapsed() < TIER_CACHE_TTL {
                    *cached_limit
                } else {
                    drop(entry);
                    let limit = Self::resolve_tier_limit(db, api_key).await;
                    tier_cache().insert(api_key.to_string(), (limit, Instant::now()));
                    limit
                }
            } else {
                let limit = Self::resolve_tier_limit(db, api_key).await;
                // Use or_insert to avoid overwriting a value that a concurrent request
                // may have already inserted while we were awaiting the DB query.
                tier_cache()
                    .entry(api_key.to_string())
                    .or_insert((limit, Instant::now()));
                limit
            }
        };

        self.check(api_key, rate_limit)
    }

    async fn resolve_tier_limit(db: &DbPool, api_key: &str) -> u32 {
        let tier = match OrganizationRepository::get_tier_by_api_key(db, api_key).await {
            Ok(tier_str) => Tier::from_str(&tier_str),
            Err(_) => Tier::Free,
        };
        tiers::get_tier_limits(tier).rate_limit_per_minute
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

    /// Check if a request should be allowed with an hourly rate limit.
    ///
    /// Useful for low-frequency operations (e.g. password reset: 3/hour per email).
    ///
    /// Hourly buckets are stored in a **separate** DashMap from per-minute buckets so that
    /// `cleanup_inactive` (called hourly) does not evict them and reset the counter within
    /// the window — which would allow rate-limit bypass via bucket eviction.
    ///
    /// # Arguments
    /// * `key` - Unique identifier for the rate limit bucket
    /// * `limit_per_hour` - The rate limit (requests per hour); **only honoured on the
    ///   first call for a given key** — subsequent calls reuse the existing bucket regardless
    ///   of the value passed. Always call with the same limit for a given key.
    pub fn check_hourly(&self, key: &str, limit_per_hour: u32) -> RateLimitResult {
        let mut bucket = self
            .hourly_buckets
            .entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(limit_per_hour, (limit_per_hour / 60).max(1)));
        bucket.try_consume()
    }

    /// Get current stats for a key (for debugging/monitoring).
    /// Returns `(remaining_tokens, capacity)`.
    #[allow(dead_code)]
    pub fn get_stats(&self, key: &str) -> Option<(u32, u32)> {
        self.buckets
            .get(key)
            .map(|bucket| (bucket.current_tokens(), bucket.get_capacity()))
    }

    /// Remove expired/inactive per-minute buckets to prevent memory growth.
    /// Should be called periodically (e.g. hourly). Does NOT touch hourly buckets
    /// — use `cleanup_hourly_inactive` for those (with a longer TTL).
    ///
    /// # Arguments
    /// * `max_age_secs` - Remove buckets that haven't been accessed in this many seconds
    ///
    /// # Returns
    /// Number of buckets removed
    pub fn cleanup_inactive(&self, max_age_secs: u64) -> usize {
        let keys_to_remove: Vec<String> = self
            .buckets
            .iter()
            .filter(|entry| entry.value().seconds_since_last_access() > max_age_secs)
            .map(|entry| entry.key().clone())
            .collect();

        let removed = keys_to_remove.len();
        for key in keys_to_remove {
            self.buckets.remove(&key);
        }
        removed
    }

    /// Remove expired/inactive per-hour buckets. Uses a longer TTL than `cleanup_inactive`
    /// (at least 2× the refill window, e.g. 4 hours) so that hourly counters are not reset
    /// mid-window.
    ///
    /// # Arguments
    /// * `max_age_secs` - Remove hourly buckets that haven't been accessed in this many seconds;
    ///   should be ≥ 7200 (2 hours) to prevent mid-window eviction for a 1-hour refill window.
    ///
    /// # Returns
    /// Number of buckets removed
    pub fn cleanup_hourly_inactive(&self, max_age_secs: u64) -> usize {
        let keys_to_remove: Vec<String> = self
            .hourly_buckets
            .iter()
            .filter(|entry| entry.value().seconds_since_last_access() > max_age_secs)
            .map(|entry| entry.key().clone())
            .collect();

        let removed = keys_to_remove.len();
        for key in keys_to_remove {
            self.hourly_buckets.remove(&key);
        }
        removed
    }

    /// Get the current number of per-minute buckets (for monitoring)
    pub fn bucket_count(&self) -> usize {
        self.buckets.len()
    }

    /// Get the current number of per-hour buckets (for monitoring)
    #[allow(dead_code)]
    pub fn hourly_bucket_count(&self) -> usize {
        self.hourly_buckets.len()
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
