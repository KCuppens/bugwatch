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

impl OrganizationRepository {
    /// Create a new organization (typically called when user signs up)
    pub async fn create(
        pool: &DbPool,
        owner_id: &str,
        name: &str,
        slug: &str,
    ) -> Result<Organization> {
        let id = Uuid::new_v4().to_string();

        sqlx::query_as::<_, Organization>(
            r#"
            INSERT INTO organizations (id, name, slug, owner_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, now(), now())
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(owner_id)
        .fetch_one(pool)
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
            SELECT $1, $2, $3, $4, now(), now()
            WHERE NOT EXISTS (
                SELECT 1 FROM organizations WHERE owner_id = $4
            )
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(owner_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

        Ok(result)
    }

    /// Find organization by ID
    pub async fn find_by_id(pool: &DbPool, id: &str) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>("SELECT * FROM organizations WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }

    /// Find organization by slug
    pub async fn find_by_slug(pool: &DbPool, slug: &str) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>("SELECT * FROM organizations WHERE slug = $1")
            .bind(slug)
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
                SELECT o.* FROM organizations o WHERE o.owner_id = $1
                UNION ALL
                SELECT o.* FROM organizations o
                JOIN organization_members om ON om.organization_id = o.id
                WHERE om.user_id = $1
            ) combined
            LIMIT 1
            "#,
        )
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
            "UPDATE organizations SET name = $1, updated_at = $2 WHERE id = $3 RETURNING *",
        )
        .bind(name)
        .bind(&now)
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
                tier = $1,
                seats = $2,
                stripe_subscription_id = $3,
                subscription_status = $4,
                billing_interval = $5,
                current_period_start = $6,
                current_period_end = $7,
                cancel_at_period_end = $8,
                updated_at = $9
            WHERE id = $10
            RETURNING *
            "#,
        )
        .bind(tier)
        .bind(seats)
        .bind(stripe_subscription_id)
        .bind(subscription_status)
        .bind(billing_interval)
        .bind(current_period_start)
        .bind(current_period_end)
        .bind(cancel_at_period_end)
        .bind(&now)
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
                tier = $1,
                seats = $2,
                stripe_subscription_id = $3,
                subscription_status = $4,
                billing_interval = $5,
                current_period_start = $6,
                current_period_end = $7,
                cancel_at_period_end = $8,
                updated_at = $9
            WHERE id = $10
              AND (stripe_subscription_id IS NULL OR stripe_subscription_id IS DISTINCT FROM $3)
            "#,
        )
        .bind(tier)
        .bind(seats)
        .bind(subscription_id)
        .bind(subscription_status)
        .bind(billing_interval)
        .bind(current_period_start)
        .bind(current_period_end)
        .bind(cancel_at_period_end)
        .bind(&now)
        .bind(id)
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
            "UPDATE organizations SET stripe_customer_id = $1, updated_at = $2 WHERE id = $3 AND stripe_customer_id IS NULL",
        )
        .bind(stripe_customer_id)
        .bind(&now)
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
            "SELECT * FROM organizations WHERE stripe_customer_id = $1",
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
            WHERE p.id = $1
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
            WHERE p.id = $1
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
            WHERE p.api_key = $1
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
            UPDATE organizations SET seats = $1, updated_at = $2
            WHERE id = $3
              AND $1 >= (
                  SELECT COUNT(*) FROM organization_members WHERE organization_id = $3
              )
            RETURNING *
            "#,
        )
        .bind(seats)
        .bind(&now)
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
                tax_id = COALESCE($1, tax_id),
                billing_country = COALESCE($2, billing_country),
                billing_address = COALESCE($3, billing_address),
                updated_at = $4
            WHERE id = $5
            RETURNING *
            "#,
        )
        .bind(tax_id)
        .bind(billing_country)
        .bind(billing_address)
        .bind(&now)
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
                payment_failed_at = $1,
                grace_period_ends = $2,
                updated_at = $3
            WHERE id = $4
            RETURNING *
            "#,
        )
        .bind(payment_failed_at)
        .bind(grace_period_ends)
        .bind(&now)
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
    /// Add a member to an organization
    pub(crate) async fn add(
        pool: &DbPool,
        organization_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<OrganizationMember> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        sqlx::query_as::<_, OrganizationMember>(
            r#"
            INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(user_id)
        .bind(role)
        .bind(&now)
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

        // Derive a stable i64 lock key from the organization_id bytes.
        // Same derivation used in billing.rs change_plan / update_seats.
        let lock_key: i64 = {
            let b = organization_id.as_bytes();
            b.iter()
                .take(8)
                .enumerate()
                .fold(0i64, |acc, (i, &byte)| acc | ((byte as i64) << (i * 8)))
        };

        let mut tx = pool.begin().await.map_err(|e| anyhow::anyhow!(e))?;

        // Acquire an advisory transaction lock — blocks until the lock is free,
        // ensuring only one concurrent add_member for this org runs at a time.
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(lock_key)
            .execute(&mut *tx)
            .await
            .map_err(|e| anyhow::anyhow!(e))?;

        let result = sqlx::query_as::<_, OrganizationMember>(
            r#"
            INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
            SELECT $1, $2, $3, $4, $5
            WHERE (SELECT COUNT(*) FROM organization_members WHERE organization_id = $2) < $6
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(user_id)
        .bind(role)
        .bind(&now)
        .bind(seat_limit as i64)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

        tx.commit().await.map_err(|e| anyhow::anyhow!(e))?;

        Ok(result)
    }

    /// Remove a member from an organization
    pub async fn remove(pool: &DbPool, organization_id: &str, user_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2")
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
            "SELECT * FROM organization_members WHERE organization_id = $1 ORDER BY created_at LIMIT 10000",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Count members in an organization
    pub async fn count(pool: &DbPool, organization_id: &str) -> Result<i32> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM organization_members WHERE organization_id = $1")
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
            "SELECT * FROM organization_members WHERE organization_id = $1 AND user_id = $2 LIMIT 1",
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
            "SELECT COUNT(*) FROM organization_members WHERE organization_id = $1 AND user_id = $2",
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
            "UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3",
        )
        .bind(role)
        .bind(organization_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

pub struct UsageRepository;

impl UsageRepository {
    /// Record or increment usage for a metric
    pub async fn increment(
        pool: &DbPool,
        organization_id: &str,
        metric: &str,
        period_start: chrono::DateTime<chrono::Utc>,
        period_end: chrono::DateTime<chrono::Utc>,
        amount: i32,
    ) -> Result<UsageRecord> {
        if amount <= 0 {
            return Err(anyhow::anyhow!("amount must be positive"));
        }
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        // Try to update existing record, or insert new one
        sqlx::query_as::<_, UsageRecord>(
            r#"
            INSERT INTO usage_records (id, organization_id, metric, count, period_start, period_end, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(organization_id, metric, period_start) DO UPDATE
            SET count = usage_records.count + $8
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(metric)
        .bind(amount)
        .bind(period_start)
        .bind(period_end)
        .bind(&now)
        .bind(amount)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Get usage for current period
    pub async fn get_current(
        pool: &DbPool,
        organization_id: &str,
        metric: &str,
        period_start: &str,
    ) -> Result<i32> {
        let row: Option<(i32,)> = sqlx::query_as(
            "SELECT count FROM usage_records WHERE organization_id = $1 AND metric = $2 AND period_start = $3",
        )
        .bind(organization_id)
        .bind(metric)
        .bind(period_start)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| r.0).unwrap_or(0))
    }

    /// Get all usage records for an organization's current period
    pub async fn list_current(
        pool: &DbPool,
        organization_id: &str,
        period_start: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<UsageRecord>> {
        sqlx::query_as::<_, UsageRecord>(
            "SELECT * FROM usage_records WHERE organization_id = $1 AND period_start = $2",
        )
        .bind(organization_id)
        .bind(period_start)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Get all usage records for an organization (historical)
    pub async fn list_all(pool: &DbPool, organization_id: &str) -> Result<Vec<UsageRecord>> {
        sqlx::query_as::<_, UsageRecord>(
            "SELECT * FROM usage_records WHERE organization_id = $1 ORDER BY period_start DESC LIMIT 1000",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}

pub struct BillingEventRepository;

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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        .bind(&now)
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
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (stripe_event_id) DO NOTHING
            "#,
        )
        .bind(&id)
        .bind(organization_id)
        .bind(event_type)
        .bind(stripe_event_id)
        .bind(&now)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Check if an event has already been processed (idempotency)
    pub async fn exists_by_stripe_event(pool: &DbPool, stripe_event_id: &str) -> Result<bool> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM billing_events WHERE stripe_event_id = $1")
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
            "SELECT * FROM billing_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(organization_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}
