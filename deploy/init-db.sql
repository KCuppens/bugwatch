-- =============================================================================
-- Bugwatch PostgreSQL Initialization
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Performance tuning for production
-- These settings will be applied on next restart
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '768MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '8MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET min_wal_size = '512MB';
ALTER SYSTEM SET max_wal_size = '2GB';

-- Log slow queries (> 1 second)
ALTER SYSTEM SET log_min_duration_statement = 1000;
