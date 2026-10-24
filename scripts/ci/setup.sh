#!/usr/bin/env bash
# Install the workspace's npm dependencies and the Playwright browsers. hookci runs this once per
# check run (checks.setup in .hookci.yml), before any job; the jobs share the checkout it fills.
# The npm cache (.hookci/cache/npm) and the browsers (.hookci/cache/playwright) are cached,
# keyed on package-lock.json. The browsers' system libraries come from scripts/ci/setup-host.sh.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools node

ci_step "npm ci"
ci_npm_install

ci_step "playwright install"
npx playwright install chromium firefox webkit
