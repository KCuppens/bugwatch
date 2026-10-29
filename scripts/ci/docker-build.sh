#!/usr/bin/env bash
# docker-build: apps/web/package-lock.json must match apps/web/package.json, because
# docker/Dockerfile.web installs from it standalone. Jobs can't reach docker, so the two image
# builds GitHub Actions ran here are gone: docker-publish.yml still builds docker/Dockerfile.web
# on pushes to main, and the production deploy builds the images it ships on the host
# (scripts/deploy/build-images.sh). Nothing builds docker/Dockerfile.server any more.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools node

ci_step "apps/web lockfile in sync"
cd apps/web
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
git diff --exit-code package-lock.json || {
  echo "apps/web/package-lock.json is out of sync with package.json — run 'npm install' in apps/web/ and commit the updated lockfile." >&2
  exit 1
}
