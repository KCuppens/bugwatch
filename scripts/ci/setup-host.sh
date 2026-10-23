#!/usr/bin/env bash
# One-time (and re-runnable) host setup for CI on infrauno. Run it yourself, as root:
#
#   sudo bash scripts/ci/setup-host.sh
#
# Installs only what a job cannot install for itself: apt packages. Node, Rust, Go, Python, the
# JDK, Maven and PHP are NOT installed here; scripts/ci/tools.sh fetches pinned copies into the
# job's cache without root. Debian/Ubuntu only (the box runs Ubuntu 24.04).
set -euo pipefail

[ "$#" -eq 0 ] || { echo "usage: setup-host.sh" >&2; exit 2; }

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0" >&2; exit 1; }
[ -r /etc/os-release ] && . /etc/os-release
case "${ID:-}${ID_LIKE:-}" in
  *debian* | *ubuntu*) ;;
  *) echo "Debian/Ubuntu only (found ${PRETTY_NAME:-unknown})" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update

# Ubuntu 24.04 renamed some libraries to <name>t64; take whichever this release has.
pick() {
  local pkg
  for pkg in "$@"; do
    if apt-cache show "${pkg}t64" >/dev/null 2>&1; then echo "${pkg}t64"; else echo "$pkg"; fi
  done
}

# hookci's job sandbox reaches the network only through an egress proxy inside a private network
# namespace, which needs `ip` and `pasta` (package passt). Without pasta hookci silently falls back
# to no network at all and every download in a job fails.
# Fetching toolchains (tools.sh), linking Rust binaries, `go test -race` (cgo) and native gems.
toolchain=(curl ca-certificates xz-utils git build-essential pkg-config iproute2 passt)

# apps/server: lettre's native-tls builds openssl-sys against the system OpenSSL.
server=(libssl-dev)

# ruby-sdk-check: Ruby 3.2 with bundler, and headers for the gems with C extensions.
ruby=(ruby3.2 ruby-dev ruby-bundler)

# e2e-test: what `playwright install-deps chromium firefox webkit` (Playwright 1.57, ubuntu24.04)
# would add; scripts/ci/setup.sh downloads the browsers themselves without root.
mapfile -t playwright < <(pick libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 \
  libevent-2.1-7 libglib2.0-0 libgtk-3-0 libpng16-16)
playwright+=(libatomic1 libavif16 libcairo-gobject2 libcairo2 libdbus-1-3 libdrm2 libenchant-2-2
  libepoxy0 libflite1 libfontconfig1 libfreetype6 libgbm1 libgdk-pixbuf-2.0-0 libgles2
  libgstreamer-gl1.0-0 libgstreamer-plugins-bad1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer1.0-0
  libgtk-4-1 libharfbuzz-icu0 libharfbuzz0b libhyphen0 libicu74 libjpeg-turbo8 liblcms2-2
  libmanette-0.2-0 libnspr4 libnss3 libopus0 libpango-1.0-0 libpangocairo-1.0-0 libsecret-1-0 libvpx9
  libwayland-client0 libwayland-egl1 libwayland-server0 libwebp7 libwebpdemux2 libwoff1 libx11-6
  libx11-xcb1 libx264-164 libxcb-shm0 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6
  libxfixes3 libxi6 libxkbcommon0 libxml2 libxrandr2 libxrender1 libxslt1.1
  gstreamer1.0-libav gstreamer1.0-plugins-bad gstreamer1.0-plugins-base gstreamer1.0-plugins-good
  fonts-freefont-ttf fonts-ipafont-gothic fonts-liberation fonts-noto-color-emoji fonts-tlwg-loma-otf
  fonts-unifont fonts-wqy-zenhei xfonts-cyrillic xfonts-scalable xvfb)

apt-get install -y --no-install-recommends "${toolchain[@]}" "${server[@]}" "${ruby[@]}" "${playwright[@]}"

echo "host ready for CI"
