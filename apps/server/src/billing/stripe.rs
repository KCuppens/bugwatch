use anyhow::{anyhow, Result};
use serde::Serialize;
use stripe::{
    BillingPortalSession, CheckoutSession, CheckoutSessionMode, Client, Coupon, CouponId,
    CreateBillingPortalSession, CreateCheckoutSession, CreateCheckoutSessionLineItems,
    CreateCustomer, CreateSetupIntent, Customer, CustomerId, Invoice, InvoiceId, PaymentIntent,
    PaymentIntentStatus, PaymentMethod, PaymentMethodId, Price, PriceId, PromotionCode,
    SetupIntent, SubscriptionId,
};

use crate::config::Config;

/// Generate a stable idempotency key for a Stripe operation.
///
/// The prefix must encode all operation inputs so the same logical operation
/// always produces the same key — Stripe deduplicates retries within 24 h.
/// Keys must be ≤ 255 ASCII bytes; callers are responsible for ensuring this.
/// Do NOT use this for operations that are intentionally non-idempotent
/// (e.g. SetupIntent creation — each add-card flow needs a fresh intent).
fn idempotency_key(prefix: &str) -> String {
    debug_assert!(prefix.len() <= 255, "idempotency key exceeds 255 bytes");
    prefix.to_string()
}

/// Retry a Stripe API call on transient errors (5xx, rate limit, network).
/// Max 3 retries with exponential backoff: ~1s, ~2s, ~4s.
async fn stripe_retry<F, Fut, T>(op: F) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, stripe::StripeError>>,
{
    let max_retries = 3u32;
    let mut last_err = None;

    for attempt in 0..=max_retries {
        match op().await {
            Ok(val) => return Ok(val),
            Err(e) => {
                // Only retry on server errors, rate limits, or network issues
                let retryable = matches!(
                    &e,
                    stripe::StripeError::Stripe(ref err) if err.http_status >= 500 || err.http_status == 429
                ) || matches!(&e, stripe::StripeError::ClientError(_));

                if !retryable || attempt >= max_retries {
                    return Err(anyhow!("Stripe API error: {}", e));
                }

                let base_ms = 1000u64 * 2u64.pow(attempt);
                let jitter_ms = (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_nanos() as u64)
                    % (base_ms / 5).max(1);
                let delay = std::time::Duration::from_millis(base_ms + jitter_ms);
                tracing::warn!(
                    attempt = attempt + 1,
                    "Stripe call failed, retrying in {:?}: {}",
                    delay,
                    e
                );
                tokio::time::sleep(delay).await;
                last_err = Some(e);
            }
        }
    }

    Err(anyhow!(
        "Stripe API failed after retries: {}",
        last_err.map(|e| e.to_string()).unwrap_or_default()
    ))
}

/// Stripe client wrapper for billing operations
#[derive(Clone)]
pub struct StripeClient {
    client: Client,
    price_ids: StripePriceIds,
}

#[derive(Clone)]
pub struct StripePriceIds {
    pub pro_monthly: Option<String>,
    pub pro_annual: Option<String>,
    pub team_monthly: Option<String>,
    pub team_annual: Option<String>,
}

impl StripeClient {
    /// Create a new Stripe client from config
    pub fn new(config: &Config) -> Result<Option<Self>> {
        let secret_key = match &config.stripe_secret_key {
            Some(key) if !key.is_empty() => key.clone(),
            _ => return Ok(None),
        };

        let client = Client::new(secret_key);

        let price_ids = StripePriceIds {
            pro_monthly: config.stripe_price_id_pro_monthly.clone(),
            pro_annual: config.stripe_price_id_pro_annual.clone(),
            team_monthly: config.stripe_price_id_team_monthly.clone(),
            team_annual: config.stripe_price_id_team_annual.clone(),
        };

        Ok(Some(Self { client, price_ids }))
    }

