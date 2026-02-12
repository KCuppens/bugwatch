#!/usr/bin/env bash
# BugWatch Server Monitoring Agent
# Collects system metrics and sends them to the BugWatch API
# Version: 1.0

set -euo pipefail

CONFIG_FILE="/etc/bugwatch/agent.conf"
NET_PREV_FILE="/tmp/bugwatch_net_prev"

# Load configuration
if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

# Defaults
BUGWATCH_API_KEY="${BUGWATCH_API_KEY:-}"
BUGWATCH_ENDPOINT="${BUGWATCH_ENDPOINT:-https://api.bugwatch.dev}"
BUGWATCH_COLLECT_DOCKER="${BUGWATCH_COLLECT_DOCKER:-auto}"
BUGWATCH_DISK_PATHS="${BUGWATCH_DISK_PATHS:-/}"

if [[ -z "$BUGWATCH_API_KEY" ]]; then
    echo "Error: BUGWATCH_API_KEY not set. Configure in $CONFIG_FILE" >&2
    exit 1
fi

# ============================================================================
# Helpers
# ============================================================================

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\n/\\n/g'
}

# ============================================================================
# Server Identity
# ============================================================================

HOSTNAME_VAL=$(hostname 2>/dev/null || echo "unknown")
MACHINE_ID=""
if [[ -f /etc/machine-id ]]; then
    MACHINE_ID=$(head -c 8 /etc/machine-id)
elif [[ -f /var/lib/dbus/machine-id ]]; then
    MACHINE_ID=$(head -c 8 /var/lib/dbus/machine-id)
else
    MACHINE_ID=$(echo "$HOSTNAME_VAL" | md5sum 2>/dev/null | head -c 8 || echo "00000000")
fi
SERVER_ID="${HOSTNAME_VAL}-${MACHINE_ID}"

# OS info
OS_INFO=""
if [[ -f /etc/os-release ]]; then
    OS_INFO=$(grep -oP '(?<=^PRETTY_NAME=").*(?="$)' /etc/os-release 2>/dev/null || \
              grep -oP '(?<=^NAME=").*(?="$)' /etc/os-release 2>/dev/null || echo "Linux")
fi
KERNEL_VER=$(uname -r 2>/dev/null || echo "unknown")

# ============================================================================
# CPU Usage (read /proc/stat twice with 1s gap)
# ============================================================================

read_cpu_stats() {
    awk '/^cpu / {print $2+$3+$4, $5}' /proc/stat
}

CPU_BEFORE=$(read_cpu_stats)
sleep 1
CPU_AFTER=$(read_cpu_stats)

CPU_ACTIVE_BEFORE=$(echo "$CPU_BEFORE" | awk '{print $1}')
CPU_IDLE_BEFORE=$(echo "$CPU_BEFORE" | awk '{print $2}')
CPU_ACTIVE_AFTER=$(echo "$CPU_AFTER" | awk '{print $1}')
CPU_IDLE_AFTER=$(echo "$CPU_AFTER" | awk '{print $2}')

ACTIVE_DIFF=$((CPU_ACTIVE_AFTER - CPU_ACTIVE_BEFORE))
IDLE_DIFF=$((CPU_IDLE_AFTER - CPU_IDLE_BEFORE))
TOTAL_DIFF=$((ACTIVE_DIFF + IDLE_DIFF))

if [[ $TOTAL_DIFF -gt 0 ]]; then
    CPU_PERCENT=$(awk "BEGIN {printf \"%.1f\", ($ACTIVE_DIFF / $TOTAL_DIFF) * 100}")
else
    CPU_PERCENT="0.0"
fi

# ============================================================================
# Memory (parse /proc/meminfo)
# ============================================================================

MEM_TOTAL=$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)
MEM_AVAILABLE=$(awk '/^MemAvailable:/ {print $2 * 1024}' /proc/meminfo)
MEM_USED=$((MEM_TOTAL - MEM_AVAILABLE))
if [[ $MEM_TOTAL -gt 0 ]]; then
    MEM_PERCENT=$(awk "BEGIN {printf \"%.1f\", ($MEM_USED / $MEM_TOTAL) * 100}")
else
    MEM_PERCENT="0.0"
fi

