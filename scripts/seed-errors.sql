-- =============================================================================
-- Seed realistic error data for all 4 projects
-- Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING)
--
-- Usage:
--   psql postgres://bugwatch:bugwatch_dev@localhost:5432/bugwatch -f scripts/seed-errors.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- MARKETING SITE  (Next.js)
-- Project: 712e4a4d-469b-483c-952e-d572f2fa27c6
-- =============================================================================

INSERT INTO issues (id, project_id, fingerprint, title, status, level, first_seen, last_seen, count, user_count, environment) VALUES

  ('seed-mktg-0001-0000-0000-000000000001',
   '712e4a4d-469b-483c-952e-d572f2fa27c6',
   md5('mktg:TypeError:ProductList:map'),
   'TypeError: Cannot read properties of undefined (reading ''map'')',
   'unresolved', 'error',
   NOW() - INTERVAL '28 days', NOW() - INTERVAL '45 minutes',
   247, 89, 'production'),

  ('seed-mktg-0001-0000-0000-000000000002',
   '712e4a4d-469b-483c-952e-d572f2fa27c6',
   md5('mktg:ChunkLoadError:webpack:chunk8'),
   'ChunkLoadError: Loading chunk 8 failed. (missing: /static/chunks/8.abc123.js)',
   'unresolved', 'error',
   NOW() - INTERVAL '14 days', NOW() - INTERVAL '3 hours',
   45, 32, 'production'),

  ('seed-mktg-0001-0000-0000-000000000003',
   '712e4a4d-469b-483c-952e-d572f2fa27c6',
   md5('mktg:Error:hydration:418'),
   'React Error #418: Hydration failed: Server-rendered HTML didn''t match client content (text mismatch)',
   'unresolved', 'error',
   NOW() - INTERVAL '21 days', NOW() - INTERVAL '2 hours',
   384, 201, 'production'),

  ('seed-mktg-0001-0000-0000-000000000004',
   '712e4a4d-469b-483c-952e-d572f2fa27c6',
   md5('mktg:ReferenceError:window:ssr'),
   'ReferenceError: window is not defined',
   'unresolved', 'warning',
   NOW() - INTERVAL '9 days', NOW() - INTERVAL '6 hours',
   12, 1, 'production'),

  ('seed-mktg-0001-0000-0000-000000000005',
   '712e4a4d-469b-483c-952e-d572f2fa27c6',
   md5('mktg:Error:fetch:newsletter'),
   'Error: Failed to fetch — POST /api/newsletter/subscribe',
   'unresolved', 'error',
   NOW() - INTERVAL '7 days', NOW() - INTERVAL '30 minutes',
   67, 67, 'production'),

  ('seed-mktg-0001-0000-0000-000000000006',
   '712e4a4d-469b-483c-952e-d572f2fa27c6',
   md5('mktg:SyntaxError:json:cms'),
   'SyntaxError: Unexpected end of JSON input',
   'resolved', 'error',
   NOW() - INTERVAL '35 days', NOW() - INTERVAL '20 days',
   23, 1, 'production')

ON CONFLICT (project_id, fingerprint) DO NOTHING;

-- Events: Marketing Site
INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mktg-0001-0000-0000-000000000001',
  gen_random_uuid()::text,
  NOW() - INTERVAL '28 days' + (random() * (INTERVAL '28 days' - INTERVAL '45 minutes')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-15T10:23:45.123Z",
    "level": "error",
    "exception": {
      "type": "TypeError",
      "value": "Cannot read properties of undefined (reading 'map')",
      "stacktrace": [
        {"filename": "src/components/ProductList.tsx", "function": "ProductList", "lineno": 42, "colno": 18, "in_app": true, "context_line": "  return products.map(p => <ProductCard key={p.id} product={p} />)"},
        {"filename": "src/pages/shop.tsx", "function": "ShopPage", "lineno": 89, "colno": 5, "in_app": true},
        {"filename": "node_modules/next/dist/server/render.js", "function": "renderToHTML", "lineno": 512, "colno": 10, "in_app": false}
      ]
    },
    "environment": "production",
    "release": "1.4.2",
    "platform": "javascript",
    "request": {"url": "https://bugwatch.dev/shop", "method": "GET"},
    "user": {"id": "usr_anon", "ip_address": "93.184.216.34"},
    "tags": {"browser": "Chrome 120", "os": "macOS 14", "route": "/shop"},
    "breadcrumbs": [
      {"timestamp": "2024-01-15T10:23:40.000Z", "type": "navigation", "category": "navigation", "message": "Navigated to /shop"},
      {"timestamp": "2024-01-15T10:23:44.000Z", "type": "http", "category": "fetch", "message": "GET /api/products 200"}
    ]
  }$p$::text,
  NOW()
