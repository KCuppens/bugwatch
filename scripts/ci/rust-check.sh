#!/usr/bin/env bash
# rust-check: apps/server fmt, clippy, tests against Postgres, and cargo audit.
# Postgres comes from hookci's `postgres` service (PGHOST is its socket directory); run by hand,
# set PGHOST (or TEST_DATABASE_URL) to a Postgres you can reach as user postgres without a password.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools rust
cd apps/server

ci_step "cargo fmt --check"
cargo fmt --all -- --check

ci_step "cargo clippy"
cargo clippy --all-targets --all-features -- -D warnings

ci_step "cargo test"
# sqlx takes a socket directory as ?host=. Each test makes its own schema, so the default database
# of the service is enough.
: "${TEST_DATABASE_URL:=postgres://postgres@localhost/postgres?host=${PGHOST:-/var/run/postgresql}}"
DATABASE_URL="$TEST_DATABASE_URL" TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test --all-features

ci_step "cargo audit"
# Cargo.lock is gitignored for apps/server; the build above resolved it.
# lettre (critical, in the shipped binary) was upgraded to >=0.11.22. The
# advisories below are confined to the OPTIONAL `saas` feature's transitive
# deps (async-stripe / aws-sdk, including h2 0.3 and rustls 0.21 via hyper 0.14
# and aws-smithy-http-client) and are absent from the default self-hosted build,
# which only resolves patched h2 0.4 / rustls 0.23. Verified with
# `cargo tree -i <crate>@<version> --no-default-features` (no matches).
# RUSTSEC-2023-0071 (rsa) additionally has no fixed upgrade available.
# RUSTSEC-2026-0382 (rustls-webpki 0.101.7) has no semver-compatible fix: it is the last 0.101.x,
# fixed only in >=0.103.16, and comes in through saas-only aws-config / aws-sdk-sesv2 ->
# aws-smithy-runtime -> aws-smithy-http-client 1.5.1 -> rustls 0.21.12 (also via hyper-rustls 0.24
# -> tokio-rustls 0.24). The default build resolves only rustls-webpki 0.103.16.
cargo audit \
  --ignore RUSTSEC-2023-0071 \
  --ignore RUSTSEC-2026-0098 \
  --ignore RUSTSEC-2026-0099 \
  --ignore RUSTSEC-2026-0104 \
  --ignore RUSTSEC-2026-0174 \
  --ignore RUSTSEC-2026-0097 \
  --ignore RUSTSEC-2024-0384 \
  --ignore RUSTSEC-2026-0258 \
  --ignore RUSTSEC-2026-0346 \
  --ignore RUSTSEC-2026-0349 \
  --ignore RUSTSEC-2026-0382