SWAP_TOTAL=$(awk '/^SwapTotal:/ {print $2 * 1024}' /proc/meminfo)
SWAP_FREE=$(awk '/^SwapFree:/ {print $2 * 1024}' /proc/meminfo)
SWAP_USED=$((SWAP_TOTAL - SWAP_FREE))

# ============================================================================
# Load Average
# ============================================================================

read -r LOAD1 LOAD5 LOAD15 _ < /proc/loadavg

# ============================================================================
# Network I/O (delta from previous run)
# ============================================================================

get_net_bytes() {
    awk 'NR>2 && $1 !~ /lo:/ {rx+=$2; tx+=$10} END {print rx, tx}' /proc/net/dev
}

NET_NOW=$(get_net_bytes)
NET_RX_NOW=$(echo "$NET_NOW" | awk '{print $1}')
NET_TX_NOW=$(echo "$NET_NOW" | awk '{print $2}')

NET_RX_PER_SEC=0
NET_TX_PER_SEC=0

if [[ -f "$NET_PREV_FILE" ]]; then
    read -r NET_RX_PREV NET_TX_PREV TIMESTAMP_PREV < "$NET_PREV_FILE"
    TIMESTAMP_NOW=$(date +%s)
    ELAPSED=$((TIMESTAMP_NOW - TIMESTAMP_PREV))
    if [[ $ELAPSED -gt 0 ]]; then
        NET_RX_PER_SEC=$(( (NET_RX_NOW - NET_RX_PREV) / ELAPSED ))
        NET_TX_PER_SEC=$(( (NET_TX_NOW - NET_TX_PREV) / ELAPSED ))
        # Avoid negative values on counter wrap
        [[ $NET_RX_PER_SEC -lt 0 ]] && NET_RX_PER_SEC=0
        [[ $NET_TX_PER_SEC -lt 0 ]] && NET_TX_PER_SEC=0
    fi
fi

echo "$NET_RX_NOW $NET_TX_NOW $(date +%s)" > "$NET_PREV_FILE"

# ============================================================================
# Uptime
# ============================================================================

UPTIME_SECS=$(awk '{printf "%d", $1}' /proc/uptime)

# ============================================================================
# Disk Usage
# ============================================================================

DISKS_JSON="["
FIRST_DISK=true
IFS=',' read -ra DISK_PATHS <<< "$BUGWATCH_DISK_PATHS"
for DPATH in "${DISK_PATHS[@]}"; do
    DPATH=$(echo "$DPATH" | xargs)  # trim whitespace
    if df -B1 "$DPATH" >/dev/null 2>&1; then
        DISK_LINE=$(df -B1 "$DPATH" | tail -1)
        FS=$(echo "$DISK_LINE" | awk '{print $1}')
        D_TOTAL=$(echo "$DISK_LINE" | awk '{print $2}')
        D_USED=$(echo "$DISK_LINE" | awk '{print $3}')
        D_AVAIL=$(echo "$DISK_LINE" | awk '{print $4}')
        if [[ $D_TOTAL -gt 0 ]]; then
            D_PERCENT=$(awk "BEGIN {printf \"%.1f\", ($D_USED / $D_TOTAL) * 100}")
        else
            D_PERCENT="0.0"
        fi

        if [[ "$FIRST_DISK" != "true" ]]; then
            DISKS_JSON+=","
        fi
        DISKS_JSON+="{\"mount\":\"$(json_escape "$DPATH")\",\"filesystem\":\"$(json_escape "$FS")\",\"total_bytes\":$D_TOTAL,\"used_bytes\":$D_USED,\"available_bytes\":$D_AVAIL,\"usage_percent\":$D_PERCENT}"
        FIRST_DISK=false
    fi
done
DISKS_JSON+="]"

# ============================================================================
# Top Processes
# ============================================================================

PROCS_JSON="["
FIRST_PROC=true
while IFS= read -r line; do
    P_USER=$(echo "$line" | awk '{print $1}')
    P_PID=$(echo "$line" | awk '{print $2}')
    P_CPU=$(echo "$line" | awk '{print $3}')
    P_MEM=$(echo "$line" | awk '{print $4}')
    P_NAME=$(echo "$line" | awk '{print $11}' | sed 's/.*\///')

    if [[ "$FIRST_PROC" != "true" ]]; then
        PROCS_JSON+=","
    fi
    PROCS_JSON+="{\"pid\":$P_PID,\"name\":\"$(json_escape "$P_NAME")\",\"cpu_percent\":$P_CPU,\"mem_percent\":$P_MEM,\"user\":\"$(json_escape "$P_USER")\"}"
    FIRST_PROC=false
