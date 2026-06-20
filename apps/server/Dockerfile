# Stage 1: Build the Rust binary (self-hosted, no --features saas)
# rust 1.88: Cargo.lock pulls deps (home 0.5.12, icu_* 2.2.0) whose MSRV is
# 1.86–1.88; the older 1.85 toolchain refuses to build them. Stays on bookworm
# so the produced binary matches the debian:bookworm-slim runtime's GLIBC.
FROM rust:1.88-bookworm AS builder

WORKDIR /usr/src/bugwatch/apps/server

# Copy manifests first for dependency caching
COPY apps/server/Cargo.toml apps/server/Cargo.lock* ./

# Create a dummy main.rs to build dependencies
RUN mkdir -p src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true

# Copy actual source code, migrations (embedded via include_str!), and agent scripts
COPY apps/server/src ./src/
COPY apps/server/migrations ./migrations/
COPY apps/agent/ ../../apps/agent/

# Build the real binary
RUN touch src/main.rs && cargo build --release

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates libssl3 curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/bugwatch/apps/server/target/release/bugwatch-server /usr/local/bin/bugwatch-server

RUN useradd --system --no-create-home bugwatch
USER bugwatch

EXPOSE 3000

CMD ["bugwatch-server"]
