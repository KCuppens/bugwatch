#!/usr/bin/env bash
set -euo pipefail

# Bugwatch server setup script
# Run once on a fresh server to configure boot recovery and directory structure.
#
# Usage: sudo bash scripts/setup-server.sh

DEPLOY_DIR="/opt/bugwatch"

echo "==> Setting up Bugwatch at ${DEPLOY_DIR}"

# Ensure deploy directory exists
mkdir -p "$DEPLOY_DIR/scripts"

# Copy deployment files if running from repo checkout
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "${REPO_DIR}/docker-compose.caddy.yml" ]]; then
    echo "==> Copying deployment files..."
    cp "${REPO_DIR}/docker-compose.caddy.yml" "$DEPLOY_DIR/"
    cp "${REPO_DIR}/docker-compose.blue.yml" "$DEPLOY_DIR/"
    cp "${REPO_DIR}/docker-compose.green.yml" "$DEPLOY_DIR/"
    cp "${REPO_DIR}/Caddyfile.blue" "$DEPLOY_DIR/"
    cp "${REPO_DIR}/Caddyfile.green" "$DEPLOY_DIR/"
    cp "${REPO_DIR}/Caddyfile.blue" "$DEPLOY_DIR/Caddyfile"
    cp "${REPO_DIR}/scripts/deploy-blue-green.sh" "$DEPLOY_DIR/scripts/"
fi

# Create .env template if it doesn't exist
if [[ ! -f "${DEPLOY_DIR}/.env" ]]; then
    echo "==> Creating .env template..."
    cat > "${DEPLOY_DIR}/.env" <<'ENVEOF'
# Required
DOMAIN=bugwatch.example.com
JWT_SECRET=CHANGE_ME_MIN_32_CHARS

# Database
POSTGRES_PASSWORD=CHANGE_ME

# SMTP (optional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
ENVEOF
    echo "    IMPORTANT: Edit ${DEPLOY_DIR}/.env with your actual values before deploying!"
fi

# Install systemd service
echo "==> Installing systemd service..."
cp "${REPO_DIR}/scripts/bugwatch.service" /etc/systemd/system/bugwatch.service
systemctl daemon-reload
systemctl enable bugwatch.service

# Ensure Docker starts on boot
systemctl enable docker.service

# Create the Docker network if it doesn't exist
docker network create bugwatch 2>/dev/null || true

echo ""
echo "============================================"
echo "  Bugwatch server setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Edit ${DEPLOY_DIR}/.env with your production values"
echo "  2. Push to main to trigger the first deploy, or run manually:"
echo "     cd ${DEPLOY_DIR} && bash scripts/deploy-blue-green.sh"
echo ""
echo "The systemd service will auto-start containers on boot."
echo "Autoheal will restart unhealthy containers automatically."
echo ""
