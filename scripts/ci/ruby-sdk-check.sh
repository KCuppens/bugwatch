#!/usr/bin/env bash
# ruby-sdk-check: packages/sdk/ruby rubocop and rspec. Ruby 3.2 and bundler are apt packages
# (scripts/ci/setup-host.sh).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd packages/sdk/ruby

ci_step "bundle install"
# Gems go to the scratch dir: no Gemfile.lock is committed, so every run resolves afresh, as
# setup-ruby's bundler-cache did on a cache miss.
export BUNDLE_PATH="$CI_TMP/bundle" BUNDLE_JOBS=4
ruby --version
bundle install

ci_step "rubocop"
bundle exec rubocop

ci_step "rspec"
bundle exec rspec
