#!/usr/bin/env bash
# Install the pinned CI toolchains into $CI_TOOLS (default .hookci/cache/tools). Idempotent: a
# no-op when the pinned versions are already there. No root, no sudo, nothing outside $CI_TOOLS.
#
#   scripts/ci/tools.sh [node|rust|go|python|java|php|all]...      (default: all)
#
#  node:   Node 20 (nodejs.org tarball; npm 10.8.2 comes with it)
#  rust:   rustup + RUST_VERSION with rustfmt and clippy, plus the cargo-audit release binary
#  go:     Go 1.21 + golangci-lint v1 (packages/sdk/go/.golangci.yml is a v1 config)
#  python: CPython 3.11 (python-build-standalone install_only build)
#  java:   Temurin JDK 17 + Maven 3.9
#  php:    PHP 8.2 CLI (static-php-cli "common" build) + composer, phpstan and php-cs-fixer phars
#
# Ruby is the one toolchain from apt (ruby3.2, scripts/ci/setup-host.sh): its prebuilt binaries
# are not relocatable. Every download is checked against the sha256 (Maven: sha512) pinned below;
# to bump a tool, change its version and checksum together (the source of each checksum is noted).
# Linux x86_64 only: infrauno is the one host these pins are for.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt
NODE_VERSION=20.20.2
NODE_SHA256=df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d
# rustup-init.sha256 next to the binary on static.rust-lang.org
RUSTUP_VERSION=1.29.2
RUSTUP_SHA256=5be191e8c70a5007074254cb74d78dbfdd25cd5a61c27de7b8e5410122ec24f4
RUST_VERSION=1.99.1
# GitHub release asset digest (rustsec/rustsec, tag cargo-audit/v$CARGO_AUDIT_VERSION)
CARGO_AUDIT_VERSION=0.22.2
CARGO_AUDIT_SHA256=ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39
# https://go.dev/dl/?mode=json&include=all
GO_VERSION=1.21.13
GO_SHA256=502fc16d5910562461e6a6631fb6377de2322aad7304bf2bcd23500ba9dab4a7
# golangci-lint-$GOLANGCI_LINT_VERSION-checksums.txt in the GitHub release
GOLANGCI_LINT_VERSION=1.64.8
GOLANGCI_LINT_SHA256=b6270687afb143d019f387c791cd2a6f1cb383be9b3124d241ca11bd3ce2e54e
# GitHub release asset digest (astral-sh/python-build-standalone, tag $PYTHON_BUILD)
PYTHON_VERSION=3.11.17
PYTHON_BUILD=20261021
PYTHON_SHA256=7cc8d9dce9ea23c31267e7f244005c8979da04794b7737a3a30e62b03abeb120
# https://api.adoptium.net/v3/assets/release_name/eclipse/jdk-$JDK_VERSION?architecture=x64&os=linux&image_type=jdk
JDK_VERSION=17.0.21+9
JDK_SHA256=8b9b611d917e3dfd8419d3566b5949226f69b052fed7e109c1368add1dfe8711
# apache-maven-$MAVEN_VERSION-bin.tar.gz.sha512 on repo.maven.apache.org
MAVEN_VERSION=3.9.16
MAVEN_SHA512=831a8591fe20c8243b1dbe7d71e3244f31d1665b0804b2e825e38cbbe5ce0cafb8338851f90780735568773e0a6cd07bbec107cda0b896b008b861075358b6f6
# sha256 of the tarball on https://dl.static-php.dev/static-php-cli/common/ (none is published)
PHP_VERSION=8.2.32
PHP_SHA256=2e609bb88bae88661dbd447e409531f7c36931adff480d8a0a74e812b889d1be
# https://getcomposer.org/download/$COMPOSER_VERSION/composer.phar.sha256sum
COMPOSER_VERSION=2.10.3
COMPOSER_SHA256=7a2d379d5b8ffdaa028580ef26494c36d2feef4b178d3dd1473a4dbc5e17c8d6
# GitHub release asset digests (phpstan/phpstan, PHP-CS-Fixer/PHP-CS-Fixer)
PHPSTAN_VERSION=2.3.1
PHPSTAN_SHA256=85157dba3d95d77ca603d2b7303aa78a538f9e3b56ccad07dd794c53aa96d1ae
PHP_CS_FIXER_VERSION=3.95.27
PHP_CS_FIXER_SHA256=47231757eefdd08778e2bd047d98a63dfaad881006c8c1d1bc870d63be7f6a9b

