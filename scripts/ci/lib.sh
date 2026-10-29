#!/usr/bin/env bash
# Shared helpers for scripts/ci/*.sh. Source it; never run it. See CONTRIBUTING.md "CI".
#
# Sourcing cd's to the repo root and sets up cleanup traps. Nothing here needs sudo or any
# GitHub-Actions feature: the same scripts run on infrauno under hookci and on a laptop.

CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$CI_ROOT" || exit 1

# Pinned toolchains live here (cached between hookci runs by `checks.setup`, see .hookci.yml).
CI_TOOLS="${CI_TOOLS:-$CI_ROOT/.hookci/cache/tools}"
export CI_ROOT CI_TOOLS

export RUST_BACKTRACE=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 HUSKY=0

# hookci reaches the internet only through its egress proxy and sets the upper-case variables;
# some clients (Ruby's Net::HTTP, curl for https) only read the lower-case ones.
if [ -n "${HTTPS_PROXY:-}" ]; then
  export https_proxy="$HTTPS_PROXY" http_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" no_proxy="${NO_PROXY:-localhost,127.0.0.1}"
fi

# ── cleanup ────────────────────────────────────────────────────────────────────────────────
CI_CLEANUPS=()
# ci_defer '<shell command>': run at exit (success, failure, Ctrl-C, SIGTERM), newest first.
ci_defer() { CI_CLEANUPS+=("$1"); }
ci_run_cleanups() {
  local i
  for ((i = ${#CI_CLEANUPS[@]} - 1; i >= 0; i--)); do eval "${CI_CLEANUPS[i]}" || true; done
}
trap ci_run_cleanups EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Say plainly what failed: hookci shows only the tail of the log, so the last lines must name the
# script, line and command (with a hint when the cause is usually the egress allowlist).
set -E
ci_on_error() {
  local rc=$? cmd=$BASH_COMMAND src="${BASH_SOURCE[1]:-?}" line="${BASH_LINENO[0]:-?}"
  trap - ERR
  {
    echo
    echo "################ CI FAILED ################"
    echo "script:  ${src#"$CI_ROOT"/}:$line"
    echo "command: $cmd"
    echo "exit:    $rc"
    echo "If this is a download/connect error, add the host to checks.egress in .hookci.yml."
    echo "###########################################"
  } >&2
}
trap ci_on_error ERR

# Per-run scratch dir, removed at exit.
CI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/bugwatch-ci.XXXXXX")"
ci_defer "rm -rf '$CI_TMP'"
export CI_TMP

# ci_step <title>: a visible marker in the job log for each former GitHub Actions step.
ci_step() { printf '\n==> %s\n' "$*"; }

# ── toolchains ─────────────────────────────────────────────────────────────────────────────
# ci_tools <toolchain>...: install the pinned toolchains if missing (scripts/ci/tools.sh is
# idempotent and a no-op once cached), then put them first on PATH.
ci_tools() {
  bash "$CI_ROOT/scripts/ci/tools.sh" "$@"
  ci_env "$@"
}

ci_env() {
  local what
  for what in "$@"; do
    case "$what" in
      node | all)
        export PATH="$CI_TOOLS/node/bin:$PATH"
        export npm_config_cache="$CI_ROOT/.hookci/cache/npm"
        export PLAYWRIGHT_BROWSERS_PATH="$CI_ROOT/.hookci/cache/playwright"
        if [ -n "${HTTPS_PROXY:-}" ]; then
          export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}"
        fi
        ;;
    esac
    case "$what" in
      rust | all)
        export RUSTUP_HOME="$CI_TOOLS/rustup" CARGO_HOME="$CI_TOOLS/cargo"
        export PATH="$CARGO_HOME/bin:$PATH"
        # No CARGO_TARGET_DIR: build output stays in the checkout and goes away with it.
        export CARGO_TERM_COLOR=never CARGO_INCREMENTAL=0
        ;;
    esac
    case "$what" in
      go | all)
        export GOROOT="$CI_TOOLS/go" PATH="$CI_TOOLS/go/bin:$CI_TOOLS/golangci-lint:$PATH"
        # Never let a go.mod `toolchain` line download another Go.
        export GOTOOLCHAIN=local
        ;;
    esac
    case "$what" in
      python | all) export PATH="$CI_TOOLS/python/bin:$PATH" ;;
    esac
    case "$what" in
      java | all)
        export JAVA_HOME="$CI_TOOLS/jdk"
        export PATH="$JAVA_HOME/bin:$CI_TOOLS/maven/bin:$PATH"
        ;;
    esac
    case "$what" in
      php | all) export PATH="$CI_TOOLS/php/bin:$PATH" ;;
    esac
  done
}

ci_npm_install() {
  npm ci --prefer-offline --no-audit --no-fund
}
