#!/usr/bin/env bash
# go-sdk-check: packages/sdk/go vet, golangci-lint and race-enabled tests.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools go
cd packages/sdk/go

ci_step "go vet"
go vet ./...

ci_step "golangci-lint"
golangci-lint run

ci_step "go test -race"
# The profile goes to the scratch dir: packages/sdk/go/coverage.out is a tracked file.
go test -race -coverprofile="$CI_TMP/coverage.out" ./...