[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || {
  echo "[tools] pinned for Linux x86_64 only (found $(uname -s)-$(uname -m))" >&2
  exit 1
}

mkdir -p "$CI_TOOLS"

# fetch <url> <sha256|sha512:hex> <file>: download into $CI_TMP and verify the checksum.
fetch() {
  local url="$1" sum="$2" out="$CI_TMP/$3"
  curl -fsSL --retry 3 -o "$out" "$url"
  case "$sum" in
    sha512:*) echo "${sum#sha512:}  $out" | sha512sum -c - >/dev/null ;;
    *) echo "$sum  $out" | sha256sum -c - >/dev/null ;;
  esac
}

# Each tool dir records the pinned version it holds in .ci-version.
installed() { [ "$(cat "$CI_TOOLS/$1/.ci-version" 2>/dev/null || true)" = "$2" ]; }
mark() { echo "$2" >"$CI_TOOLS/$1/.ci-version"; }
fresh() { rm -rf "${CI_TOOLS:?}/$1" && mkdir -p "$CI_TOOLS/$1"; }

install_node() {
  installed node "$NODE_VERSION" && return
  echo "[tools] installing node v$NODE_VERSION"
  local tarball="node-v$NODE_VERSION-linux-x64.tar.xz"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$tarball" "$NODE_SHA256" "$tarball"
  fresh node
  tar -xJf "$CI_TMP/$tarball" -C "$CI_TOOLS/node" --strip-components=1
  mark node "$NODE_VERSION"
}

install_rust() {
  if ! installed cargo "$RUST_VERSION"; then
    echo "[tools] installing rust $RUST_VERSION (+rustfmt, clippy)"
    fetch "https://static.rust-lang.org/rustup/archive/$RUSTUP_VERSION/x86_64-unknown-linux-gnu/rustup-init" \
      "$RUSTUP_SHA256" rustup-init
    chmod +x "$CI_TMP/rustup-init"
    rm -rf "$CI_TOOLS/rustup" "$CI_TOOLS/cargo"
    # RUSTUP_USE_CURL: rustup's built-in TLS client ignores the system CA store and the proxy
    # of a sandbox with an egress proxy; curl uses both.
    RUSTUP_USE_CURL=1 RUSTUP_HOME="$CI_TOOLS/rustup" CARGO_HOME="$CI_TOOLS/cargo" "$CI_TMP/rustup-init" -y --no-modify-path \
      --profile minimal --default-toolchain "$RUST_VERSION" --component rustfmt --component clippy
    mark cargo "$RUST_VERSION"
  fi
  if [ "$(cat "$CI_TOOLS/cargo/.cargo-audit-version" 2>/dev/null || true)" != "$CARGO_AUDIT_VERSION" ]; then
    echo "[tools] installing cargo-audit $CARGO_AUDIT_VERSION"
    local name="cargo-audit-x86_64-unknown-linux-gnu-v$CARGO_AUDIT_VERSION"
    fetch "https://github.com/rustsec/rustsec/releases/download/cargo-audit/v$CARGO_AUDIT_VERSION/$name.tgz" \
      "$CARGO_AUDIT_SHA256" "$name.tgz"
    tar -xzf "$CI_TMP/$name.tgz" -C "$CI_TMP"
    install -m 0755 "$CI_TMP/$name/cargo-audit" "$CI_TOOLS/cargo/bin/cargo-audit"
    echo "$CARGO_AUDIT_VERSION" >"$CI_TOOLS/cargo/.cargo-audit-version"
  fi
}

install_go() {
  if ! installed go "$GO_VERSION"; then
    echo "[tools] installing go $GO_VERSION"
    fetch "https://dl.google.com/go/go$GO_VERSION.linux-amd64.tar.gz" "$GO_SHA256" go.tar.gz
    fresh go
    tar -xzf "$CI_TMP/go.tar.gz" -C "$CI_TOOLS/go" --strip-components=1
    mark go "$GO_VERSION"
  fi
  if ! installed golangci-lint "$GOLANGCI_LINT_VERSION"; then
    echo "[tools] installing golangci-lint $GOLANGCI_LINT_VERSION"
    local name="golangci-lint-$GOLANGCI_LINT_VERSION-linux-amd64"
    fetch "https://github.com/golangci/golangci-lint/releases/download/v$GOLANGCI_LINT_VERSION/$name.tar.gz" \
      "$GOLANGCI_LINT_SHA256" "$name.tar.gz"
    fresh golangci-lint
    tar -xzf "$CI_TMP/$name.tar.gz" -C "$CI_TOOLS/golangci-lint" --strip-components=1 "$name/golangci-lint"
    mark golangci-lint "$GOLANGCI_LINT_VERSION"
  fi
}

