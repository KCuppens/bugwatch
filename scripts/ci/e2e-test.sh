#!/usr/bin/env bash
# e2e-test: build the workspace, then Playwright (chromium, firefox, webkit) against the web dev
# server on :3001 that playwright.config.ts starts. Needs node_modules and the browsers:
# hookci's setup ran scripts/ci/setup.sh; by hand, run it first. The browsers' system libraries
# come from scripts/ci/setup-host.sh.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools node

ci_step "npm run build"
npm run build

ci_step "playwright test"
# list: hookci keeps the log, not the HTML report.
npx playwright test --reporter=list
