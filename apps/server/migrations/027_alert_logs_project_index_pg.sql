-- Composite index for alert_logs list_by_project query.
-- The query joins alert_logs -> alert_rules filtering by project_id and orders
-- by al.created_at DESC. The existing partial index (alert_rule_id, created_at)
-- WHERE status='sent' cannot be used here. A full composite index lets the
-- planner merge-sort per-rule index scans instead of sorting a full table scan.
CREATE INDEX IF NOT EXISTS idx_alert_logs_rule_created
    ON alert_logs (alert_rule_id, created_at DESC);
