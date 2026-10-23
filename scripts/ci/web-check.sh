#!/usr/bin/env bash
# web-check: typecheck, lint, SDK and workspace builds, npm audit (audit-ci) and unit tests.
# Needs node_modules: hookci's setup ran scripts/ci/setup.sh; by hand, run it first.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools node

ci_step "npm run typecheck"
npm run typecheck

ci_step "npm run lint"
npm run lint

for sdk in core node nextjs; do
  ci_step "build packages/sdk/$sdk"
  (cd "packages/sdk/$sdk" && npm run build)
done

ci_step "npm run build"
# loose: turbo's strict env mode drops HTTPS_PROXY, and next/font reaches Google Fonts only
# through the egress proxy.
npm run build -- --env-mode=loose

ci_step "audit-ci"
npx audit-ci --config audit-ci.jsonc

ci_step "npm test"
npm test
