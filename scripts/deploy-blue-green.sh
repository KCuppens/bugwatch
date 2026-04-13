#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/bugwatch"
MARKER_FILE="${DEPLOY_DIR}/.active-color"
MAX_RETRIES=30
RETRY_INTERVAL=2
ENVIRONMENT="${DEPLOY_ENV:-production}"

cd "$DEPLOY_DIR"

echo "============================================"
echo "  Bugwatch Blue-Green Deploy (${ENVIRONMENT})"
echo "============================================"

# ---------- Preflight checks ----------

# Ensure infrastructure (Caddy + Postgres) is running
if ! docker ps --format '{{.Names}}' | grep -q "^bugwatch-caddy$"; then
    echo "==> Infrastructure not running. Starting Caddy + PostgreSQL..."
    docker compose -p bugwatch-infra -f docker-compose.caddy.yml up -d
    echo "==> Waiting for PostgreSQL to be healthy..."
    sleep 10
fi

# Authenticate to GHCR if token is provided
if [[ -n "${GHCR_TOKEN:-}" ]]; then
    echo "==> Logging in to GHCR..."
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-github}" --password-stdin
fi

# ---------- Determine colors ----------

if [[ -f "$MARKER_FILE" ]]; then
    CURRENT_COLOR=$(cat "$MARKER_FILE")
else
    CURRENT_COLOR="none"
fi

if [[ "$CURRENT_COLOR" == "blue" ]]; then
    NEXT_COLOR="green"
else
    NEXT_COLOR="blue"
fi

echo "==> Environment: ${ENVIRONMENT}"
echo "==> Current active: ${CURRENT_COLOR}, deploying: ${NEXT_COLOR}"
echo "==> Image tag: ${IMAGE_TAG:-latest}"

# Export variables so compose files pick them up
export IMAGE_TAG="${IMAGE_TAG:-latest}"
export ENVIRONMENT

# ---------- Pull and start new containers ----------

echo "==> Pulling images..."
docker compose -p "bugwatch-${NEXT_COLOR}" -f "docker-compose.${NEXT_COLOR}.yml" pull

echo "==> Starting ${NEXT_COLOR} containers..."
docker compose -p "bugwatch-${NEXT_COLOR}" -f "docker-compose.${NEXT_COLOR}.yml" up -d

# ---------- Health checks ----------

# Wait for Docker's built-in healthchecks (defined in compose files) to pass.
# This avoids needing curl/wget inside containers.
wait_for_healthy() {
    local container="$1"

    for i in $(seq 1 "$MAX_RETRIES"); do
        local status
        status=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container" 2>/dev/null || echo "not-found")

        case "$status" in
            healthy)
                echo "    ${container} healthy (attempt ${i}/${MAX_RETRIES})"
                return 0
                ;;
            unhealthy)
                echo "    ${container} unhealthy — giving up"
                return 1
                ;;
            *)
                echo "    ${container} status: ${status} (attempt ${i}/${MAX_RETRIES})"
                sleep "$RETRY_INTERVAL"
                ;;
        esac
    done

    echo "    ${container} timed out after ${MAX_RETRIES} attempts"
    return 1
}

echo "==> Health checking ${NEXT_COLOR} containers..."

HEALTHY=true

if ! wait_for_healthy "bugwatch-server-${NEXT_COLOR}"; then
    HEALTHY=false
fi

# Only check web if server is healthy (avoid wasting 60s)
if [[ "$HEALTHY" == true ]]; then
    if ! wait_for_healthy "bugwatch-web-${NEXT_COLOR}"; then
        HEALTHY=false
    fi
fi

# ---------- Swap or rollback ----------

if [[ "$HEALTHY" == true ]]; then
    echo "==> Health checks passed! Swapping traffic to ${NEXT_COLOR}..."

    # Overwrite Caddyfile in-place (shell redirect preserves inode, so Docker bind mount sees the change)
    cat "Caddyfile.${NEXT_COLOR}" > Caddyfile

    # Reload Caddy to pick up new upstream targets
    docker exec bugwatch-caddy caddy reload --config /etc/caddy/Caddyfile

    # Stop old color containers (skip if first deploy)
    if [[ "$CURRENT_COLOR" != "none" ]]; then
        echo "==> Stopping ${CURRENT_COLOR} containers..."
        docker compose -p "bugwatch-${CURRENT_COLOR}" -f "docker-compose.${CURRENT_COLOR}.yml" down
    fi

    # Update marker
    echo "$NEXT_COLOR" > "$MARKER_FILE"

    # Prune old images (non-fatal — deploy already succeeded)
    echo "==> Pruning unused images..."
    docker image prune -f || true

    echo "==> Deploy complete! [${ENVIRONMENT}] Active color: ${NEXT_COLOR}"
else
    echo "==> Health checks FAILED! Rolling back..."
    docker compose -p "bugwatch-${NEXT_COLOR}" -f "docker-compose.${NEXT_COLOR}.yml" down
    echo "==> [${ENVIRONMENT}] ${CURRENT_COLOR} containers still running. Deploy aborted."
    exit 1
fi
