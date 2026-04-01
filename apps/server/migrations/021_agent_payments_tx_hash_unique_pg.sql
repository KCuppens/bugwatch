-- Prevent the same on-chain transaction from satisfying multiple payment challenges.
-- PostgreSQL UNIQUE indexes ignore NULL values, so pending/verified records (tx_hash=NULL) are unaffected.
CREATE UNIQUE INDEX idx_agent_payments_tx_hash ON agent_payments(tx_hash) WHERE tx_hash IS NOT NULL;
