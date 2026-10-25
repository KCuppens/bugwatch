#!/usr/bin/env bash
# php-sdk-check: packages/sdk/php composer install, php-cs-fixer, phpstan and phpunit. composer,
# phpstan and php-cs-fixer are the pinned global phars from scripts/ci/tools.sh, as setup-php's
# `tools:` installed them.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools php
cd packages/sdk/php
# setup-php's default; the static build has no php.ini.
export PHPRC="$CI_TMP/php"
mkdir -p "$PHPRC" && echo "memory_limit=-1" >"$PHPRC/php.ini"
php --version

ci_step "composer install"
composer install --no-interaction --prefer-dist

ci_step "php-cs-fixer --dry-run"
php-cs-fixer fix --dry-run --diff

ci_step "phpstan"
phpstan analyse

ci_step "phpunit"
vendor/bin/phpunit
