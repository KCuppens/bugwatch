# Bugwatch Server

Rust API server for Bugwatch, built with [Axum](https://github.com/tokio-rs/axum).

## Prerequisites

- Rust 1.83+
- PostgreSQL 16+

## Quick Start

```bash
# Run in community mode (default)
cargo run

# Run with SaaS features (billing, tier enforcement)
cargo run --features saas
```

The server starts on `http://localhost:3000` by default.

## Feature Flags

| Flag | Description |
|------|-------------|
| `saas` | Enables Stripe billing, tier-based rate limits, and seat management |

When the `saas` flag is disabled, all features are unlocked and billing endpoints return no-ops — ideal for self-hosted deployments.

## Module Overview

| Module | Description |
|--------|-------------|
| `api/auth` | Registration, login, JWT token management |
| `api/events` | Error event ingestion from SDKs |
| `api/issues` | Issue listing, search, status updates |
| `api/monitors` | Uptime monitor CRUD and status checks |
| `api/metrics` | Server metrics ingestion and queries |
| `api/alerts` | Alert rules, notification channels, logs |
| `api/billing` | Subscription management, invoices (SaaS only) |
| `api/webhooks` | Stripe webhooks, outgoing alert webhooks |
| `api/projects` | Project CRUD and API key management |
| `services/notifications` | Email, Slack, webhook dispatch |
| `services/retention` | Data retention and cleanup |

## Environment Variables

See the [Configuration docs](https://bugwatch.dev/docs/self-hosting/configuration) for a full reference.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for JWT signing (min 32 chars)
- `SERVER_ADDR` — Bind address (default: `127.0.0.1:3000`)
- `BUGWATCH_MODE` — `self-hosted` or `saas`

## Tests

```bash
cargo test
```

## Documentation

- [API Reference](https://bugwatch.dev/docs/api-reference)
- [Architecture](https://bugwatch.dev/docs/architecture)
- [Self-Hosting](https://bugwatch.dev/docs/self-hosting)
