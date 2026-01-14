#!/bin/bash
set -euo pipefail

# =============================================================================
# Bugwatch Health Check Script
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment
if [[ -f "$DEPLOY_DIR/.env.production" ]]; then
    source "$DEPLOY_DIR/.env.production"
fi

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL:-http://localhost:3001}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

check_service() {
    local name="$1"
    local url="$2"
    local expected="${3:-200}"

    HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" == "$expected" ]]; then
        echo -e "  $name: ${GREEN}OK${NC} (HTTP $HTTP_CODE)"
        return 0
    else
        echo -e "  $name: ${RED}FAILED${NC} (HTTP $HTTP_CODE)"
        ((ERRORS++))
        return 1
    fi
}

check_container() {
    local name="$1"

    if docker ps --format '{{.Names}}' | grep -q "^${name}$"; then
        local status
        status=$(docker inspect --format='{{.State.Health.Status}}' "$name" 2>/dev/null || echo "running")

        if [[ "$status" == "healthy" || "$status" == "running" ]]; then
            echo -e "  $name: ${GREEN}$status${NC}"
            return 0
        else
            echo -e "  $name: ${YELLOW}$status${NC}"
            return 1
        fi
    else
        echo -e "  $name: ${RED}NOT RUNNING${NC}"
        ((ERRORS++))
        return 1
    fi
}

echo "=== Bugwatch Health Check ==="
echo "Time: $(date)"
echo ""

echo "Container Status:"
check_container "bugwatch-postgres"
check_container "bugwatch-server"
check_container "bugwatch-web"
echo ""

echo "HTTP Endpoints:"
check_service "API Health" "$API_URL/health"
check_service "Web Frontend" "$WEB_URL"
echo ""

echo "System Resources:"
echo "  CPU Load: $(uptime | awk -F'load average:' '{print $2}' | xargs)"
echo "  Memory: $(free -h 2>/dev/null | awk '/^Mem:/ {print $3 "/" $2}' || echo 'N/A')"
echo "  Disk: $(df -h / 2>/dev/null | awk 'NR==2 {print $3 "/" $2 " (" $5 " used)"}' || echo 'N/A')"
echo ""

# Database check
echo "Database:"
if docker exec bugwatch-postgres pg_isready -U "${POSTGRES_USER:-bugwatch}" -q 2>/dev/null; then
    CONN=$(docker exec bugwatch-postgres psql -U "${POSTGRES_USER:-bugwatch}" -t -c \
        "SELECT count(*) FROM pg_stat_activity WHERE datname='${POSTGRES_DB:-bugwatch}';" 2>/dev/null | tr -d ' ')
    echo -e "  PostgreSQL: ${GREEN}CONNECTED${NC} ($CONN connections)"
else
    echo -e "  PostgreSQL: ${RED}DISCONNECTED${NC}"
    ((ERRORS++))
fi
echo ""

# Summary
if [[ $ERRORS -eq 0 ]]; then
    echo -e "Status: ${GREEN}ALL SYSTEMS OPERATIONAL${NC}"
    exit 0
else
    echo -e "Status: ${RED}$ERRORS ISSUE(S) DETECTED${NC}"
    exit 1
fi
