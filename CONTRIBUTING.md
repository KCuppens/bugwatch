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

## CI

CI runs on [HookCI](https://ci.hookci.com) on infrauno, as the `hookci/<job>` checks on every pull
request and on pushes to `main` (`checks` in `.hookci.yml`). A push to `main` deploys production once
every check passes (`deployments.production`, see [deploy/infrauno/README.md](deploy/infrauno/README.md)).
GitHub Actions no longer runs CI or deploys; it still publishes images (`docker-publish.yml`) and
releases (`release.yml`, `publish-*.yml`). Every job is a script in `scripts/ci/` that can be run by
hand from the repo root (`bash scripts/ci/setup.sh`, then `bash scripts/ci/web-check.sh`):

| job | script | what |
|---|---|---|
| `rust-check` | `rust-check.sh` | `apps/server` fmt, clippy, tests against postgres, `cargo audit` |
| `web-check` | `web-check.sh` | typecheck, lint, SDK and workspace builds, `audit-ci`, unit tests |
| `e2e-test` | `e2e-test.sh` | build, then Playwright in chromium, firefox and webkit |
| `python-sdk-check` | `python-sdk-check.sh` | ruff, mypy, pytest |
| `rust-sdk-check` | `rust-sdk-check.sh` | fmt, clippy, tests |
| `go-sdk-check` | `go-sdk-check.sh` | vet, golangci-lint, `go test -race` |
| `ruby-sdk-check` | `ruby-sdk-check.sh` | rubocop, rspec |
| `php-sdk-check` | `php-sdk-check.sh` | php-cs-fixer, phpstan, phpunit |
| `java-sdk-check` | `java-sdk-check.sh` | `mvn verify` |
| `docker-build` | `docker-build.sh` | `apps/web/package-lock.json` is in sync with `apps/web/package.json` |

`e2e-test` starts after `web-check` and `rust-check` pass, `docker-build` after all the others. The
checks run on the same box as production, as the sandboxed `hookci-run` user (no docker, no sudo), one
job at a time, held to 2 cores and 8 GB. Because of that:

- Toolchains aren't installed on the host. `scripts/ci/tools.sh` fetches pinned, checksummed copies
  (Node, Rust with rustfmt, clippy and cargo-audit, Go and golangci-lint, Python, JDK and Maven, PHP
  with composer, phpstan and php-cs-fixer) into `.hookci/cache/tools`, which `checks.setup` caches;
  bump a version and its checksum in that file. Only apt packages (Ruby 3.2 and bundler, the
  Playwright browsers' libraries) need root: `scripts/ci/setup-host.sh`.
- Jobs reach the network only through HookCI's egress proxy, for the hosts in `checks.egress`. A
  job that fails to download something usually needs its host added there.
- The `rust-check` tests use HookCI's `postgres` service (its socket, `PGHOST`). Run by hand, they use
  `TEST_DATABASE_URL`, or a local postgres on `/var/run/postgresql`.
- No check builds docker images: jobs can't reach docker. The production deploy builds them on the
  host (`scripts/deploy/build-images.sh`); `docker-publish.yml` still builds the published images and
  `docker/Dockerfile.web` on pushes to `main`.
- A red check on a push to `main` means that push never deploys; fix the check and push again.

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
