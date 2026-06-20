-- =============================================================================
-- Seed realistic performance (transaction/span) data for all 4 projects
-- Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING)
--
-- Prerequisites: projects must exist (run seed-errors.sql first, or create
-- projects via the web UI / API). The project IDs below match seed-errors.sql.
--
-- Usage:
--   psql postgres://bugwatch:bugwatch_dev@localhost:5432/bugwatch -f scripts/seed-performance.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- API BACKEND (Node.js)
-- Project: 16beb156-2e25-4958-b7bb-8ff54ca51d88
-- 400 transactions: REST endpoints, ~5% error rate
-- Duration profile: p50 ~57ms, p75 ~200ms, p95 ~700ms, p99 ~2s
-- =============================================================================

WITH txns AS (
  SELECT
    i,
    CASE (i % 6)
      WHEN 0 THEN 'GET /api/users'
      WHEN 1 THEN 'POST /api/auth/login'
      WHEN 2 THEN 'GET /api/products'
      WHEN 3 THEN 'POST /api/checkout'
      WHEN 4 THEN 'DELETE /api/sessions'
      ELSE         'GET /api/orders'
    END AS txn_name,
    CASE WHEN i % 20 = 0 THEN 'error' ELSE 'ok' END AS status,
    CASE
      WHEN (i % 100) < 50 THEN 15.0  + (i % 85)    -- 15–100ms   (50%)
      WHEN (i % 100) < 85 THEN 100.0 + (i % 300)   -- 100–400ms  (35%)
      WHEN (i % 100) < 97 THEN 400.0 + (i % 600)   -- 400–1000ms (12%)
      ELSE                      1000.0 + (i % 4000) -- 1–5s        (3%)
    END AS duration_ms,
    -- spread evenly over 30 days with a small jitter per row
    NOW() - make_interval(secs => ((i - 1) * 6480 + (i * 137 % 3600))::float) AS started_at,
    CASE WHEN i % 30 = 0 THEN 'staging' ELSE 'production' END AS env,
    'v' || (1 + i % 3) || '.' || (i % 10) || '.0' AS release,
    CASE WHEN i % 3 = 0 THEN 'user-' || (i % 50 + 1) ELSE NULL END AS user_id
  FROM generate_series(1, 400) i
)
INSERT INTO transactions (
  id, project_id, transaction_name, trace_id, span_id,
  op, status, duration_ms, started_at, finished_at,
  environment, release, tags, user_id
)
SELECT
  'seed-perf-api-' || lpad(i::text, 5, '0'),
  '16beb156-2e25-4958-b7bb-8ff54ca51d88',
  txn_name,
  substr(md5('api-trace-' || i), 1, 32),
  substr(md5('api-root-' || i), 1, 16),
  'http.server',
  status,
  duration_ms,
  started_at,
  started_at + make_interval(secs => duration_ms / 1000.0),
  env,
  release,
  '{"runtime":"node","node_version":"18.17.0"}',
  user_id
FROM txns
ON CONFLICT (id) DO NOTHING;

-- db.query spans (35% of parent duration, offset slightly from start)
INSERT INTO spans (
  id, transaction_id, span_id, parent_span_id,
  op, description, status, duration_ms, started_at, finished_at, data
)
SELECT
  'seed-span-api-db-' || lpad(i::text, 5, '0'),
  'seed-perf-api-'    || lpad(i::text, 5, '0'),
  substr(md5('api-db-'    || i), 1, 16),
  substr(md5('api-root-'  || i), 1, 16),
  'db.query',
  CASE (i % 4)
    WHEN 0 THEN 'SELECT * FROM users WHERE id = $1'
    WHEN 1 THEN 'SELECT id, name, email FROM users LIMIT 50'
    WHEN 2 THEN 'INSERT INTO orders (user_id, total) VALUES ($1, $2)'
    ELSE         'SELECT * FROM products WHERE active = true'
  END,
  CASE WHEN i % 20 = 0 THEN 'error' ELSE 'ok' END,
  dur * 0.35,
  started_at + make_interval(secs => dur * 0.02  / 1000.0),
  started_at + make_interval(secs => dur * 0.37  / 1000.0),
  '{"db.system":"postgresql","db.name":"bugwatch"}'