install_python() {
  installed python "$PYTHON_VERSION+$PYTHON_BUILD" && return
  echo "[tools] installing python $PYTHON_VERSION"
  fetch "https://github.com/astral-sh/python-build-standalone/releases/download/$PYTHON_BUILD/cpython-$PYTHON_VERSION%2B$PYTHON_BUILD-x86_64-unknown-linux-gnu-install_only.tar.gz" \
    "$PYTHON_SHA256" python.tar.gz
  fresh python
  tar -xzf "$CI_TMP/python.tar.gz" -C "$CI_TOOLS/python" --strip-components=1
  mark python "$PYTHON_VERSION+$PYTHON_BUILD"
}

install_java() {
  if ! installed jdk "$JDK_VERSION"; then
    echo "[tools] installing temurin jdk $JDK_VERSION"
    local tag="jdk-${JDK_VERSION/+/%2B}" file="OpenJDK17U-jdk_x64_linux_hotspot_${JDK_VERSION/+/_}.tar.gz"
    fetch "https://github.com/adoptium/temurin17-binaries/releases/download/$tag/$file" "$JDK_SHA256" jdk.tar.gz
    fresh jdk
    tar -xzf "$CI_TMP/jdk.tar.gz" -C "$CI_TOOLS/jdk" --strip-components=1
    mark jdk "$JDK_VERSION"
  fi
  if ! installed maven "$MAVEN_VERSION"; then
    echo "[tools] installing maven $MAVEN_VERSION"
    fetch "https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/$MAVEN_VERSION/apache-maven-$MAVEN_VERSION-bin.tar.gz" \
      "sha512:$MAVEN_SHA512" maven.tar.gz
    fresh maven
    tar -xzf "$CI_TMP/maven.tar.gz" -C "$CI_TOOLS/maven" --strip-components=1
    mark maven "$MAVEN_VERSION"
  fi
}

install_php() {
  local want="$PHP_VERSION composer-$COMPOSER_VERSION phpstan-$PHPSTAN_VERSION php-cs-fixer-$PHP_CS_FIXER_VERSION"
  installed php "$want" && return
  echo "[tools] installing php $PHP_VERSION, composer $COMPOSER_VERSION, phpstan $PHPSTAN_VERSION, php-cs-fixer $PHP_CS_FIXER_VERSION"
  fetch "https://dl.static-php.dev/static-php-cli/common/php-$PHP_VERSION-cli-linux-x86_64.tar.gz" "$PHP_SHA256" php.tar.gz
  fetch "https://getcomposer.org/download/$COMPOSER_VERSION/composer.phar" "$COMPOSER_SHA256" composer.phar
  fetch "https://github.com/phpstan/phpstan/releases/download/$PHPSTAN_VERSION/phpstan.phar" "$PHPSTAN_SHA256" phpstan.phar
  fetch "https://github.com/PHP-CS-Fixer/PHP-CS-Fixer/releases/download/v$PHP_CS_FIXER_VERSION/php-cs-fixer.phar" \
    "$PHP_CS_FIXER_SHA256" php-cs-fixer.phar
  fresh php
  mkdir -p "$CI_TOOLS/php/bin"
  tar -xzf "$CI_TMP/php.tar.gz" -C "$CI_TOOLS/php/bin" php
  # The phars start with `#!/usr/bin/env php`, so they run with the php above once it is on PATH.
  install -m 0755 "$CI_TMP/composer.phar" "$CI_TOOLS/php/bin/composer"
  install -m 0755 "$CI_TMP/phpstan.phar" "$CI_TOOLS/php/bin/phpstan"
  install -m 0755 "$CI_TMP/php-cs-fixer.phar" "$CI_TOOLS/php/bin/php-cs-fixer"
  mark php "$want"
}

[ "$#" -gt 0 ] || set -- all
for what in "$@"; do
  case "$what" in
    node) install_node ;;
    rust) install_rust ;;
    go) install_go ;;
    python) install_python ;;
    java) install_java ;;
    php) install_php ;;
    all) install_node && install_rust && install_go && install_python && install_java && install_php ;;
    *) echo "usage: tools.sh [node|rust|go|python|java|php|all]..." >&2; exit 2 ;;
  esac
done
