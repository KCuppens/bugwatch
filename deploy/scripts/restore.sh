#!/bin/bash
set -euo pipefail

# =============================================================================
# Bugwatch PostgreSQL Restore Script
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment
if [[ -f "$DEPLOY_DIR/.env.production" ]]; then
    source "$DEPLOY_DIR/.env.production"
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bugwatch}"
CONTAINER_NAME="bugwatch-postgres"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Get backup file
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: ./restore.sh <backup-file>"
    echo ""
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "  No backups found in $BACKUP_DIR"
    exit 1
fi

# Resolve path
if [[ ! -f "$BACKUP_FILE" ]]; then
    if [[ -f "$BACKUP_DIR/$BACKUP_FILE" ]]; then
        BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
    else
        log "${RED}ERROR: Backup file not found: $BACKUP_FILE${NC}"
        exit 1
    fi
fi

log "${YELLOW}WARNING: This will replace the current database!${NC}"
read -p "Are you sure? Type 'yes' to confirm: " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    log "Restore cancelled"
    exit 0
fi

# Check container
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "${RED}ERROR: PostgreSQL container is not running${NC}"
    exit 1
fi

# Safety backup
log "Creating safety backup of current database..."
SAFETY_BACKUP="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec "$CONTAINER_NAME" pg_dump \
    -U "${POSTGRES_USER:-bugwatch}" \
    -d "${POSTGRES_DB:-bugwatch}" \
    | gzip > "$SAFETY_BACKUP"
log "Safety backup: $SAFETY_BACKUP"

# Stop app services
log "Stopping application services..."
docker stop bugwatch-server bugwatch-web 2>/dev/null || true

# Restore
log "Restoring from: $BACKUP_FILE"
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql \
    -U "${POSTGRES_USER:-bugwatch}" \
    -d "${POSTGRES_DB:-bugwatch}" \
    > /dev/null 2>&1

log "${GREEN}Database restored${NC}"

# Restart services
log "Starting application services..."
cd "$DEPLOY_DIR/.."
docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$DEPLOY_DIR/.env.production" up -d

log "${GREEN}Restore completed${NC}"
