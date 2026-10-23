#!/usr/bin/env bash
# java-sdk-check: packages/sdk/java `mvn verify` (core and spring).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools java
cd packages/sdk/java

# Maven's HTTP transport takes its proxy from settings.xml, not from the environment, and
# its local repository defaults to the passwd home (/home/hookci-run), not $HOME.
settings="$CI_TMP/maven-settings.xml"
proxy="${HTTPS_PROXY:-}"
proxy="${proxy#*://}"
proxy="${proxy%%/*}"
{
  echo "<settings><localRepository>$HOME/.m2/repository</localRepository><proxies>"
  if [ -n "$proxy" ]; then
    for protocol in https http; do
      echo "<proxy><id>hookci-$protocol</id><active>true</active><protocol>$protocol</protocol>"
      echo "<host>${proxy%:*}</host><port>${proxy##*:}</port><nonProxyHosts>localhost|127.0.0.1</nonProxyHosts></proxy>"
    done
  fi
  echo '</proxies></settings>'
} >"$settings"

ci_step "mvn verify"
mvn -B -s "$settings" verify