    /// Create a Stripe customer for an organization
    pub async fn create_customer(
        &self,
        organization_id: &str,
        email: &str,
        name: &str,
    ) -> Result<Customer> {
        let mut params = CreateCustomer::new();
        params.email = Some(email);
        params.name = Some(name);
        params.metadata = Some(
            [("organization_id".to_string(), organization_id.to_string())]
                .into_iter()
                .collect(),
        );

        // Stable key across retries — prevents duplicate customers if the
        // response is lost in a network partition after Stripe processes the request.
        let ikey = idempotency_key(&format!("create_customer_{}", organization_id));
        let client = self
            .client
            .clone()
            .with_strategy(stripe::RequestStrategy::Idempotent(ikey));
        stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { Customer::create(&c, p).await }
        })
        .await
    }

    /// Get a customer by ID
    pub async fn get_customer(&self, customer_id: &str) -> Result<Customer> {
        let id: CustomerId = customer_id.parse()?;
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { Customer::retrieve(&c, &i, &[]).await }
        })
        .await
    }

    /// Get the price ID for a given tier and billing interval
    pub fn get_price_id(&self, tier: &str, annual: bool) -> Result<String> {
        let price_id = match (tier.to_lowercase().as_str(), annual) {
            ("pro", false) => self.price_ids.pro_monthly.clone(),
            ("pro", true) => self.price_ids.pro_annual.clone(),
            ("team", false) => self.price_ids.team_monthly.clone(),
            ("team", true) => self.price_ids.team_annual.clone(),
            _ => return Err(anyhow!("Invalid tier for subscription: {}", tier)),
        };

        price_id.ok_or_else(|| {
            anyhow!(
                "Price ID not configured for tier: {} (annual: {})",
                tier,
                annual
            )
        })
    }

    /// Create a Stripe Checkout session for subscription
    pub async fn create_checkout_session(
        &self,
        customer_id: &str,
        tier: &str,
        seats: i64,
        annual: bool,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<CheckoutSession> {
        let price_id = self.get_price_id(tier, annual)?;
        let customer: CustomerId = customer_id.parse()?;

        let mut params = CreateCheckoutSession::new();
        params.customer = Some(customer);
        params.mode = Some(CheckoutSessionMode::Subscription);
        params.success_url = Some(success_url);
        params.cancel_url = Some(cancel_url);
        params.line_items = Some(vec![CreateCheckoutSessionLineItems {
            price: Some(price_id),
            quantity: Some(seats as u64),
            ..Default::default()
        }]);

        let ikey = idempotency_key(&format!(
            "checkout_{}_{}_{}_{}",
            customer_id, tier, seats, annual
        ));
        let client = self
            .client
            .clone()
            .with_strategy(stripe::RequestStrategy::Idempotent(ikey));
        stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { CheckoutSession::create(&c, p).await }
        })
        .await
    }

    /// Create a billing portal session for subscription management
    pub async fn create_billing_portal_session(
        &self,
        customer_id: &str,
        return_url: &str,
    ) -> Result<BillingPortalSession> {
        let customer: CustomerId = customer_id.parse()?;

        let mut params = CreateBillingPortalSession::new(customer);
        params.return_url = Some(return_url);

        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { BillingPortalSession::create(&c, p).await }
        })
        .await
    }

    /// Cancel a subscription
    pub async fn cancel_subscription(
        &self,
        subscription_id: &str,
        immediately: bool,
    ) -> Result<stripe::Subscription> {
        let id: SubscriptionId = subscription_id.parse()?;
        let client = self.client.clone();

        if immediately {
            stripe_retry(|| {
                let c = client.clone();
                let i = id.clone();
                async move {
                    stripe::Subscription::cancel(&c, &i, stripe::CancelSubscription::default())
                        .await
                }
            })
            .await
        } else {
            let mut params = stripe::UpdateSubscription::new();
            params.cancel_at_period_end = Some(true);
            stripe_retry(|| {
                let c = client.clone();
                let i = id.clone();
                let p = params.clone();
                async move { stripe::Subscription::update(&c, &i, p).await }
            })
            .await
        }
    }

    /// Update subscription seat count
    pub async fn update_subscription_seats(
        &self,
        subscription_id: &str,
        new_seats: i64,
    ) -> Result<stripe::Subscription> {
        let id: SubscriptionId = subscription_id.parse()?;
        let client = self.client.clone();

        let subscription = stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { stripe::Subscription::retrieve(&c, &i, &[]).await }
        })
        .await?;

        // Get the first subscription item
        let item = subscription
            .items
            .data
            .first()
            .ok_or_else(|| anyhow!("No subscription items found"))?;

        let item_id = item.id.clone();
        let mut update_params = stripe::UpdateSubscriptionItem::new();
        update_params.quantity = Some(new_seats as u64);

        stripe_retry(|| {
            let c = client.clone();
            let iid = item_id.clone();
            let p = update_params.clone();
            async move { stripe::SubscriptionItem::update(&c, &iid, p).await }
        })
        .await?;

        // Re-fetch the updated subscription
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { stripe::Subscription::retrieve(&c, &i, &[]).await }
        })
        .await
    }

    /// Check if a payment intent succeeded
    pub async fn get_payment_intent(&self, payment_intent_id: &str) -> Result<PaymentIntent> {
        let id = payment_intent_id.parse()?;
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { PaymentIntent::retrieve(&c, &i, &[]).await }
        })
        .await
    }

    /// Check if payment intent is successful
    pub fn is_payment_successful(intent: &PaymentIntent) -> bool {
        matches!(intent.status, PaymentIntentStatus::Succeeded)
    }

    // =========================================================================
    // Subscription Management (Upgrade/Downgrade)
    // =========================================================================

    /// Update subscription to a different tier/price
    pub async fn update_subscription_tier(
        &self,
        subscription_id: &str,
        new_tier: &str,
        annual: bool,
        seats: i64,
    ) -> Result<stripe::Subscription> {
        let id: SubscriptionId = subscription_id.parse()?;
        let new_price_id = self.get_price_id(new_tier, annual)?;
        let client = self.client.clone();

        // Retrieve current subscription
        let subscription = stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { stripe::Subscription::retrieve(&c, &i, &[]).await }
        })
        .await?;

        // Get the first subscription item
        let item = subscription
            .items
            .data
            .first()
            .ok_or_else(|| anyhow!("No subscription items found"))?;

        // Update the subscription with new price and quantity
        let mut params = stripe::UpdateSubscription::new();
        params.items = Some(vec![stripe::UpdateSubscriptionItems {
            id: Some(item.id.to_string()),
            price: Some(new_price_id),
            quantity: Some(seats as u64),
            ..Default::default()
        }]);

        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            let p = params.clone();
            async move { stripe::Subscription::update(&c, &i, p).await }
        })
        .await
    }

    /// Preview proration charges for a subscription change.
    /// Uses the actual Stripe price amounts to ensure the preview matches
    /// what Stripe will charge — no hardcoded price tables.
    pub async fn preview_proration(
        &self,
        subscription_id: &str,
        new_tier: &str,
        annual: bool,
        seats: i64,
    ) -> Result<ProrationPreview> {
        let id: SubscriptionId = subscription_id.parse()?;
        let new_price_id = self.get_price_id(new_tier, annual)?;
        let new_price_stripe_id: PriceId = new_price_id.parse()?;
        let client = self.client.clone();

        // Retrieve current subscription to get current amount
        let subscription = stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { stripe::Subscription::retrieve(&c, &i, &[]).await }
        })
        .await?;

        let current_amount = subscription
            .items
            .data
            .iter()
            .filter_map(|item| {
                let unit = item.price.as_ref()?.unit_amount?;
                let qty = item.quantity.unwrap_or(1) as i64;
                Some(unit * qty)
            })
            .sum::<i64>();

        // Retrieve the actual new price from Stripe to get the real unit amount
        let new_price = stripe_retry(|| {
            let c = client.clone();
            let pid = new_price_stripe_id.clone();
            async move { Price::retrieve(&c, &pid, &[]).await }
        })
        .await?;

        let new_unit_amount = new_price.unit_amount.unwrap_or(0);
        let new_amount = new_unit_amount * seats;

        Ok(ProrationPreview {
            current_amount_cents: current_amount,
            new_amount_cents: new_amount,
            proration_amount_cents: new_amount - current_amount,
            immediate_charge: new_amount > current_amount,
        })
    }

    // =========================================================================
    // Invoice Management
    // =========================================================================

    /// List invoices for a customer
    pub async fn list_invoices(
        &self,
        customer_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<InvoiceSummary>> {
        let customer: CustomerId = customer_id.parse()?;

        let mut params = stripe::ListInvoices::new();
        params.customer = Some(customer);
        params.limit = limit;

        let client = self.client.clone();
        let invoices = stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { Invoice::list(&c, &p).await }
        })
        .await?;

        let summaries: Vec<InvoiceSummary> = invoices
            .data
            .into_iter()
            .map(|inv| InvoiceSummary {
                id: inv.id.to_string(),
                number: inv.number,
                status: inv.status.map(|s| format!("{:?}", s)),
                amount_due: inv.amount_due,
                amount_paid: inv.amount_paid,
                currency: inv.currency.map(|c| c.to_string()),
                created: inv.created.map(|t| t.to_string()),
                period_start: inv.period_start.map(|t| t.to_string()),
                period_end: inv.period_end.map(|t| t.to_string()),
                invoice_pdf: inv.invoice_pdf,
                hosted_invoice_url: inv.hosted_invoice_url,
            })
            .collect();

        Ok(summaries)
    }

    /// Get a single invoice with line items
    pub async fn get_invoice(&self, invoice_id: &str) -> Result<InvoiceDetail> {
        let id: InvoiceId = invoice_id.parse()?;
        let client = self.client.clone();
        let invoice = stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { Invoice::retrieve(&c, &i, &[]).await }
        })
        .await?;

        let line_items: Vec<InvoiceLineItem> = invoice
            .lines
            .as_ref()
            .map(|lines| {
                lines
                    .data
                    .iter()
                    .map(|line| InvoiceLineItem {
                        description: line.description.clone(),
                        amount: line.amount,
                        quantity: line.quantity,
                        period_start: line
                            .period
                            .as_ref()
                            .and_then(|p| p.start.map(|s| s.to_string())),
                        period_end: line
                            .period
                            .as_ref()
                            .and_then(|p| p.end.map(|e| e.to_string())),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let customer_id = invoice.customer.as_ref().map(|c| match c {
            stripe::Expandable::Id(id) => id.to_string(),
            stripe::Expandable::Object(c) => c.id.to_string(),
        });

        Ok(InvoiceDetail {
            id: invoice.id.to_string(),
            customer_id,
            number: invoice.number,
            status: invoice.status.map(|s| format!("{:?}", s)),
            amount_due: invoice.amount_due,
            amount_paid: invoice.amount_paid,
            amount_remaining: invoice.amount_remaining,
            currency: invoice.currency.map(|c| c.to_string()),
            created: invoice.created.map(|t| t.to_string()),
            due_date: invoice.due_date.map(|t| t.to_string()),
            period_start: invoice.period_start.map(|t| t.to_string()),
            period_end: invoice.period_end.map(|t| t.to_string()),
            invoice_pdf: invoice.invoice_pdf,
            hosted_invoice_url: invoice.hosted_invoice_url,
            line_items,
            subtotal: invoice.subtotal,
            tax: invoice.tax,
            total: invoice.total,
        })
    }

    // =========================================================================
    // Payment Method Management
    // =========================================================================

    /// List payment methods for a customer
    pub async fn list_payment_methods(
        &self,
        customer_id: &str,
    ) -> Result<Vec<PaymentMethodSummary>> {
        let customer: CustomerId = customer_id.parse()?;

        let mut params = stripe::ListPaymentMethods::new();
        // Pass the customer ID to Stripe so the API-side filter runs,
        // preventing other customers' cards from being returned.
        params.customer = Some(customer.clone());

        let client = self.client.clone();
        let methods = stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { PaymentMethod::list(&c, &p).await }
        })
        .await?;

        let summaries: Vec<PaymentMethodSummary> = methods
            .data
            .into_iter()
            .map(|pm| {
                let card_info = pm.card.as_ref().map(|card| CardInfo {
                    brand: card.brand.clone(),
                    last4: card.last4.clone(),
                    exp_month: card.exp_month as u32,
                    exp_year: card.exp_year as u32,
                });
                PaymentMethodSummary {
                    id: pm.id.to_string(),
                    type_: "card".to_string(),
                    card: card_info,
                    created: Some(pm.created.to_string()),
                }
            })
            .collect();

        Ok(summaries)
    }

    /// Set the default payment method for a customer
    pub async fn set_default_payment_method(
        &self,
        customer_id: &str,
        payment_method_id: &str,
    ) -> Result<Customer> {
        let id: CustomerId = customer_id.parse()?;

        let mut params = stripe::UpdateCustomer::new();
        params.invoice_settings = Some(stripe::CustomerInvoiceSettings {
            default_payment_method: Some(payment_method_id.to_string()),
            ..Default::default()
        });

        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            let p = params.clone();
            async move { Customer::update(&c, &i, p).await }
        })
        .await
    }

    /// Retrieve a single payment method by ID
    pub async fn get_payment_method(&self, payment_method_id: &str) -> Result<PaymentMethod> {
        let id: PaymentMethodId = payment_method_id.parse()?;
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { PaymentMethod::retrieve(&c, &i, &[]).await }
        })
        .await
    }

    /// Detach a payment method from a customer
    pub async fn detach_payment_method(&self, payment_method_id: &str) -> Result<PaymentMethod> {
        let id: PaymentMethodId = payment_method_id.parse()?;
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { PaymentMethod::detach(&c, &i).await }
        })
        .await
    }

    /// Create a SetupIntent for adding a new payment method
    pub async fn create_setup_intent(&self, customer_id: &str) -> Result<SetupIntent> {
        let customer: CustomerId = customer_id.parse()?;

        let mut params = CreateSetupIntent::new();
        params.customer = Some(customer);
        params.payment_method_types = Some(vec!["card".to_string()]);

        // SetupIntents are single-use — every add-card flow needs a fresh intent,
        // so we must NOT use an idempotency key here.
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { SetupIntent::create(&c, p).await }
        })
        .await
    }

    // =========================================================================
    // Coupon/Promotion Code Validation
    // =========================================================================

    /// Validate a coupon or promotion code
    pub async fn validate_coupon(&self, code: &str) -> Result<CouponInfo> {
        // First try as a promotion code (user-facing code)
        let mut params = stripe::ListPromotionCodes::new();
        params.code = Some(code);
        params.active = Some(true);

        let client = self.client.clone();
        let promo_codes = stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { PromotionCode::list(&c, &p).await }
        })
        .await?;

        if let Some(promo) = promo_codes.data.first() {
            let coupon = &promo.coupon;
            return Ok(CouponInfo {
                id: coupon.id.to_string(),
                code: Some(code.to_string()),
                percent_off: coupon.percent_off,
                amount_off: coupon.amount_off,
                currency: coupon.currency.map(|c| c.to_string()),
                duration: format!("{:?}", coupon.duration),
                duration_in_months: coupon.duration_in_months.map(|m| m as i32),
                valid: coupon.valid.unwrap_or(false),
                name: coupon.name.clone(),
            });
        }

        // Try as a direct coupon ID
        let coupon_id: CouponId = code.parse().map_err(|_| anyhow!("Invalid coupon code"))?;
        let coupon = stripe_retry(|| {
            let c = client.clone();
            let cid = coupon_id.clone();
            async move { Coupon::retrieve(&c, &cid, &[]).await }
        })
        .await
        .map_err(|_| anyhow!("Coupon not found or invalid"))?;

        Ok(CouponInfo {
            id: coupon.id.to_string(),
            code: None,
            percent_off: coupon.percent_off,
            amount_off: coupon.amount_off,
            currency: coupon.currency.map(|c| c.to_string()),
            duration: format!("{:?}", coupon.duration),
            duration_in_months: coupon.duration_in_months.map(|m| m as i32),
            valid: coupon.valid.unwrap_or(false),
            name: coupon.name,
        })
    }

    /// Retrieve a checkout session by ID
    pub async fn retrieve_checkout_session(&self, session_id: &str) -> Result<CheckoutSession> {
        let id: stripe::CheckoutSessionId = session_id.parse()?;
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { CheckoutSession::retrieve(&c, &i, &[]).await }
        })
        .await
    }

    /// Retrieve a subscription by ID
    pub async fn retrieve_subscription(
        &self,
        subscription_id: &str,
    ) -> Result<stripe::Subscription> {
        let id: SubscriptionId = subscription_id.parse()?;
        let client = self.client.clone();
        stripe_retry(|| {
            let c = client.clone();
            let i = id.clone();
            async move { stripe::Subscription::retrieve(&c, &i, &[]).await }
        })
        .await
    }

    /// Determine tier from a price ID
    pub fn get_tier_from_price_id(&self, price_id: &str) -> Option<String> {
        if self.price_ids.pro_monthly.as_deref() == Some(price_id)
            || self.price_ids.pro_annual.as_deref() == Some(price_id)
        {
            Some("pro".to_string())
        } else if self.price_ids.team_monthly.as_deref() == Some(price_id)
            || self.price_ids.team_annual.as_deref() == Some(price_id)
        {
            Some("team".to_string())
        } else {
            None
        }
    }

    /// Create checkout session with optional coupon
    pub async fn create_checkout_session_with_coupon(
        &self,
        customer_id: &str,
        tier: &str,
        seats: i64,
        annual: bool,
        success_url: &str,
        cancel_url: &str,
        coupon_code: Option<&str>,
    ) -> Result<CheckoutSession> {
        let price_id = self.get_price_id(tier, annual)?;
        let customer: CustomerId = customer_id.parse()?;

        let mut params = CreateCheckoutSession::new();
        params.customer = Some(customer);
        params.mode = Some(CheckoutSessionMode::Subscription);
        params.success_url = Some(success_url);
        params.cancel_url = Some(cancel_url);
        params.line_items = Some(vec![CreateCheckoutSessionLineItems {
            price: Some(price_id),
            quantity: Some(seats as u64),
            ..Default::default()
        }]);

        // Apply coupon/promotion code if provided
        if let Some(code) = coupon_code {
            params.discounts = Some(vec![stripe::CreateCheckoutSessionDiscounts {
                coupon: None,
                promotion_code: Some(code.to_string()),
            }]);
        }

        // Enable tax ID collection
        params.tax_id_collection =
            Some(stripe::CreateCheckoutSessionTaxIdCollection { enabled: true });

        let coupon_suffix = coupon_code.unwrap_or("none");
        let ikey = idempotency_key(&format!(
            "checkout_coupon_{}_{}_{}_{}_{}",
            customer_id, tier, seats, annual, coupon_suffix
        ));
        let client = self
            .client
            .clone()
            .with_strategy(stripe::RequestStrategy::Idempotent(ikey));
        stripe_retry(|| {
            let c = client.clone();
            let p = params.clone();
            async move { CheckoutSession::create(&c, p).await }
        })
        .await
    }

    // =========================================================================
    // Tax ID Management
    // =========================================================================

    /// Add a tax ID to a customer.
    ///
    /// Known limitation: Tax ID management requires async-stripe 0.39+ API changes.
    /// See: https://docs.stripe.com/api/tax_ids
    pub async fn add_tax_id(
        &self,
        _customer_id: &str,
        type_: &str,
        _value: &str,
    ) -> Result<stripe::TaxId> {
        Err(anyhow!(
            "Tax ID management temporarily unavailable - API update needed for type: {}",
            type_
        ))
    }

    /// List tax IDs for a customer.
    ///
    /// Known limitation: Tax ID management requires async-stripe 0.39+ API changes.
    /// See: https://docs.stripe.com/api/tax_ids
    pub async fn list_tax_ids(&self, _customer_id: &str) -> Result<Vec<TaxIdInfo>> {
        Ok(Vec::new())
    }
}

