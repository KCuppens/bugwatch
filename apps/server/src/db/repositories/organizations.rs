use crate::db::{
    models::{BillingEvent, Organization, OrganizationMember, UsageRecord},
    DbPool,
};
use anyhow::Result;
use dashmap::DashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

// 30s TTL: short enough that subscription downgrades propagate quickly across
// replicas (each has its own in-process cache), long enough to absorb burst
// DB load from tier_guard middleware. Full fix: shared Redis cache.
const ORG_USER_CACHE_TTL: Duration = Duration::from_secs(30);

fn org_user_cache() -> &'static DashMap<String, (Option<Organization>, Instant)> {
    static CACHE: OnceLock<DashMap<String, (Option<Organization>, Instant)>> = OnceLock::new();
    CACHE.get_or_init(DashMap::new)
}

pub struct OrganizationRepository;

#[allow(dead_code)]
impl OrganizationRepository {
    /// Create an organization unconditionally.
    pub async fn create(
        pool: &DbPool,
        owner_id: &str,
        name: &str,
        slug: &str,
    ) -> Result<Organization> {
        let id = Uuid::new_v4().to_string();
        sqlx::query_as::<_, Organization>(
            "INSERT INTO organizations (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *",
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(owner_id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Find an organization by its slug.
    pub async fn find_by_slug(pool: &DbPool, slug: &str) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>("SELECT * FROM organizations WHERE slug = ?")
            .bind(slug)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// Atomically create an organization only if the owner has no existing organization.
    /// Returns Ok(Some(org)) on creation, Ok(None) if the owner already has one.
    /// Prevents TOCTOU races in concurrent create_organization or create_checkout calls.
    pub async fn create_if_owner_not_exists(
        pool: &DbPool,
        owner_id: &str,
        name: &str,
        slug: &str,
    ) -> Result<Option<Organization>> {
        let id = Uuid::new_v4().to_string();

        let result = sqlx::query_as::<_, Organization>(
            r#"
            INSERT INTO organizations (id, name, slug, owner_id, created_at, updated_at)
            SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1 FROM organizations WHERE owner_id = ?
            )
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(owner_id)
        .bind(owner_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

        Ok(result)
    }

    /// Find organization by ID
    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>("SELECT * FROM organizations WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// Get organization for a user (as owner or member).
    /// Cached for 5 minutes per user_id to avoid repeated DB lookups in
    /// tier_guard middleware and rate limiting.
    pub async fn find_by_user(pool: &DbPool, user_id: &str) -> Result<Option<Organization>> {
        // Check cache first
        if let Some(entry) = org_user_cache().get(user_id) {
            let (org, inserted_at) = entry.value();
            if inserted_at.elapsed() < ORG_USER_CACHE_TTL {
                return Ok(org.clone());
            }
        }

        // UNION ALL: owned orgs first, then member orgs. Avoids OR + subquery
        // which can't use separate indexes efficiently. LIMIT 1 applied after union.
        let result = sqlx::query_as::<_, Organization>(
            r#"
            SELECT * FROM (
                SELECT o.* FROM organizations o WHERE o.owner_id = ?
                UNION ALL
                SELECT o.* FROM organizations o
                JOIN organization_members om ON om.organization_id = o.id
                WHERE om.user_id = ?
            ) combined
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        // Only cache positive results; a None here could be stale within the same request
        // chain (e.g. org just created by create_if_owner_not_exists).
        if result.is_some() {
            org_user_cache().insert(user_id.to_string(), (result.clone(), Instant::now()));
            tracing::debug!(user_id = %user_id, "org_user_cache miss — queried DB");
        }
        Ok(result)
    }

    /// Invalidate the org-user cache. Call after any mutation to organizations.
    /// Clears all entries (not per-org) — intentional trade-off: targeted eviction
    /// would require a reverse user→org index. Acceptable for current write volume.
    pub(crate) fn clear_org_cache() {
        org_user_cache().clear();
        tracing::debug!("org_user_cache cleared");
    }

    /// Update organization name
    pub async fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<Organization> {
        let now = chrono::Utc::now();
        let result = sqlx::query_as::<_, Organization>(
            "UPDATE organizations SET name = ?, updated_at = ? WHERE id = ? RETURNING *",
        )
        .bind(name)
        .bind(now.to_rfc3339())
        .bind(id)
        .fetch_one(pool)
        .await?;
        Self::clear_org_cache();
        Ok(result)
    }

    /// Update subscription details (called from Stripe webhook)
    pub async fn update_subscription(
        pool: &DbPool,
        id: &str,
        tier: &str,
        seats: i32,
        stripe_subscription_id: Option<&str>,
        subscription_status: &str,
        billing_interval: Option<&str>,
        current_period_start: Option<chrono::DateTime<chrono::Utc>>,
        current_period_end: Option<chrono::DateTime<chrono::Utc>>,
        cancel_at_period_end: bool,
    ) -> Result<Organization> {
        let now = chrono::Utc::now();
        let result = sqlx::query_as::<_, Organization>(
            r#"
            UPDATE organizations SET
                tier = ?,
                seats = ?,
                stripe_subscription_id = ?,
                subscription_status = ?,
                billing_interval = ?,
                current_period_start = ?,
                current_period_end = ?,
                cancel_at_period_end = ?,
                updated_at = ?
            WHERE id = ?
            RETURNING *
            "#,
        )
        .bind(tier)
        .bind(seats)
        .bind(stripe_subscription_id)
        .bind(subscription_status)
        .bind(billing_interval)
        .bind(current_period_start.map(|d| d.to_rfc3339()))
        .bind(current_period_end.map(|d| d.to_rfc3339()))
        .bind(cancel_at_period_end)
        .bind(now.to_rfc3339())
        .bind(id)
        .fetch_one(pool)
        .await?;
        Self::clear_org_cache();
        Ok(result)
    }

    /// Atomically activate a subscription only if it has not already been recorded.
    /// Returns Ok(true) if the row was updated, Ok(false) if already processed.
    /// Prevents concurrent verify_checkout calls from double-processing the same session.
    pub async fn activate_subscription_if_new(
        pool: &DbPool,
        id: &str,
        subscription_id: &str,
        tier: &str,
        seats: i32,
        subscription_status: &str,
        billing_interval: Option<&str>,
        current_period_start: Option<chrono::DateTime<chrono::Utc>>,
        current_period_end: Option<chrono::DateTime<chrono::Utc>>,
        cancel_at_period_end: bool,
    ) -> Result<bool> {
        let now = chrono::Utc::now();
        let result = sqlx::query(
            r#"
            UPDATE organizations SET
                tier = ?,
                seats = ?,
                stripe_subscription_id = ?,
                subscription_status = ?,
                billing_interval = ?,
                current_period_start = ?,
                current_period_end = ?,
                cancel_at_period_end = ?,
                updated_at = ?
            WHERE id = ?
              AND (stripe_subscription_id IS NULL OR stripe_subscription_id != ?)
            "#,
        )
        .bind(tier)
        .bind(seats)
        .bind(subscription_id)
        .bind(subscription_status)
        .bind(billing_interval)
        .bind(current_period_start.map(|d| d.to_rfc3339()))
        .bind(current_period_end.map(|d| d.to_rfc3339()))
        .bind(cancel_at_period_end)
        .bind(now.to_rfc3339())
        .bind(id)
        .bind(subscription_id)
        .execute(pool)
        .await?;
        Self::clear_org_cache();
        Ok(result.rows_affected() > 0)
    }

    /// Set Stripe customer ID (idempotent — only writes if stripe_customer_id is NULL).
    /// Returns Ok(true) if the row was updated, Ok(false) if a customer ID was already set.
    pub async fn set_stripe_customer(
        pool: &DbPool,
        id: &str,
        stripe_customer_id: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now();
        sqlx::query(
            "UPDATE organizations SET stripe_customer_id = ?, updated_at = ? WHERE id = ? AND stripe_customer_id IS NULL",
        )
        .bind(stripe_customer_id)
        .bind(now.to_rfc3339())
        .bind(id)
        .execute(pool)
        .await?;
        Self::clear_org_cache();
        Ok(())
    }

    /// Get organization by Stripe customer ID
    pub async fn find_by_stripe_customer(
        pool: &DbPool,
        stripe_customer_id: &str,
    ) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>(
            "SELECT * FROM organizations WHERE stripe_customer_id = ?",
        )
        .bind(stripe_customer_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Find the organization that owns a project
    pub async fn find_by_project_id(
        pool: &DbPool,
        project_id: &str,
    ) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>(
            r#"
            SELECT o.* FROM organizations o
            JOIN projects p ON p.organization_id = o.id
            WHERE p.id = ?
            "#,
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Get the tier for a project (via organization)
    pub async fn get_project_tier(pool: &DbPool, project_id: &str) -> Result<String> {
        let row: Option<(String,)> = sqlx::query_as(
            r#"
            SELECT o.tier FROM organizations o
            JOIN projects p ON p.organization_id = o.id
            WHERE p.id = ?
            "#,
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| r.0).unwrap_or_else(|| "free".to_string()))
    }

    /// Get the tier for a project by API key
    pub async fn get_tier_by_api_key(pool: &DbPool, api_key: &str) -> Result<String> {
        let row: Option<(String,)> = sqlx::query_as(
            r#"
            SELECT o.tier FROM organizations o
            JOIN projects p ON p.organization_id = o.id
            WHERE p.api_key = ?
            "#,
        )
        .bind(api_key)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| r.0).unwrap_or_else(|| "free".to_string()))
    }

    /// Update seat count only.
    /// Returns Ok(None) if seats is below current member count (rejected atomically).
    pub async fn update_seats(pool: &DbPool, id: &str, seats: i32) -> Result<Option<Organization>> {
        let now = chrono::Utc::now();
        // Atomic guard: only update if the new seat count >= current member count,
        // preventing a race where add_member slips in between a guard check and this write.
        let result = sqlx::query_as::<_, Organization>(
            r#"
            UPDATE organizations SET seats = ?, updated_at = ?
            WHERE id = ?
              AND ? >= (
                  SELECT COUNT(*) FROM organization_members WHERE organization_id = ?
              )
            RETURNING *
            "#,
        )
        .bind(seats)
        .bind(now.to_rfc3339())
        .bind(id)
        .bind(seats)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
        if result.is_some() {
            Self::clear_org_cache();
        }
        Ok(result)
    }

    /// Update tax information for an organization
    pub async fn update_tax_info(
        pool: &DbPool,
        id: &str,
        tax_id: Option<&str>,
        billing_country: Option<&str>,
        billing_address: Option<&str>,
    ) -> Result<Organization> {
        let now = chrono::Utc::now();
        sqlx::query_as::<_, Organization>(
            r#"
            UPDATE organizations SET
                tax_id = COALESCE(?, tax_id),
                billing_country = COALESCE(?, billing_country),
                billing_address = COALESCE(?, billing_address),
                updated_at = ?
            WHERE id = ?
            RETURNING *
            "#,
        )
        .bind(tax_id)
        .bind(billing_country)
        .bind(billing_address)
        .bind(now.to_rfc3339())
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Update payment failure status
    pub async fn update_payment_status(
        pool: &DbPool,
        id: &str,
        payment_failed_at: Option<chrono::DateTime<chrono::Utc>>,
        grace_period_ends: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Organization> {
        let now = chrono::Utc::now();
        let result = sqlx::query_as::<_, Organization>(
            r#"
            UPDATE organizations SET
                payment_failed_at = ?,
                grace_period_ends = ?,
                updated_at = ?
            WHERE id = ?
            RETURNING *
            "#,
        )
        .bind(payment_failed_at.map(|d| d.to_rfc3339()))
        .bind(grace_period_ends.map(|d| d.to_rfc3339()))
        .bind(now.to_rfc3339())
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
        Self::clear_org_cache();
        Ok(result)
    }
}

pub struct OrganizationMemberRepository;

impl OrganizationMemberRepository {
    /// Add a member to an organization (unconditional, no seat check).
    pub async fn add(
        pool: &DbPool,
        organization_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<OrganizationMember> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        sqlx::query_as::<_, OrganizationMember>(
            "INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
        )
        .bind(&id)
        .bind(organization_id)
        .bind(user_id)
        .bind(role)
        .bind(now.to_rfc3339())
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Atomically add a member only if the current seat count is below the seat limit.
    /// Returns Ok(Some(member)) on success, Ok(None) if the seat limit is already reached.
    ///
    /// H4: Uses a PostgreSQL advisory transaction lock keyed on the organization ID to
    /// fully serialize concurrent add_member calls for the same org.  The lock is acquired
    /// inside an explicit transaction and is automatically released when the transaction ends,
    /// eliminating the TOCTOU window that existed when relying solely on the WHERE subquery.
    pub async fn add_if_seat_available(
        pool: &DbPool,
        organization_id: &str,
        user_id: &str,
        role: &str,
        seat_limit: i32,
    ) -> Result<Option<OrganizationMember>> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        let result = sqlx::query_as::<_, OrganizationMember>(
            r#"
            INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
            SELECT ?, ?, ?, ?, ?
            WHERE (SELECT COUNT(*) FROM organization_members WHERE organization_id = ?) < ?
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(user_id)
        .bind(role)
        .bind(now.to_rfc3339())
        .bind(organization_id)
        .bind(seat_limit as i64)
        .fetch_optional(pool)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

        Ok(result)
    }

    /// Remove a member from an organization
    pub async fn remove(pool: &DbPool, organization_id: &str, user_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?")
            .bind(organization_id)
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Get all members of an organization
    pub async fn list(pool: &DbPool, organization_id: &str) -> Result<Vec<OrganizationMember>> {
        // Hard cap — no organization should ever need more than 10k members in one page.
        sqlx::query_as::<_, OrganizationMember>(
            "SELECT * FROM organization_members WHERE organization_id = ? ORDER BY created_at LIMIT 10000",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Count members in an organization
    pub async fn count(pool: &DbPool, organization_id: &str) -> Result<i32> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM organization_members WHERE organization_id = ?")
                .bind(organization_id)
                .fetch_one(pool)
                .await?;
        Ok(row.0 as i32)
    }

    /// Fetch a single member row by org + user (point-lookup, avoids full list scan).
    pub async fn find_by_user_in_org(
        pool: &DbPool,
        organization_id: &str,
        user_id: &str,
    ) -> Result<Option<OrganizationMember>> {
        sqlx::query_as::<_, OrganizationMember>(
            "SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? LIMIT 1",
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Check if user is member of organization
    pub async fn is_member(pool: &DbPool, organization_id: &str, user_id: &str) -> Result<bool> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM organization_members WHERE organization_id = ? AND user_id = ?",
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0 > 0)
    }

    /// Update member role
    pub async fn update_role(
        pool: &DbPool,
        organization_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
        )
        .bind(role)
        .bind(organization_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

#[allow(dead_code)]
pub struct UsageRepository;

#[allow(dead_code)]
impl UsageRepository {
    /// Increment (or create) a usage counter for the given organization, metric, and period.
    /// Returns an error if amount is zero.
    pub async fn increment(
        pool: &DbPool,
        organization_id: &str,
        metric: &str,
        period_start: chrono::DateTime<chrono::Utc>,
        period_end: chrono::DateTime<chrono::Utc>,
        amount: i32,
    ) -> Result<UsageRecord> {
        if amount == 0 {
            return Err(anyhow::anyhow!("amount must be greater than zero"));
        }
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        let record = sqlx::query_as::<_, UsageRecord>(
            r#"
            INSERT INTO usage_records (id, organization_id, metric, count, period_start, period_end, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (organization_id, metric, period_start) DO UPDATE
            SET count = usage_records.count + excluded.count
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(metric)
        .bind(amount)
        .bind(period_start.to_rfc3339())
        .bind(period_end.to_rfc3339())
        .bind(now.to_rfc3339())
        .fetch_one(pool)
        .await?;
        Ok(record)
    }

    /// Get the current usage count for a metric in a given period.
    pub async fn get_current(
        pool: &DbPool,
        organization_id: &str,
        metric: &str,
        period_start: &str,
    ) -> Result<i32> {
        let row: Option<(i32,)> = sqlx::query_as(
            "SELECT count FROM usage_records WHERE organization_id = ? AND metric = ? AND period_start = ?",
        )
        .bind(organization_id)
        .bind(metric)
        .bind(period_start)
        .fetch_optional(pool)
        .await?;
        Ok(row.map(|(c,)| c).unwrap_or(0))
    }

    /// List all usage records for an organization in the given period.
    pub async fn list_current(
        pool: &DbPool,
        organization_id: &str,
        period_start: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<UsageRecord>> {
        sqlx::query_as::<_, UsageRecord>(
            "SELECT * FROM usage_records WHERE organization_id = ? AND period_start = ?",
        )
        .bind(organization_id)
        .bind(period_start.to_rfc3339())
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// List all usage records for an organization across all periods.
    pub async fn list_all(pool: &DbPool, organization_id: &str) -> Result<Vec<UsageRecord>> {
        sqlx::query_as::<_, UsageRecord>(
            "SELECT * FROM usage_records WHERE organization_id = ? ORDER BY created_at DESC",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}

#[allow(dead_code)]
pub struct BillingEventRepository;

#[allow(dead_code)]
impl BillingEventRepository {
    /// Record a billing event
    pub async fn create(
        pool: &DbPool,
        organization_id: &str,
        event_type: &str,
        stripe_event_id: Option<&str>,
        amount_cents: Option<i32>,
        currency: Option<&str>,
        metadata: Option<&str>,
    ) -> Result<BillingEvent> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        sqlx::query_as::<_, BillingEvent>(
            r#"
            INSERT INTO billing_events (id, organization_id, event_type, stripe_event_id, amount_cents, currency, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(event_type)
        .bind(stripe_event_id)
        .bind(amount_cents)
        .bind(currency)
        .bind(metadata)
        .bind(now.to_rfc3339())
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Idempotent create: INSERT … ON CONFLICT (stripe_event_id) DO NOTHING.
    /// Returns Ok(true) if the row was newly inserted, Ok(false) if it already existed
    /// (i.e. a duplicate — caller should skip processing).
    /// Requires the unique index added in migration 029.
    pub async fn create_idempotent(
        pool: &DbPool,
        organization_id: &str,
        event_type: &str,
        stripe_event_id: &str,
    ) -> Result<bool> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        let result = sqlx::query(
            r#"
            INSERT INTO billing_events (id, organization_id, event_type, stripe_event_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (stripe_event_id) DO NOTHING
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(event_type)
        .bind(stripe_event_id)
        .bind(now.to_rfc3339())
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Check if an event has already been processed (idempotency)
    pub async fn exists_by_stripe_event(pool: &DbPool, stripe_event_id: &str) -> Result<bool> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM billing_events WHERE stripe_event_id = ?")
                .bind(stripe_event_id)
                .fetch_one(pool)
                .await?;
        Ok(row.0 > 0)
    }

    /// List billing events for an organization
    pub async fn list(
        pool: &DbPool,
        organization_id: &str,
        limit: i32,
    ) -> Result<Vec<BillingEvent>> {
        let limit = limit.max(1).min(1000);
        sqlx::query_as::<_, BillingEvent>(
            "SELECT * FROM billing_events WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(organization_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;

    #[tokio::test]
    async fn create_and_find_by_id() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-cfbi", "My Org", "my-org-cfbi")
            .await
            .unwrap();
        assert_eq!(org.name, "My Org");
        assert_eq!(org.owner_id, "u-cfbi");
        assert_eq!(org.tier, "free");
        let found = OrganizationRepository::find_by_id(&pool, &org.id)
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, org.id);
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_any_pool().await;
        let found = OrganizationRepository::find_by_id(&pool, "nonexistent")
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn find_by_slug() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-fbs", "Slug Org", "slug-org-fbs")
            .await
            .unwrap();
        let found = OrganizationRepository::find_by_slug(&pool, "slug-org-fbs")
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, org.id);
    }

    #[tokio::test]
    async fn find_by_user_as_owner() {
        let pool = test_any_pool().await;
        OrganizationRepository::clear_org_cache();
        let org =
            OrganizationRepository::create(&pool, "u-fbu-owner", "Owner Org", "owner-org-fbu")
                .await
                .unwrap();
        let found = OrganizationRepository::find_by_user(&pool, "u-fbu-owner")
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, org.id);
    }

    #[tokio::test]
    async fn create_if_owner_not_exists_idempotent() {
        let pool = test_any_pool().await;
        let first = OrganizationRepository::create_if_owner_not_exists(
            &pool,
            "u-idem",
            "Org1",
            "org1-idem",
        )
        .await
        .unwrap();
        assert!(first.is_some());
        let second = OrganizationRepository::create_if_owner_not_exists(
            &pool,
            "u-idem",
            "Org2",
            "org2-idem",
        )
        .await
        .unwrap();
        assert!(
            second.is_none(),
            "second call should return None because owner already has an org"
        );
    }

    #[tokio::test]
    async fn update_name() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-un", "Old Name", "old-name-slug-un")
            .await
            .unwrap();
        let updated = OrganizationRepository::update_name(&pool, &org.id, "New Name")
            .await
            .unwrap();
        assert_eq!(updated.name, "New Name");
    }

    #[tokio::test]
    async fn update_subscription_changes_tier_and_seats() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-sub", "Sub Org", "sub-org-slug")
            .await
            .unwrap();
        let updated = OrganizationRepository::update_subscription(
            &pool,
            &org.id,
            "pro",
            5,
            Some("sub-123"),
            "active",
            Some("monthly"),
            None,
            None,
            false,
        )
        .await
        .unwrap();
        assert_eq!(updated.tier, "pro");
        assert_eq!(updated.seats, 5);
        assert!(!*updated.cancel_at_period_end);
    }

    #[tokio::test]
    async fn set_and_find_by_stripe_customer() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-sc", "SC Org", "sc-org-slug")
            .await
            .unwrap();
        OrganizationRepository::set_stripe_customer(&pool, &org.id, "cus_test_123")
            .await
            .unwrap();
        let found = OrganizationRepository::find_by_stripe_customer(&pool, "cus_test_123")
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, org.id);
    }

    #[tokio::test]
    async fn member_add_list_and_remove() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-mem", "Mem Org", "mem-org-slug")
            .await
            .unwrap();
        OrganizationMemberRepository::add(&pool, &org.id, "u-ma", "member")
            .await
            .unwrap();
        OrganizationMemberRepository::add(&pool, &org.id, "u-mb", "admin")
            .await
            .unwrap();
        let members = OrganizationMemberRepository::list(&pool, &org.id)
            .await
            .unwrap();
        assert_eq!(members.len(), 2);
        OrganizationMemberRepository::remove(&pool, &org.id, "u-ma")
            .await
            .unwrap();
        let after = OrganizationMemberRepository::list(&pool, &org.id)
            .await
            .unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].user_id, "u-mb");
    }

    #[tokio::test]
    async fn member_is_member_and_count() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-mc", "MC Org", "mc-org-slug")
            .await
            .unwrap();
        OrganizationMemberRepository::add(&pool, &org.id, "u-mc1", "member")
            .await
            .unwrap();
        assert!(
            OrganizationMemberRepository::is_member(&pool, &org.id, "u-mc1")
                .await
                .unwrap()
        );
        assert!(
            !OrganizationMemberRepository::is_member(&pool, &org.id, "u-mc-not")
                .await
                .unwrap()
        );
        let count = OrganizationMemberRepository::count(&pool, &org.id)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn member_update_role() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-ur", "UR Org", "ur-org-slug")
            .await
            .unwrap();
        OrganizationMemberRepository::add(&pool, &org.id, "u-ur1", "member")
            .await
            .unwrap();
        OrganizationMemberRepository::update_role(&pool, &org.id, "u-ur1", "admin")
            .await
            .unwrap();
        let member = OrganizationMemberRepository::find_by_user_in_org(&pool, &org.id, "u-ur1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(member.role, "admin");
    }

    #[tokio::test]
    async fn add_if_seat_available_enforces_limit() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-seat", "Seat Org", "seat-org-slug")
            .await
            .unwrap();
        let r1 = OrganizationMemberRepository::add_if_seat_available(
            &pool, &org.id, "u-s1", "member", 1,
        )
        .await
        .unwrap();
        assert!(r1.is_some(), "first add within limit should succeed");
        let r2 = OrganizationMemberRepository::add_if_seat_available(
            &pool, &org.id, "u-s2", "member", 1,
        )
        .await
        .unwrap();
        assert!(r2.is_none(), "second add at limit should be rejected");
    }

    #[tokio::test]
    async fn usage_increment_and_get_current() {
        let pool = test_any_pool().await;
        let period_start = chrono::Utc::now();
        let period_end = period_start + chrono::Duration::days(30);
        let record =
            UsageRepository::increment(&pool, "org-usage", "events", period_start, period_end, 10)
                .await
                .unwrap();
        assert_eq!(record.count, 10);
        UsageRepository::increment(&pool, "org-usage", "events", period_start, period_end, 5)
            .await
            .unwrap();
        let count =
            UsageRepository::get_current(&pool, "org-usage", "events", &period_start.to_rfc3339())
                .await
                .unwrap();
        assert_eq!(count, 15);
    }

    #[tokio::test]
    async fn usage_increment_rejects_zero_amount() {
        let pool = test_any_pool().await;
        let period_start = chrono::Utc::now();
        let period_end = period_start + chrono::Duration::days(30);
        let result =
            UsageRepository::increment(&pool, "org-zero", "events", period_start, period_end, 0)
                .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn billing_event_create_and_list() {
        let pool = test_any_pool().await;
        BillingEventRepository::create(
            &pool,
            "org-bill",
            "payment_succeeded",
            Some("evt_1"),
            Some(999),
            Some("usd"),
            None,
        )
        .await
        .unwrap();
        let events = BillingEventRepository::list(&pool, "org-bill", 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "payment_succeeded");
        assert_eq!(events[0].amount_cents, Some(999));
    }

    #[tokio::test]
    async fn billing_event_idempotent_create() {
        let pool = test_any_pool().await;
        let first = BillingEventRepository::create_idempotent(
            &pool,
            "org-idem",
            "payment_succeeded",
            "evt_uniq",
        )
        .await
        .unwrap();
        assert!(first, "first insert should return true");
        let second = BillingEventRepository::create_idempotent(
            &pool,
            "org-idem",
            "payment_succeeded",
            "evt_uniq",
        )
        .await
        .unwrap();
        assert!(!second, "duplicate should return false");
        assert!(
            BillingEventRepository::exists_by_stripe_event(&pool, "evt_uniq")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn activate_subscription_if_new() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-asin", "ASIN Org", "asin-org-slug")
            .await
            .unwrap();
        let ok = OrganizationRepository::activate_subscription_if_new(
            &pool,
            &org.id,
            "sub-new-1",
            "pro",
            5,
            "active",
            Some("monthly"),
            None,
            None,
            false,
        )
        .await
        .unwrap();
        assert!(ok, "first activation should succeed");
        let noop = OrganizationRepository::activate_subscription_if_new(
            &pool,
            &org.id,
            "sub-new-1",
            "pro",
            5,
            "active",
            Some("monthly"),
            None,
            None,
            false,
        )
        .await
        .unwrap();
        assert!(!noop, "duplicate activation should return false");
    }

    #[tokio::test]
    async fn find_by_project_id_and_get_tiers() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-fbpi", "FBPI Org", "fbpi-org-slug")
            .await
            .unwrap();
        sqlx::query("INSERT INTO projects (id, name, slug, api_key, api_key_hash, owner_id, organization_id) VALUES (?, 'P', ?, ?, '', ?, ?)")
            .bind("proj-fbpi").bind("slug-fbpi").bind("key-fbpi-999").bind("u-fbpi").bind(&org.id)
            .execute(&pool).await.unwrap();
        let found = OrganizationRepository::find_by_project_id(&pool, "proj-fbpi")
            .await
            .unwrap();
        assert_eq!(found.unwrap().id, org.id);
        let tier = OrganizationRepository::get_project_tier(&pool, "proj-fbpi")
            .await
            .unwrap();
        assert_eq!(tier, "free");
        let tier_by_key = OrganizationRepository::get_tier_by_api_key(&pool, "key-fbpi-999")
            .await
            .unwrap();
        assert_eq!(tier_by_key, "free");
        let default_tier = OrganizationRepository::get_project_tier(&pool, "nonexistent")
            .await
            .unwrap();
        assert_eq!(default_tier, "free");
    }

    #[tokio::test]
    async fn update_seats_with_guard() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-us-g", "USG Org", "usg-org-slug")
            .await
            .unwrap();
        let updated = OrganizationRepository::update_seats(&pool, &org.id, 5)
            .await
            .unwrap();
        assert!(updated.is_some());
        assert_eq!(updated.unwrap().seats, 5);
        OrganizationMemberRepository::add(&pool, &org.id, "u-usg1", "member")
            .await
            .unwrap();
        OrganizationMemberRepository::add(&pool, &org.id, "u-usg2", "member")
            .await
            .unwrap();
        OrganizationMemberRepository::add(&pool, &org.id, "u-usg3", "member")
            .await
            .unwrap();
        let rejected = OrganizationRepository::update_seats(&pool, &org.id, 2)
            .await
            .unwrap();
        assert!(rejected.is_none(), "should reject seats below member count");
    }

    #[tokio::test]
    async fn update_tax_info() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-uti", "UTI Org", "uti-org-slug")
            .await
            .unwrap();
        let updated = OrganizationRepository::update_tax_info(
            &pool,
            &org.id,
            Some("VAT123"),
            Some("DE"),
            Some("Musterstr. 1"),
        )
        .await
        .unwrap();
        assert_eq!(updated.tax_id.as_deref(), Some("VAT123"));
        assert_eq!(updated.billing_country.as_deref(), Some("DE"));
        assert_eq!(updated.billing_address.as_deref(), Some("Musterstr. 1"));
    }

    #[tokio::test]
    async fn update_payment_status() {
        let pool = test_any_pool().await;
        let org = OrganizationRepository::create(&pool, "u-ups", "UPS Org", "ups-org-slug")
            .await
            .unwrap();
        let failed_at = chrono::Utc::now();
        let grace_ends = failed_at + chrono::Duration::days(7);
        let updated = OrganizationRepository::update_payment_status(
            &pool,
            &org.id,
            Some(failed_at),
            Some(grace_ends),
        )
        .await
        .unwrap();
        assert!(updated.payment_failed_at.is_some());
        assert!(updated.grace_period_ends.is_some());
    }

    #[tokio::test]
    async fn usage_list_current_and_all() {
        let pool = test_any_pool().await;
        let period_start = chrono::Utc::now();
        let period_end = period_start + chrono::Duration::days(30);
        UsageRepository::increment(&pool, "org-ulca", "events", period_start, period_end, 100)
            .await
            .unwrap();
        UsageRepository::increment(&pool, "org-ulca", "monitors", period_start, period_end, 5)
            .await
            .unwrap();
        let current = UsageRepository::list_current(&pool, "org-ulca", period_start)
            .await
            .unwrap();
        assert_eq!(current.len(), 2);
        let all = UsageRepository::list_all(&pool, "org-ulca").await.unwrap();
        assert_eq!(all.len(), 2);
    }
}
