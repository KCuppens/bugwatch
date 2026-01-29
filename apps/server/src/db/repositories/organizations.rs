use crate::db::{
    models::{Organization, OrganizationMember, UsageRecord, BillingEvent, CreditPurchase},
    DbPool,
};
use anyhow::Result;
use uuid::Uuid;

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

    /// Get organization for a user (as owner or member)
    pub async fn find_by_user(pool: &DbPool, user_id: &str) -> Result<Option<Organization>> {
        // First check if user owns an org
        let owned = sqlx::query_as::<_, Organization>(
            "SELECT * FROM organizations WHERE owner_id = $1 LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        if owned.is_some() {
            return Ok(owned);
        }

        // Check if user is a member of an org
        sqlx::query_as::<_, Organization>(
            r#"
            SELECT o.* FROM organizations o
            JOIN organization_members om ON o.id = om.organization_id
            WHERE om.user_id = $1
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Update organization name
    pub async fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<Organization> {
        let now = chrono::Utc::now();
        sqlx::query_as::<_, Organization>(
            "UPDATE organizations SET name = $1, updated_at = $2 WHERE id = $3 RETURNING *",
        )
        .bind(name)
        .bind(&now)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
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
        current_period_start: Option<&str>,
        current_period_end: Option<&str>,
        cancel_at_period_end: bool,
    ) -> Result<Organization> {
        let now = chrono::Utc::now();
        sqlx::query_as::<_, Organization>(
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
        .await
        .map_err(Into::into)
    }

    /// Set Stripe customer ID
    pub async fn set_stripe_customer(
        pool: &DbPool,
        id: &str,
        stripe_customer_id: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now();
        sqlx::query(
            "UPDATE organizations SET stripe_customer_id = $1, updated_at = $2 WHERE id = $3",
        )
        .bind(stripe_customer_id)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
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

    /// Update seat count only
    pub async fn update_seats(pool: &DbPool, id: &str, seats: i32) -> Result<Organization> {
        let now = chrono::Utc::now();
        sqlx::query_as::<_, Organization>(
            "UPDATE organizations SET seats = $1, updated_at = $2 WHERE id = $3 RETURNING *",
        )
        .bind(seats)
        .bind(&now)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
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
        payment_failed_at: Option<&str>,
        grace_period_ends: Option<&str>,
    ) -> Result<Organization> {
        let now = chrono::Utc::now();
        sqlx::query_as::<_, Organization>(
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
        .map_err(Into::into)
    }
}

pub struct OrganizationMemberRepository;

impl OrganizationMemberRepository {
    /// Add a member to an organization
    pub async fn add(
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

    /// Remove a member from an organization
    pub async fn remove(pool: &DbPool, organization_id: &str, user_id: &str) -> Result<()> {
        sqlx::query(
            "DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2",
        )
        .bind(organization_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Get all members of an organization
    pub async fn list(pool: &DbPool, organization_id: &str) -> Result<Vec<OrganizationMember>> {
        sqlx::query_as::<_, OrganizationMember>(
            "SELECT * FROM organization_members WHERE organization_id = $1 ORDER BY created_at",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Count members in an organization
    pub async fn count(pool: &DbPool, organization_id: &str) -> Result<i32> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM organization_members WHERE organization_id = $1",
        )
        .bind(organization_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0 as i32)
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
        period_start: &str,
        period_end: &str,
        amount: i32,
    ) -> Result<UsageRecord> {
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
    pub async fn list_all(
        pool: &DbPool,
        organization_id: &str,
    ) -> Result<Vec<UsageRecord>> {
        sqlx::query_as::<_, UsageRecord>(
            "SELECT * FROM usage_records WHERE organization_id = $1 ORDER BY period_start DESC",
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

    /// Check if an event has already been processed (idempotency)
    pub async fn exists_by_stripe_event(pool: &DbPool, stripe_event_id: &str) -> Result<bool> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM billing_events WHERE stripe_event_id = $1",
        )
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

pub struct CreditPurchaseRepository;

impl CreditPurchaseRepository {
    /// Create a pending credit purchase
    pub async fn create(
        pool: &DbPool,
        user_id: &str,
        credits: i32,
        amount_cents: i32,
    ) -> Result<CreditPurchase> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        sqlx::query_as::<_, CreditPurchase>(
            r#"
            INSERT INTO credit_purchases (id, user_id, credits, amount_cents, status, created_at)
            VALUES ($1, $2, $3, $4, 'pending', $5)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(user_id)
        .bind(credits)
        .bind(amount_cents)
        .bind(&now)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Update purchase with Stripe payment intent ID
    pub async fn set_payment_intent(
        pool: &DbPool,
        id: &str,
        stripe_payment_intent_id: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE credit_purchases SET stripe_payment_intent_id = $1 WHERE id = $2",
        )
        .bind(stripe_payment_intent_id)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Mark purchase as completed
    pub async fn complete(pool: &DbPool, id: &str) -> Result<CreditPurchase> {
        sqlx::query_as::<_, CreditPurchase>(
            "UPDATE credit_purchases SET status = 'completed' WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    /// Mark purchase as failed
    pub async fn fail(pool: &DbPool, id: &str) -> Result<()> {
        sqlx::query("UPDATE credit_purchases SET status = 'failed' WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Find by Stripe payment intent ID
    pub async fn find_by_payment_intent(
        pool: &DbPool,
        stripe_payment_intent_id: &str,
    ) -> Result<Option<CreditPurchase>> {
        sqlx::query_as::<_, CreditPurchase>(
            "SELECT * FROM credit_purchases WHERE stripe_payment_intent_id = $1",
        )
        .bind(stripe_payment_intent_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }
}