// =============================================================================
// Response Types
// =============================================================================

/// Proration preview for subscription changes
#[derive(Debug, Clone, Serialize)]
pub struct ProrationPreview {
    pub current_amount_cents: i64,
    pub new_amount_cents: i64,
    pub proration_amount_cents: i64,
    pub immediate_charge: bool,
}

/// Invoice summary for list view
#[derive(Debug, Clone, Serialize)]
pub struct InvoiceSummary {
    pub id: String,
    pub number: Option<String>,
    pub status: Option<String>,
    pub amount_due: Option<i64>,
    pub amount_paid: Option<i64>,
    pub currency: Option<String>,
    pub created: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub invoice_pdf: Option<String>,
    pub hosted_invoice_url: Option<String>,
}

/// Invoice detail with line items
#[derive(Debug, Clone, Serialize)]
pub struct InvoiceDetail {
    pub id: String,
    pub customer_id: Option<String>,
    pub number: Option<String>,
    pub status: Option<String>,
    pub amount_due: Option<i64>,
    pub amount_paid: Option<i64>,
    pub amount_remaining: Option<i64>,
    pub currency: Option<String>,
    pub created: Option<String>,
    pub due_date: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub invoice_pdf: Option<String>,
    pub hosted_invoice_url: Option<String>,
    pub line_items: Vec<InvoiceLineItem>,
    pub subtotal: Option<i64>,
    pub tax: Option<i64>,
    pub total: Option<i64>,
}

/// Invoice line item
#[derive(Debug, Clone, Serialize)]
pub struct InvoiceLineItem {
    pub description: Option<String>,
    pub amount: i64,
    pub quantity: Option<u64>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}

/// Payment method summary
#[derive(Debug, Clone, Serialize)]
pub struct PaymentMethodSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub card: Option<CardInfo>,
    pub created: Option<String>,
}

/// Card information
#[derive(Debug, Clone, Serialize)]
pub struct CardInfo {
    pub brand: String,
    pub last4: String,
    pub exp_month: u32,
    pub exp_year: u32,
}

/// Coupon/promotion code info
#[derive(Debug, Clone, Serialize)]
pub struct CouponInfo {
    pub id: String,
    pub code: Option<String>,
    pub percent_off: Option<f64>,
    pub amount_off: Option<i64>,
    pub currency: Option<String>,
    pub duration: String,
    pub duration_in_months: Option<i32>,
    pub valid: bool,
    pub name: Option<String>,
}

/// Tax ID information
#[derive(Debug, Clone, Serialize)]
pub struct TaxIdInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: String,
    pub verification_status: Option<String>,
    pub country: Option<String>,
}
