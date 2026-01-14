#!/bin/bash
set -euo pipefail

# =============================================================================
# Bugwatch PostgreSQL Backup Script
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment
if [[ -f "$DEPLOY_DIR/.env.production" ]]; then
    source "$DEPLOY_DIR/.env.production"
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bugwatch}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/bugwatch_$TIMESTAMP.sql.gz"
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}
CONTAINER_NAME="bugwatch-postgres"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "${RED}ERROR: PostgreSQL container is not running${NC}"
    exit 1
fi

# Create backup
log "Creating backup: $BACKUP_FILE"
docker exec "$CONTAINER_NAME" pg_dump \
    -U "${POSTGRES_USER:-bugwatch}" \
    -d "${POSTGRES_DB:-bugwatch}" \
    | gzip > "$BACKUP_FILE"

# Verify backup
if [[ ! -s "$BACKUP_FILE" ]]; then
    log "${RED}ERROR: Backup file is empty${NC}"
    rm -f "$BACKUP_FILE"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "${GREEN}Backup created: $BACKUP_FILE ($BACKUP_SIZE)${NC}"

# Secure permissions
chmod 600 "$BACKUP_FILE"

# Clean old backups
log "Cleaning backups older than $RETENTION_DAYS days..."
DELETED=$(find "$BACKUP_DIR" -name "bugwatch_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print 2>/dev/null | wc -l)
log "Deleted $DELETED old backup(s)"

# Optional: S3 upload
if [[ -n "${BACKUP_S3_BUCKET:-}" && -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
    if command -v aws &> /dev/null; then
        log "Uploading to S3..."
        export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
        export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
        export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"

        if aws s3 cp "$BACKUP_FILE" "s3://${BACKUP_S3_BUCKET}/backups/$(basename $BACKUP_FILE)" --quiet; then
            log "${GREEN}S3 upload successful${NC}"
        else
            log "${RED}S3 upload failed${NC}"
        fi
    fi
fi

log "${GREEN}Backup completed${NC}"