FROM (
  SELECT
    i,
    CASE
      WHEN (i % 100) < 50 THEN 15.0  + (i % 85)
      WHEN (i % 100) < 85 THEN 100.0 + (i % 300)
      WHEN (i % 100) < 97 THEN 400.0 + (i % 600)
      ELSE                      1000.0 + (i % 4000)
    END AS dur,
    NOW() - make_interval(secs => ((i - 1) * 6480 + (i * 137 % 3600))::float) AS started_at
  FROM generate_series(1, 400) i
) s
ON CONFLICT (id) DO NOTHING;

-- cache.get spans (5% of parent duration, before the db query)
INSERT INTO spans (
  id, transaction_id, span_id, parent_span_id,
  op, description, status, duration_ms, started_at, finished_at, data
)
SELECT
  'seed-span-api-cache-' || lpad(i::text, 5, '0'),
  'seed-perf-api-'       || lpad(i::text, 5, '0'),
  substr(md5('api-cache-' || i), 1, 16),
  substr(md5('api-root-'  || i), 1, 16),
  'cache.get',
  CASE (i % 3)
    WHEN 0 THEN 'users:list'
    WHEN 1 THEN 'product:catalog'
    ELSE         'session:' || i
  END,
  'ok',
  dur * 0.05,
  started_at + make_interval(secs => dur * 0.005 / 1000.0),
  started_at + make_interval(secs => dur * 0.055 / 1000.0),
  '{"cache.system":"redis","cache.hit":true}'
FROM (
  SELECT
    i,
    CASE
      WHEN (i % 100) < 50 THEN 15.0  + (i % 85)
      WHEN (i % 100) < 85 THEN 100.0 + (i % 300)
      WHEN (i % 100) < 97 THEN 400.0 + (i % 600)
      ELSE                      1000.0 + (i % 4000)
    END AS dur,
    NOW() - make_interval(secs => ((i - 1) * 6480 + (i * 137 % 3600))::float) AS started_at
  FROM generate_series(1, 400) i
) s
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- MARKETING SITE (Next.js)
-- Project: 712e4a4d-469b-483c-952e-d572f2fa27c6
-- 200 transactions: pageload + navigation, 4% error rate
-- Duration profile: p50 ~800ms, p75 ~2s, p95 ~4s (typical page loads)
-- =============================================================================

WITH txns AS (
  SELECT
    i,
    CASE (i % 5)
      WHEN 0 THEN 'pageload /'
      WHEN 1 THEN 'pageload /products'
      WHEN 2 THEN 'pageload /blog'
      WHEN 3 THEN 'navigation /products/:id'
      ELSE         'navigation /checkout'
    END AS txn_name,
    CASE (i % 5) < 3 WHEN true THEN 'pageload' ELSE 'navigation' END AS op,
    CASE WHEN i % 25 = 0 THEN 'error' ELSE 'ok' END AS status,
    CASE
      WHEN (i % 100) < 40 THEN 300.0  + (i % 700)   -- 300ms–1s  (40%)
      WHEN (i % 100) < 80 THEN 1000.0 + (i % 2000)  -- 1–3s      (40%)
      WHEN (i % 100) < 95 THEN 3000.0 + (i % 2000)  -- 3–5s      (15%)
      ELSE                      5000.0 + (i % 5000)  -- 5–10s      (5%)
    END AS duration_ms,
    NOW() - make_interval(secs => ((i - 1) * 12960 + (i * 211 % 3600))::float) AS started_at,
    'v2.' || (i % 5) || '.0' AS release
  FROM generate_series(1, 200) i
)
INSERT INTO transactions (
  id, project_id, transaction_name, trace_id, span_id,
  op, status, duration_ms, started_at, finished_at,
  environment, release, tags
)
SELECT
  'seed-perf-mktg-' || lpad(i::text, 5, '0'),
  '712e4a4d-469b-483c-952e-d572f2fa27c6',
  txn_name,
  substr(md5('mktg-trace-' || i), 1, 32),
  substr(md5('mktg-root-'  || i), 1, 16),
  op,
  status,
  duration_ms,
  started_at,
  started_at + make_interval(secs => duration_ms / 1000.0),
  'production',
  release,
  '{"browser":"Chrome","browser_version":"120.0","framework":"nextjs"}'
