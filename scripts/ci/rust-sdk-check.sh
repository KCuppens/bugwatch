#!/usr/bin/env bash
# rust-sdk-check: packages/sdk/rust fmt, clippy and tests.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools rust
cd packages/sdk/rust

ci_step "cargo fmt --check"
cargo fmt --all -- --check

ci_step "cargo clippy"
cargo clippy --all-targets --all-features -- -D warnings

ci_step "cargo test"
cargo test --all-features
