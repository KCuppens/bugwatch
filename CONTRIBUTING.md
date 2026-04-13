# Contributing to Bugwatch

Thanks for your interest in contributing to Bugwatch! This guide will help you get started.

## Prerequisites

- **Rust** 1.82+ (`rustup` recommended)
- **Node.js** 20+ with **pnpm**
- **PostgreSQL** 15+
- **Git**

## Local Development Setup

```bash
# Clone the repo
git clone https://github.com/KCuppens/bugwatch.git
cd bugwatch

# Install web dependencies
cd apps/web && pnpm install && cd ../..

# Copy environment template
cp .env.example .env
# Edit .env with your database URL and JWT secret

# Run database migrations
cd apps/server
cargo run -- migrate
cd ../..

# Start the API server (self-hosted mode, no Stripe needed)
cd apps/server && cargo run &

# Start the web app
cd apps/web && pnpm dev
```

## Architecture

```
apps/
  server/     Rust (Axum) API server
  web/        Next.js frontend dashboard
  agent/      Bash server monitoring agent
packages/
  sdk/        Multi-language SDKs (core, node, nextjs, python, rust)
```

### Self-Hosted vs SaaS

The server has a `saas` Cargo feature flag:

- **Default build** (`cargo build`): Self-hosted mode. No Stripe/AWS dependencies. All features unlocked. Billing UI hidden.
- **SaaS build** (`cargo build --features saas`): Includes Stripe billing, AWS SES email, and tiered feature gating.

The frontend checks `NEXT_PUBLIC_DEPLOYMENT_MODE` (default: `self-hosted`). Set to `saas` for the hosted platform.

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes with clear commit messages
4. Run checks:
   ```bash
   # Rust
   cargo fmt --check
   cargo clippy -- -D warnings
   cargo test

   # TypeScript
   cd apps/web && pnpm lint && npx tsc --noEmit
   ```
5. Open a Pull Request against `main`

## Code Style

- **Rust**: `cargo fmt` for formatting, `cargo clippy` for lints
- **TypeScript**: ESLint + Prettier (configured in the repo)
- Keep PRs focused — one feature or fix per PR
- Add tests for new functionality

## Reporting Issues

- Use the GitHub issue templates (bug report or feature request)
- For security issues, see [SECURITY.md](SECURITY.md)
- Check existing issues before opening a new one

## License

By contributing, you agree that your contributions will be licensed under the project's FSL-1.1-Apache-2.0 license.