FROM txns
ON CONFLICT (id) DO NOTHING;

-- resource.script spans (JS bundle loading, 25% of page load time)
INSERT INTO spans (
  id, transaction_id, span_id, parent_span_id,
  op, description, status, duration_ms, started_at, finished_at, data
)
SELECT
  'seed-span-mktg-' || lpad(i::text, 5, '0'),
  'seed-perf-mktg-' || lpad(i::text, 5, '0'),
  substr(md5('mktg-span-' || i), 1, 16),
  substr(md5('mktg-root-' || i), 1, 16),
  'resource.script',
  CASE (i % 3)
    WHEN 0 THEN '/static/chunks/main.js'
    WHEN 1 THEN '/static/chunks/vendor.js'
    ELSE         '/static/css/app.css'
  END,
  'ok',
  dur * 0.25,
  started_at + make_interval(secs => dur * 0.05 / 1000.0),
  started_at + make_interval(secs => dur * 0.30 / 1000.0),
  '{"resource.size_bytes":245760,"resource.encoded_size":82400}'
FROM (
  SELECT
    i,
    CASE
      WHEN (i % 100) < 40 THEN 300.0  + (i % 700)
      WHEN (i % 100) < 80 THEN 1000.0 + (i % 2000)
      WHEN (i % 100) < 95 THEN 3000.0 + (i % 2000)
      ELSE                      5000.0 + (i % 5000)
    END AS dur,
    NOW() - make_interval(secs => ((i - 1) * 12960 + (i * 211 % 3600))::float) AS started_at
  FROM generate_series(1, 200) i
) s
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- DATA PIPELINE (Python)
-- Project: 9c082871-b1eb-4f9e-9921-0550fe159237
-- 150 transactions: background tasks/jobs, ~7% error rate
-- Duration profile: p50 ~5s, p75 ~12s, p95 ~25s (batch processing)
-- =============================================================================

WITH txns AS (
  SELECT
    i,
    CASE (i % 5)
      WHEN 0 THEN 'task.process_events'
      WHEN 1 THEN 'task.send_emails'
      WHEN 2 THEN 'task.sync_inventory'
      WHEN 3 THEN 'task.generate_reports'
      ELSE         'task.cleanup_sessions'
    END AS txn_name,
    CASE WHEN i % 15 = 0 THEN 'error' ELSE 'ok' END AS status,
    CASE
      WHEN (i % 100) < 30 THEN 500.0   + (i % 1500)  -- 0.5–2s   (30%)
      WHEN (i % 100) < 70 THEN 2000.0  + (i % 8000)  -- 2–10s    (40%)
      WHEN (i % 100) < 90 THEN 10000.0 + (i % 20000) -- 10–30s   (20%)
      ELSE                      30000.0 + (i % 30000) -- 30–60s   (10%)
    END AS duration_ms,
    NOW() - make_interval(secs => ((i - 1) * 17280 + (i * 311 % 3600))::float) AS started_at,
    '1.' || (i % 8) || '.0' AS release
  FROM generate_series(1, 150) i
)
INSERT INTO transactions (
  id, project_id, transaction_name, trace_id, span_id,
  op, status, duration_ms, started_at, finished_at,
  environment, release, tags
)
SELECT
  'seed-perf-pipe-' || lpad(i::text, 5, '0'),
  '9c082871-b1eb-4f9e-9921-0550fe159237',
  txn_name,
  substr(md5('pipe-trace-' || i), 1, 32),
  substr(md5('pipe-root-'  || i), 1, 16),
  'task',
  status,
  duration_ms,
  started_at,
  started_at + make_interval(secs => duration_ms / 1000.0),
  'production',
  release,
  '{"runtime":"python","python_version":"3.11.4","worker":"celery"}'
