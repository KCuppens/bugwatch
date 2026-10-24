#!/usr/bin/env bash
# Build the production images for the checked-out commit on the deploy host:
#   bugwatch-server:sha-<12 hex>, bugwatch-web:sha-<12 hex>, bugwatch-mcp:sha-<12 hex>
# HookCI's production deployment (.hookci.yml deployments.production) runs it as hookci-deploy
# (docker group, no root) from its deploy checkout, then hands the commit to
# /opt/buguno/hookci-deploy-prod.sh, which runs the images (deploy/infrauno/README.md).
# Stops at the first failed build. The build cache is the host's docker cache.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

tag="sha-$(git rev-parse HEAD | cut -c1-12)"

echo "::hookci step build-server"
docker build -f apps/server/Dockerfile -t "bugwatch-server:$tag" .

echo "::hookci step build-web"
# NEXT_PUBLIC_* are inlined at build time. Production serves web and API from one origin (Caddy
# routes /api/* to the server), so the web client points at https://bugwatch.dev.
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://bugwatch.dev -t "bugwatch-web:$tag" .

echo "::hookci step build-mcp"
docker build -f packages/mcp/Dockerfile -t "bugwatch-mcp:$tag" .

echo "built bugwatch-{server,web,mcp}:$tag"