done < <(ps aux --sort=-%cpu 2>/dev/null | head -6 | tail -5)
PROCS_JSON+="]"

# ============================================================================
# Docker (optional)
# ============================================================================

DOCKER_JSON="null"
if [[ "$BUGWATCH_COLLECT_DOCKER" == "auto" || "$BUGWATCH_COLLECT_DOCKER" == "true" ]]; then
    if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        DOCKER_JSON="["
        FIRST_CONTAINER=true
        while IFS= read -r container_json; do
            [[ -z "$container_json" ]] && continue
            C_NAME=$(echo "$container_json" | sed -n 's/.*"Name":"\([^"]*\)".*/\1/p' || echo "")
            C_ID=$(echo "$container_json" | sed -n 's/.*"ID":"\([^"]*\)".*/\1/p' || echo "")
            C_CPU=$(echo "$container_json" | sed -n 's/.*"CPUPerc":"\([^"]*\)".*/\1/p' | tr -d '%' || echo "0")
            C_MEM_USAGE=$(echo "$container_json" | sed -n 's/.*"MemUsage":"\([^"]*\)".*/\1/p' || echo "0")
            C_MEM_PERC=$(echo "$container_json" | sed -n 's/.*"MemPerc":"\([^"]*\)".*/\1/p' | tr -d '%' || echo "0")

            if [[ "$FIRST_CONTAINER" != "true" ]]; then
                DOCKER_JSON+=","
            fi
            DOCKER_JSON+="{\"name\":\"$(json_escape "$C_NAME")\",\"id\":\"$(json_escape "$C_ID")\",\"status\":\"running\",\"cpu_percent\":$C_CPU,\"mem_usage\":\"$(json_escape "$C_MEM_USAGE")\",\"mem_percent\":$C_MEM_PERC}"
            FIRST_CONTAINER=false
        done < <(docker stats --no-stream --format '{{json .}}' 2>/dev/null || true)

        if [[ "$FIRST_CONTAINER" == "true" ]]; then
            DOCKER_JSON="null"
        else
            DOCKER_JSON+="]"
        fi
    fi
fi

# ============================================================================
# Build JSON Payload
# ============================================================================

PAYLOAD=$(cat <<EOF
{
  "server_id": "$(json_escape "$SERVER_ID")",
  "hostname": "$(json_escape "$HOSTNAME_VAL")",
  "os": "$(json_escape "$OS_INFO")",
  "kernel": "$(json_escape "$KERNEL_VER")",
  "cpu": {
    "usage_percent": $CPU_PERCENT
  },
  "memory": {
    "total_bytes": $MEM_TOTAL,
    "used_bytes": $MEM_USED,
    "available_bytes": $MEM_AVAILABLE,
    "usage_percent": $MEM_PERCENT
  },
  "swap": {
    "total_bytes": $SWAP_TOTAL,
    "used_bytes": $SWAP_USED
  },
  "network": {
    "rx_bytes_per_sec": $NET_RX_PER_SEC,
    "tx_bytes_per_sec": $NET_TX_PER_SEC
  },
  "load": {
    "avg_1": $LOAD1,
    "avg_5": $LOAD5,
    "avg_15": $LOAD15
  },
  "uptime_seconds": $UPTIME_SECS,
  "disks": $DISKS_JSON,
  "processes": $PROCS_JSON,
  "docker": $DOCKER_JSON
}
EOF
)

# ============================================================================
# Send to BugWatch API
# ============================================================================

HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${BUGWATCH_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "X-Bugwatch-Agent: server-monitor/1.0" \
    -d "$PAYLOAD" \
    "${BUGWATCH_ENDPOINT}/api/v1/metrics" \
    --max-time 10 \
    2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "202" ]]; then
    exit 0
elif [[ "$HTTP_CODE" == "000" ]]; then
    echo "Warning: Could not reach BugWatch API at ${BUGWATCH_ENDPOINT}" >&2
    exit 0  # Silent failure — agent is idempotent
else
    echo "Warning: BugWatch API returned HTTP $HTTP_CODE" >&2
    exit 0  # Silent failure
fi