FROM generate_series(1, 15);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mktg-0001-0000-0000-000000000002',
  gen_random_uuid()::text,
  NOW() - INTERVAL '14 days' + (random() * (INTERVAL '14 days' - INTERVAL '3 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-20T14:05:12.000Z",
    "level": "error",
    "exception": {
      "type": "ChunkLoadError",
      "value": "Loading chunk 8 failed. (missing: /static/chunks/8.abc123.js)",
      "stacktrace": [
        {"filename": "webpack/runtime/require.js", "function": "requireEnsure", "lineno": 14, "colno": 3, "in_app": false},
        {"filename": "src/pages/_app.tsx", "function": "loadDynamicComponent", "lineno": 23, "colno": 9, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "1.4.1",
    "platform": "javascript",
    "request": {"url": "https://bugwatch.dev/blog", "method": "GET"},
    "tags": {"browser": "Safari 17", "os": "iOS 17", "route": "/blog"}
  }$p$::text,
  NOW()
FROM generate_series(1, 8);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mktg-0001-0000-0000-000000000003',
  gen_random_uuid()::text,
  NOW() - INTERVAL '21 days' + (random() * (INTERVAL '21 days' - INTERVAL '2 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-10T08:15:33.000Z",
    "level": "error",
    "exception": {
      "type": "Error",
      "value": "Minified React error #418",
      "stacktrace": [
        {"filename": "node_modules/react-dom/cjs/react-dom.production.min.js", "function": "throwOnHydrationMismatch", "lineno": 1, "colno": 9182, "in_app": false},
        {"filename": "src/components/PriceDisplay.tsx", "function": "PriceDisplay", "lineno": 18, "colno": 12, "in_app": true, "context_line": "  <span>{formatCurrency(price)}</span>"}
      ]
    },
    "environment": "production",
    "release": "1.4.0",
    "platform": "javascript",
    "request": {"url": "https://bugwatch.dev/pricing", "method": "GET"},
    "tags": {"browser": "Firefox 121", "os": "Windows 11", "route": "/pricing"}
  }$p$::text,
  NOW()
FROM generate_series(1, 20);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mktg-0001-0000-0000-000000000004',
  gen_random_uuid()::text,
  NOW() - INTERVAL '9 days' + (random() * (INTERVAL '9 days' - INTERVAL '6 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-24T11:02:00.000Z",
    "level": "warning",
    "exception": {
      "type": "ReferenceError",
      "value": "window is not defined",
      "stacktrace": [
        {"filename": "src/lib/analytics.ts", "function": "initAnalytics", "lineno": 7, "colno": 3, "in_app": true, "context_line": "  window.dataLayer = window.dataLayer || []"},
        {"filename": "src/pages/_document.tsx", "function": "Document", "lineno": 15, "colno": 5, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "1.4.2",
    "platform": "javascript",
    "server_name": "vercel-edge-fra1",
    "tags": {"runtime": "edge", "region": "fra1"}
  }$p$::text,
  NOW()
FROM generate_series(1, 5);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mktg-0001-0000-0000-000000000005',
  gen_random_uuid()::text,
  NOW() - INTERVAL '7 days' + (random() * (INTERVAL '7 days' - INTERVAL '30 minutes')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-26T16:44:21.000Z",
    "level": "error",
    "exception": {
      "type": "TypeError",
      "value": "Failed to fetch",
      "stacktrace": [
        {"filename": "src/components/NewsletterForm.tsx", "function": "handleSubmit", "lineno": 34, "colno": 22, "in_app": true, "context_line": "  await fetch('/api/newsletter/subscribe', { method: 'POST', body })"},
        {"filename": "src/components/NewsletterForm.tsx", "function": "onClick", "lineno": 68, "colno": 5, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "1.4.2",
    "platform": "javascript",
    "request": {"url": "https://bugwatch.dev/", "method": "POST"},
    "user": {"ip_address": "185.220.101.47"},
    "tags": {"browser": "Chrome 120", "os": "Ubuntu 22.04"}
  }$p$::text,
  NOW()
FROM generate_series(1, 10);


-- =============================================================================
-- API BACKEND  (Node.js)
-- Project: 16beb156-2e25-4958-b7bb-8ff54ca51d88
-- =============================================================================

INSERT INTO issues (id, project_id, fingerprint, title, status, level, first_seen, last_seen, count, user_count, environment) VALUES

  ('seed-api0-0001-0000-0000-000000000001',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:Error:db:econnrefused'),
   'Error: connect ECONNREFUSED ::1:5432',
   'unresolved', 'fatal',
   NOW() - INTERVAL '3 days', NOW() - INTERVAL '10 minutes',
   34, 1, 'production'),

  ('seed-api0-0001-0000-0000-000000000002',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:TypeError:null:userId'),
   'TypeError: Cannot read properties of null (reading ''id'')',
   'unresolved', 'error',
   NOW() - INTERVAL '19 days', NOW() - INTERVAL '1 hour',
   156, 98, 'production'),

  ('seed-api0-0001-0000-0000-000000000003',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:SyntaxError:json:upstream'),
   'SyntaxError: Unexpected token ''<'', "<!DOCTYPE "... is not valid JSON',
   'unresolved', 'error',
   NOW() - INTERVAL '11 days', NOW() - INTERVAL '4 hours',
   28, 1, 'staging'),

  ('seed-api0-0001-0000-0000-000000000004',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:Error:etimedout:stripe'),
   'Error: ETIMEDOUT — POST https://api.stripe.com/v1/charges',
   'unresolved', 'error',
   NOW() - INTERVAL '16 days', NOW() - INTERVAL '2 hours',
   89, 72, 'production'),

  ('seed-api0-0001-0000-0000-000000000005',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:JsonWebTokenError:invalid:signature'),
   'JsonWebTokenError: invalid signature',
   'unresolved', 'error',
   NOW() - INTERVAL '8 days', NOW() - INTERVAL '5 hours',
   44, 44, 'production'),

  ('seed-api0-0001-0000-0000-000000000006',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:ValidationError:email:invalid'),
   'ValidationError: "email" must be a valid email address',
   'unresolved', 'warning',
   NOW() - INTERVAL '30 days', NOW() - INTERVAL '20 minutes',
   312, 312, 'production'),

  ('seed-api0-0001-0000-0000-000000000007',
   '16beb156-2e25-4958-b7bb-8ff54ca51d88',
   md5('api:RangeError:callstack:exceeded'),
   'RangeError: Maximum call stack size exceeded',
   'resolved', 'fatal',
   NOW() - INTERVAL '45 days', NOW() - INTERVAL '30 days',
   8, 1, 'production')

ON CONFLICT (project_id, fingerprint) DO NOTHING;

-- Events: API Backend
INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-api0-0001-0000-0000-000000000001',
  gen_random_uuid()::text,
  NOW() - INTERVAL '3 days' + (random() * (INTERVAL '3 days' - INTERVAL '10 minutes')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-30T03:12:45.000Z",
    "level": "fatal",
    "exception": {
      "type": "Error",
      "value": "connect ECONNREFUSED ::1:5432",
      "stacktrace": [
        {"filename": "node_modules/pg/lib/connection.js", "function": "Connection.connect", "lineno": 54, "colno": 15, "in_app": false},
        {"filename": "node_modules/pg-pool/index.js", "function": "Pool.connect", "lineno": 130, "colno": 9, "in_app": false},
        {"filename": "src/db/pool.ts", "function": "getConnection", "lineno": 18, "colno": 24, "in_app": true, "context_line": "  const client = await pool.connect()"},
        {"filename": "src/middleware/auth.ts", "function": "requireAuth", "lineno": 44, "colno": 5, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "2.8.1",
    "platform": "node",
    "server_name": "api-prod-2",
    "tags": {"service": "api", "host": "api-prod-2", "node_version": "20.10.0"},
    "breadcrumbs": [
      {"timestamp": "2024-01-30T03:12:44.000Z", "type": "query", "category": "db", "message": "Attempting pool.connect()"},
      {"timestamp": "2024-01-30T03:12:45.000Z", "type": "error", "category": "db", "message": "Connection refused on port 5432"}
    ]
  }$p$::text,
  NOW()
FROM generate_series(1, 12);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-api0-0001-0000-0000-000000000002',
  gen_random_uuid()::text,
  NOW() - INTERVAL '19 days' + (random() * (INTERVAL '19 days' - INTERVAL '1 hour')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-13T17:30:00.000Z",
    "level": "error",
    "exception": {
      "type": "TypeError",
      "value": "Cannot read properties of null (reading 'id')",
      "stacktrace": [
        {"filename": "src/api/routes/users.ts", "function": "getUserProfile", "lineno": 67, "colno": 28, "in_app": true, "context_line": "  const orgId = user.organization.id"},
        {"filename": "src/api/routes/users.ts", "function": "router.get", "lineno": 30, "colno": 3, "in_app": true},
        {"filename": "node_modules/express/lib/router/layer.js", "function": "Layer.handle", "lineno": 95, "colno": 5, "in_app": false}
      ]
    },
    "environment": "production",
    "release": "2.8.0",
    "platform": "node",
    "server_name": "api-prod-1",
    "request": {"url": "/api/v1/users/profile", "method": "GET", "headers": {"x-user-id": "usr_abc123"}},
    "user": {"id": "usr_abc123", "email": "alice@example.com"},
    "tags": {"service": "api", "endpoint": "GET /users/profile"}
  }$p$::text,
  NOW()
FROM generate_series(1, 18);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-api0-0001-0000-0000-000000000004',
  gen_random_uuid()::text,
  NOW() - INTERVAL '16 days' + (random() * (INTERVAL '16 days' - INTERVAL '2 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-16T22:11:08.000Z",
    "level": "error",
    "exception": {
      "type": "Error",
      "value": "ETIMEDOUT",
      "stacktrace": [
        {"filename": "node_modules/stripe/lib/net/HttpClient.js", "function": "makeRequest", "lineno": 89, "colno": 13, "in_app": false},
        {"filename": "src/services/payments.ts", "function": "chargeCard", "lineno": 112, "colno": 18, "in_app": true, "context_line": "  const charge = await stripe.charges.create(params)"},
        {"filename": "src/api/routes/checkout.ts", "function": "processCheckout", "lineno": 55, "colno": 7, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "2.8.0",
    "platform": "node",
    "server_name": "api-prod-1",
    "request": {"url": "/api/v1/checkout", "method": "POST"},
    "user": {"id": "usr_xyz789", "email": "bob@company.com"},
    "tags": {"service": "payments", "stripe_api": "charges.create"}
  }$p$::text,
  NOW()
FROM generate_series(1, 14);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-api0-0001-0000-0000-000000000005',
  gen_random_uuid()::text,
  NOW() - INTERVAL '8 days' + (random() * (INTERVAL '8 days' - INTERVAL '5 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-24T09:45:00.000Z",
    "level": "error",
    "exception": {
      "type": "JsonWebTokenError",
      "value": "invalid signature",
      "stacktrace": [
        {"filename": "node_modules/jsonwebtoken/verify.js", "function": "verify", "lineno": 63, "colno": 21, "in_app": false},
        {"filename": "src/middleware/auth.ts", "function": "verifyToken", "lineno": 29, "colno": 14, "in_app": true, "context_line": "  const decoded = jwt.verify(token, process.env.JWT_SECRET)"},
        {"filename": "src/middleware/auth.ts", "function": "requireAuth", "lineno": 12, "colno": 5, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "2.8.1",
    "platform": "node",
    "server_name": "api-prod-3",
    "request": {"url": "/api/v1/dashboard", "method": "GET"},
    "tags": {"service": "api", "auth": "jwt"}
  }$p$::text,
  NOW()
FROM generate_series(1, 10);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-api0-0001-0000-0000-000000000006',
  gen_random_uuid()::text,
  NOW() - INTERVAL '30 days' + (random() * (INTERVAL '30 days' - INTERVAL '20 minutes')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-02T11:20:00.000Z",
    "level": "warning",
    "exception": {
      "type": "ValidationError",
      "value": "\"email\" must be a valid email address",
      "stacktrace": [
        {"filename": "node_modules/joi/lib/validator.js", "function": "Validator.finalize", "lineno": 162, "colno": 19, "in_app": false},
        {"filename": "src/middleware/validate.ts", "function": "validate", "lineno": 14, "colno": 22, "in_app": true},
        {"filename": "src/api/routes/auth.ts", "function": "router.post", "lineno": 28, "colno": 3, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "2.7.4",
    "platform": "node",
    "server_name": "api-prod-1",
    "request": {"url": "/api/v1/auth/signup", "method": "POST"},
    "tags": {"service": "auth", "endpoint": "POST /auth/signup"}
  }$p$::text,
  NOW()
FROM generate_series(1, 22);


-- =============================================================================
-- DATA PIPELINE  (Python)
-- Project: 9c082871-b1eb-4f9e-9921-0550fe159237
-- =============================================================================

INSERT INTO issues (id, project_id, fingerprint, title, status, level, first_seen, last_seen, count, user_count, environment) VALUES

  ('seed-data-0001-0000-0000-000000000001',
   '9c082871-b1eb-4f9e-9921-0550fe159237',
   md5('data:KeyError:transform:user_id'),
   'KeyError: ''user_id''',
   'unresolved', 'error',
   NOW() - INTERVAL '22 days', NOW() - INTERVAL '3 hours',
   67, 1, 'production'),

  ('seed-data-0001-0000-0000-000000000002',
   '9c082871-b1eb-4f9e-9921-0550fe159237',
   md5('data:ValueError:int:empty_string'),
   'ValueError: invalid literal for int() with base 10: ''''',
   'unresolved', 'error',
   NOW() - INTERVAL '17 days', NOW() - INTERVAL '8 hours',
   23, 1, 'production'),

  ('seed-data-0001-0000-0000-000000000003',
   '9c082871-b1eb-4f9e-9921-0550fe159237',
   md5('data:ConnectionError:https:pool'),
   'requests.exceptions.ConnectionError: HTTPSConnectionPool(host=''api.partner.io'', port=443): Max retries exceeded',
   'unresolved', 'fatal',
   NOW() - INTERVAL '5 days', NOW() - INTERVAL '1 hour',
   15, 1, 'production'),

  ('seed-data-0001-0000-0000-000000000004',
   '9c082871-b1eb-4f9e-9921-0550fe159237',
   md5('data:EmptyDataError:pandas:csv'),
   'pandas.errors.EmptyDataError: No columns to parse from file',
   'unresolved', 'warning',
   NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 hours',
   8, 1, 'production'),

  ('seed-data-0001-0000-0000-000000000005',
   '9c082871-b1eb-4f9e-9921-0550fe159237',
   md5('data:AttributeError:none:strip'),
   'AttributeError: ''NoneType'' object has no attribute ''strip''',
   'unresolved', 'error',
   NOW() - INTERVAL '26 days', NOW() - INTERVAL '2 hours',
   45, 1, 'production'),

  ('seed-data-0001-0000-0000-000000000006',
   '9c082871-b1eb-4f9e-9921-0550fe159237',
   md5('data:TypeError:add:int:none'),
   'TypeError: unsupported operand type(s) for +: ''int'' and ''NoneType''',
   'resolved', 'error',
   NOW() - INTERVAL '40 days', NOW() - INTERVAL '25 days',
   19, 1, 'production')

ON CONFLICT (project_id, fingerprint) DO NOTHING;

-- Events: Data Pipeline
INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-data-0001-0000-0000-000000000001',
  gen_random_uuid()::text,
  NOW() - INTERVAL '22 days' + (random() * (INTERVAL '22 days' - INTERVAL '3 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-11T02:30:00.000Z",
    "level": "error",
    "exception": {
      "type": "KeyError",
      "value": "'user_id'",
      "stacktrace": [
        {"filename": "pipeline/transforms/user_enrichment.py", "function": "enrich_user_record", "lineno": 48, "colno": 0, "in_app": true, "context_line": "    uid = record['user_id']"},
        {"filename": "pipeline/transforms/user_enrichment.py", "function": "run_batch", "lineno": 112, "colno": 0, "in_app": true},
        {"filename": "pipeline/runner.py", "function": "execute_stage", "lineno": 67, "colno": 0, "in_app": true},
        {"filename": "pipeline/runner.py", "function": "main", "lineno": 134, "colno": 0, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "pipeline-3.2.1",
    "platform": "python",
    "server_name": "worker-prod-1",
    "tags": {"job": "user_enrichment", "stage": "transform", "batch_id": "batch_20240111_023000"},
    "extra": {"batch_size": 5000, "failed_record_index": 2847, "source_file": "s3://data-lake/raw/users/2024-01-11.parquet"}
  }$p$::text,
  NOW()
FROM generate_series(1, 12);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-data-0001-0000-0000-000000000003',
  gen_random_uuid()::text,
  NOW() - INTERVAL '5 days' + (random() * (INTERVAL '5 days' - INTERVAL '1 hour')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-27T04:15:00.000Z",
    "level": "fatal",
    "exception": {
      "type": "requests.exceptions.ConnectionError",
      "value": "HTTPSConnectionPool(host='api.partner.io', port=443): Max retries exceeded with url: /v2/events (Caused by NewConnectionError('<urllib3.connection.HTTPSConnection object>: Failed to establish a new connection: [Errno -2] Name or service not known'))",
      "stacktrace": [
        {"filename": "site-packages/urllib3/connectionpool.py", "function": "urlopen", "lineno": 715, "colno": 0, "in_app": false},
        {"filename": "site-packages/requests/adapters.py", "function": "send", "lineno": 547, "colno": 0, "in_app": false},
        {"filename": "pipeline/integrations/partner_api.py", "function": "push_events", "lineno": 83, "colno": 0, "in_app": true, "context_line": "    response = requests.post(PARTNER_API_URL + '/v2/events', json=payload, timeout=30)"},
        {"filename": "pipeline/stages/export.py", "function": "export_to_partner", "lineno": 44, "colno": 0, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "pipeline-3.2.1",
    "platform": "python",
    "server_name": "worker-prod-2",
    "tags": {"job": "partner_export", "stage": "export", "partner": "partner.io"},
    "extra": {"retry_count": 3, "timeout_seconds": 30}
  }$p$::text,
  NOW()
FROM generate_series(1, 8);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-data-0001-0000-0000-000000000005',
  gen_random_uuid()::text,
  NOW() - INTERVAL '26 days' + (random() * (INTERVAL '26 days' - INTERVAL '2 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-07T06:00:00.000Z",
    "level": "error",
    "exception": {
      "type": "AttributeError",
      "value": "'NoneType' object has no attribute 'strip'",
      "stacktrace": [
        {"filename": "pipeline/transforms/normalizer.py", "function": "normalize_email", "lineno": 22, "colno": 0, "in_app": true, "context_line": "    return raw_email.strip().lower()"},
        {"filename": "pipeline/transforms/normalizer.py", "function": "normalize_record", "lineno": 58, "colno": 0, "in_app": true},
        {"filename": "pipeline/runner.py", "function": "execute_stage", "lineno": 67, "colno": 0, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "pipeline-3.1.0",
    "platform": "python",
    "server_name": "worker-prod-1",
    "tags": {"job": "normalize_contacts", "stage": "transform"},
    "extra": {"record_id": "rec_00091234", "field": "email"}
  }$p$::text,
  NOW()
FROM generate_series(1, 10);


-- =============================================================================
-- MOBILE APP  (React Native)
-- Project: a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4
-- =============================================================================

INSERT INTO issues (id, project_id, fingerprint, title, status, level, first_seen, last_seen, count, user_count, environment) VALUES

  ('seed-mob0-0001-0000-0000-000000000001',
   'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
   md5('mob:TypeError:undefined:user.name'),
   'TypeError: undefined is not an object (evaluating ''this.props.user.name'')',
   'unresolved', 'error',
   NOW() - INTERVAL '24 days', NOW() - INTERVAL '30 minutes',
   234, 189, 'production'),

  ('seed-mob0-0001-0000-0000-000000000002',
   'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
   md5('mob:NetworkError:request:failed'),
   'TypeError: Network request failed',
   'unresolved', 'error',
   NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 minutes',
   567, 423, 'production'),

  ('seed-mob0-0001-0000-0000-000000000003',
   'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
   md5('mob:Error:invariant:text:component'),
   'Invariant Violation: Text strings must be rendered within a <Text> component',
   'unresolved', 'error',
   NOW() - INTERVAL '18 days', NOW() - INTERVAL '4 hours',
   89, 67, 'production'),

  ('seed-mob0-0001-0000-0000-000000000004',
   'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
   md5('mob:NSInvalidArgumentException:nsnull:length'),
   'NSInvalidArgumentException: -[NSNull length]: unrecognized selector sent to instance',
   'unresolved', 'fatal',
   NOW() - INTERVAL '10 days', NOW() - INTERVAL '6 hours',
   23, 21, 'production'),

  ('seed-mob0-0001-0000-0000-000000000005',
   'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
   md5('mob:NullPointerException:java:invoke'),
   'java.lang.NullPointerException: Attempt to invoke virtual method on a null object reference',
   'unresolved', 'fatal',
   NOW() - INTERVAL '13 days', NOW() - INTERVAL '8 hours',
   18, 17, 'production'),

  ('seed-mob0-0001-0000-0000-000000000006',
   'a03d5f9d-3e8f-4cb9-96b9-2c546837ccb4',
   md5('mob:Error:max:update:depth'),
   'Error: Maximum update depth exceeded',
   'resolved', 'error',
   NOW() - INTERVAL '42 days', NOW() - INTERVAL '28 days',
   12, 9, 'production')

ON CONFLICT (project_id, fingerprint) DO NOTHING;

-- Events: Mobile App
INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mob0-0001-0000-0000-000000000001',
  gen_random_uuid()::text,
  NOW() - INTERVAL '24 days' + (random() * (INTERVAL '24 days' - INTERVAL '30 minutes')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-09T14:22:10.000Z",
    "level": "error",
    "exception": {
      "type": "TypeError",
      "value": "undefined is not an object (evaluating 'this.props.user.name')",
      "stacktrace": [
        {"filename": "src/screens/ProfileScreen.tsx", "function": "ProfileScreen.render", "lineno": 34, "colno": 28, "in_app": true, "context_line": "      <Text>{this.props.user.name}</Text>"},
        {"filename": "node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js", "function": "performSyncWorkOnRoot", "lineno": 1, "colno": 183471, "in_app": false}
      ]
    },
    "environment": "production",
    "release": "3.1.0+build.142",
    "platform": "react-native",
    "tags": {"app_version": "3.1.0", "os": "iOS 17.2", "device": "iPhone 15 Pro", "screen": "ProfileScreen"},
    "user": {"id": "mob_usr_44821", "ip_address": "102.89.47.22"},
    "breadcrumbs": [
      {"timestamp": "2024-01-09T14:22:08.000Z", "type": "navigation", "category": "navigation", "message": "Navigated to ProfileScreen"},
      {"timestamp": "2024-01-09T14:22:09.000Z", "type": "http", "category": "fetch", "message": "GET /api/v1/auth/me 401"}
    ]
  }$p$::text,
  NOW()
FROM generate_series(1, 20);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mob0-0001-0000-0000-000000000002',
  gen_random_uuid()::text,
  NOW() - INTERVAL '30 days' + (random() * (INTERVAL '30 days' - INTERVAL '5 minutes')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-03T07:55:00.000Z",
    "level": "error",
    "exception": {
      "type": "TypeError",
      "value": "Network request failed",
      "stacktrace": [
        {"filename": "node_modules/react-native/Libraries/Network/fetch.js", "function": "fetch", "lineno": 1, "colno": 5012, "in_app": false},
        {"filename": "src/services/api.ts", "function": "apiRequest", "lineno": 38, "colno": 18, "in_app": true, "context_line": "  const response = await fetch(BASE_URL + path, options)"},
        {"filename": "src/services/auth.ts", "function": "refreshToken", "lineno": 54, "colno": 5, "in_app": true},
        {"filename": "src/screens/HomeScreen.tsx", "function": "useEffect", "lineno": 22, "colno": 7, "in_app": true}
      ]
    },
    "environment": "production",
    "release": "3.0.8+build.138",
    "platform": "react-native",
    "tags": {"app_version": "3.0.8", "os": "Android 14", "device": "Samsung Galaxy S24", "screen": "HomeScreen", "network": "cellular"},
    "user": {"id": "mob_usr_81233"},
    "extra": {"connection_type": "cellular", "signal_strength": "weak"}
  }$p$::text,
  NOW()
FROM generate_series(1, 30);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mob0-0001-0000-0000-000000000003',
  gen_random_uuid()::text,
  NOW() - INTERVAL '18 days' + (random() * (INTERVAL '18 days' - INTERVAL '4 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-15T19:40:00.000Z",
    "level": "error",
    "exception": {
      "type": "Invariant Violation",
      "value": "Text strings must be rendered within a <Text> component.",
      "stacktrace": [
        {"filename": "node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js", "function": "createInstance", "lineno": 1, "colno": 99821, "in_app": false},
        {"filename": "src/components/NotificationBanner.tsx", "function": "NotificationBanner", "lineno": 28, "colno": 12, "in_app": true, "context_line": "  return <View>{unread > 0 && unread}</View>"}
      ]
    },
    "environment": "production",
    "release": "3.1.0+build.142",
    "platform": "react-native",
    "tags": {"app_version": "3.1.0", "os": "iOS 16.7", "device": "iPhone 13", "component": "NotificationBanner"}
  }$p$::text,
  NOW()
FROM generate_series(1, 14);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mob0-0001-0000-0000-000000000004',
  gen_random_uuid()::text,
  NOW() - INTERVAL '10 days' + (random() * (INTERVAL '10 days' - INTERVAL '6 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-22T12:10:00.000Z",
    "level": "fatal",
    "exception": {
      "type": "NSInvalidArgumentException",
      "value": "-[NSNull length]: unrecognized selector sent to instance 0x7fff8b4c8d30",
      "stacktrace": [
        {"filename": "RCTBridge.m", "function": "-[RCTBridge callNativeModule:method:params:]", "lineno": 214, "colno": 0, "in_app": false},
        {"filename": "src/native/UserModule.swift", "function": "getUserDisplayName", "lineno": 45, "colno": 0, "in_app": true, "context_line": "    return user.displayName.length > 0 ? user.displayName : user.email"}
      ]
    },
    "environment": "production",
    "release": "3.1.0+build.142",
    "platform": "react-native",
    "tags": {"app_version": "3.1.0", "os": "iOS 15.8", "device": "iPhone 12 mini"},
    "user": {"id": "mob_usr_00432"}
  }$p$::text,
  NOW()
FROM generate_series(1, 8);

INSERT INTO events (id, issue_id, event_id, timestamp, payload, processed_at)
SELECT
  gen_random_uuid()::text,
  'seed-mob0-0001-0000-0000-000000000005',
  gen_random_uuid()::text,
  NOW() - INTERVAL '13 days' + (random() * (INTERVAL '13 days' - INTERVAL '8 hours')),
  $p${
    "event_id": "placeholder",
    "timestamp": "2024-01-19T08:30:00.000Z",
    "level": "fatal",
    "exception": {
      "type": "java.lang.NullPointerException",
      "value": "Attempt to invoke virtual method 'java.lang.String com.bugwatch.UserModel.getEmail()' on a null object reference",
      "stacktrace": [
        {"filename": "com/bugwatch/modules/UserModule.java", "function": "getCurrentUserEmail", "lineno": 78, "colno": 0, "in_app": true, "context_line": "    return currentUser.getEmail();"},
        {"filename": "com/bugwatch/modules/UserModule.java", "function": "getUserInfo", "lineno": 45, "colno": 0, "in_app": true},
        {"filename": "com/facebook/react/bridge/NativeModuleCallExceptionHandler.java", "function": "handleException", "lineno": 1, "colno": 0, "in_app": false}
      ]
    },
    "environment": "production",
    "release": "3.1.0+build.142",
    "platform": "react-native",
    "tags": {"app_version": "3.1.0", "os": "Android 13", "device": "Google Pixel 7"},
    "user": {"id": "mob_usr_77891"}
  }$p$::text,
  NOW()
FROM generate_series(1, 7);

COMMIT;
