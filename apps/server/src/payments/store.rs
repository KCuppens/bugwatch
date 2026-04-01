use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AgentPayment {
    pub id: String,
    pub nonce: String,
    pub organization_id: String,
    pub agent_key_id: Option<String>,
    pub resource: String,
    pub payment_type: String,
    pub feature: Option<String>,
    pub grant_type: Option<String>,
    pub grant_quantity: Option<i64>,
    pub amount_usdc: i64,
    pub tx_hash: Option<String>,
    pub status: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
    pub consumed_at: Option<DateTime<Utc>>,
}

pub struct PaymentStore {
    pub pool: PgPool,
}

impl PaymentStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_feature_challenge(
        &self,
        nonce: &str,
        org_id: &str,
        agent_key_id: Option<&str>,
        resource: &str,
        feature: &str,
        amount_usdc: i64,
        ttl_secs: i64,
    ) -> Result<AgentPayment, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let expires_at = Utc::now() + chrono::Duration::seconds(ttl_secs);
        sqlx::query_as::<_, AgentPayment>(
            r#"INSERT INTO agent_payments
               (id, nonce, organization_id, agent_key_id, resource, payment_type, feature, amount_usdc, expires_at)
               VALUES ($1, $2, $3, $4, $5, 'feature_access', $6, $7, $8)
               RETURNING id, nonce, organization_id, agent_key_id, resource, payment_type, feature,
                         grant_type, grant_quantity, amount_usdc, tx_hash, status, expires_at,
                         created_at, verified_at, consumed_at"#,
        )
        .bind(id)
        .bind(nonce)
        .bind(org_id)
        .bind(agent_key_id)
        .bind(resource)
        .bind(feature)
        .bind(amount_usdc)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn create_capacity_challenge(
        &self,
        nonce: &str,
        org_id: &str,
        agent_key_id: Option<&str>,
        resource: &str,
        grant_type: &str,
        grant_quantity: i64,
        amount_usdc: i64,
        ttl_secs: i64,
    ) -> Result<AgentPayment, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let expires_at = Utc::now() + chrono::Duration::seconds(ttl_secs);
        sqlx::query_as::<_, AgentPayment>(
            r#"INSERT INTO agent_payments
               (id, nonce, organization_id, agent_key_id, resource, payment_type, grant_type, grant_quantity, amount_usdc, expires_at)
               VALUES ($1, $2, $3, $4, $5, 'capacity_grant', $6, $7, $8, $9)
               RETURNING id, nonce, organization_id, agent_key_id, resource, payment_type, feature,
                         grant_type, grant_quantity, amount_usdc, tx_hash, status, expires_at,
                         created_at, verified_at, consumed_at"#,
        )
        .bind(id)
        .bind(nonce)
        .bind(org_id)
        .bind(agent_key_id)
        .bind(resource)
        .bind(grant_type)
        .bind(grant_quantity)
        .bind(amount_usdc)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_by_nonce(&self, nonce: &str) -> Result<Option<AgentPayment>, sqlx::Error> {
        sqlx::query_as::<_, AgentPayment>(
            r#"SELECT id, nonce, organization_id, agent_key_id, resource, payment_type, feature,
                      grant_type, grant_quantity, amount_usdc, tx_hash, status, expires_at,
                      created_at, verified_at, consumed_at
               FROM agent_payments WHERE nonce = $1"#,
        )
        .bind(nonce)
        .fetch_optional(&self.pool)
        .await
    }

    /// Atomically claims a pending payment nonce. Returns None if nonce not found or already used/expired.
    pub async fn claim_pending(&self, nonce: &str) -> Result<Option<AgentPayment>, sqlx::Error> {
        sqlx::query_as::<_, AgentPayment>(
            "UPDATE agent_payments SET status = 'verified', verified_at = NOW()
             WHERE nonce = $1 AND status = 'pending' AND expires_at > NOW()
             RETURNING *",
        )
        .bind(nonce)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn mark_consumed(&self, nonce: &str, tx_hash: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE agent_payments SET status = 'consumed', consumed_at = NOW(), tx_hash = $1 WHERE nonce = $2",
        )
        .bind(tx_hash)
        .bind(nonce)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn expire_old(&self) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agent_payments SET status = 'expired' WHERE status IN ('pending', 'verified') AND expires_at < NOW()",
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }
}