FROM txns
ON CONFLICT (id) DO NOTHING;

-- db.query spans (bulk queries dominate pipeline time, 60% of duration)
INSERT INTO spans (
  id, transaction_id, span_id, parent_span_id,
  op, description, status, duration_ms, started_at, finished_at, data
)
SELECT
  'seed-span-pipe-' || lpad(i::text, 5, '0'),
  'seed-perf-pipe-' || lpad(i::text, 5, '0'),
  substr(md5('pipe-span-' || i), 1, 16),
  substr(md5('pipe-root-' || i), 1, 16),
  'db.query',
  CASE (i % 3)
    WHEN 0 THEN 'UPDATE events SET processed = true WHERE processed = false LIMIT 1000'
    WHEN 1 THEN 'SELECT * FROM email_queue WHERE sent_at IS NULL LIMIT 500'
    ELSE         'INSERT INTO reports SELECT date_trunc(''hour'', created_at), count(*) FROM events GROUP BY 1'
  END,
  'ok',
  dur * 0.60,
  started_at + make_interval(secs => dur * 0.05 / 1000.0),
  started_at + make_interval(secs => dur * 0.65 / 1000.0),
  '{"db.system":"postgresql","db.rows_affected":1000}'
FROM (
  SELECT
    i,
    CASE
      WHEN (i % 100) < 30 THEN 500.0   + (i % 1500)
      WHEN (i % 100) < 70 THEN 2000.0  + (i % 8000)
      WHEN (i % 100) < 90 THEN 10000.0 + (i % 20000)
      ELSE                      30000.0 + (i % 30000)
    END AS dur,
    NOW() - make_interval(secs => ((i - 1) * 17280 + (i * 311 % 3600))::float) AS started_at
  FROM generate_series(1, 150) i
) s
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- MOBILE APP (React Native)
-- Project: a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4
-- 100 transactions: http.client + navigation, ~10% error rate (network failures)
-- Duration profile: p50 ~180ms, p75 ~500ms, p95 ~2s (mobile network variance)
-- =============================================================================

WITH txns AS (
  SELECT
    i,
    CASE (i % 5)
      WHEN 0 THEN 'http.client GET /api/products'
      WHEN 1 THEN 'http.client POST /api/auth/login'
      WHEN 2 THEN 'http.client GET /api/orders'
      WHEN 3 THEN 'http.client POST /api/checkout'
      ELSE         'navigation HomeScreen'
    END AS txn_name,
    CASE (i % 5) WHEN 4 THEN 'navigation' ELSE 'http.client' END AS op,
    CASE WHEN i % 10 = 0 THEN 'error' ELSE 'ok' END AS status,
    CASE
      WHEN (i % 100) < 60 THEN 80.0   + (i % 220)  -- 80–300ms    (60%) good signal
      WHEN (i % 100) < 85 THEN 300.0  + (i % 700)  -- 300ms–1s    (25%) medium
      WHEN (i % 100) < 95 THEN 1000.0 + (i % 2000) -- 1–3s        (10%) poor signal
      ELSE                      3000.0 + (i % 7000) -- 3–10s        (5%) very poor
    END AS duration_ms,
    NOW() - make_interval(secs => ((i - 1) * 25920 + (i * 431 % 3600))::float) AS started_at,
    '3.' || (i % 6) || '.0' AS release
  FROM generate_series(1, 100) i
)
INSERT INTO transactions (
  id, project_id, transaction_name, trace_id, span_id,
  op, status, duration_ms, started_at, finished_at,
  environment, release, tags
)
SELECT
  'seed-perf-mob-' || lpad(i::text, 5, '0'),
  'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
  txn_name,
  substr(md5('mob-trace-' || i), 1, 32),
  substr(md5('mob-root-'  || i), 1, 16),
  op,
  status,
  duration_ms,
  started_at,
  started_at + make_interval(secs => duration_ms / 1000.0),
  'production',
  release,
  '{"os":"iOS","os_version":"17.2","device":"iPhone 15","network":"wifi"}'
FROM txns
ON CONFLICT (id) DO NOTHING;

COMMIT;
