#!/bin/bash
set -euo pipefail

# =============================================================================
# Bugwatch Deployment Script for Ubuntu
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
NGINX_CONF="/etc/nginx/sites-available/bugwatch"
BACKUP_DIR="/var/backups/bugwatch"
LOG_DIR="/var/log/bugwatch"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_ubuntu() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "Cannot determine OS version"
        exit 1
    fi

    . /etc/os-release

    if [[ "$ID" != "ubuntu" ]]; then
        log_warning "This script is designed for Ubuntu. Detected: $ID"
    fi

    log_success "Detected: $PRETTY_NAME"
}

generate_secret() {
    openssl rand -base64 64 | tr -d '\n'
}

generate_password() {
    openssl rand -base64 32 | tr -d '\n/+='
}

# =============================================================================
# Setup Command
# =============================================================================

cmd_setup() {
    log_info "Starting Bugwatch server setup..."
    check_root
    check_ubuntu

    # Create directories
    mkdir -p "$LOG_DIR" "$BACKUP_DIR" /var/www/html
    chmod 750 "$BACKUP_DIR"

    # Update system
    log_info "Updating system packages..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

    # Install dependencies
    log_info "Installing required packages..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        ufw \
        nginx \
        certbot \
        python3-certbot-nginx \
        cron \
        jq \
        openssl

    # Install Docker
    install_docker

    # Configure firewall
    configure_firewall

    # Configure environment
    configure_environment

    # Setup Nginx
    setup_nginx

    # Setup SSL if domain provided
    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
        if [[ -n "${DOMAIN:-}" && "$DOMAIN" != "localhost" ]]; then
            setup_ssl "$DOMAIN"
        fi
    fi

    # Setup backup cron
    setup_backup_cron

    # Install systemd service
    install_systemd_service

    log_success "Server setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Review configuration: $ENV_FILE"
    echo "  2. Deploy the application: ./deploy.sh deploy"
    echo ""
}

install_docker() {
    if command -v docker &> /dev/null; then
        log_info "Docker already installed: $(docker --version)"
        return
    fi

    log_info "Installing Docker..."

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    # Add repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl start docker
    systemctl enable docker

    log_success "Docker installed successfully"
}

configure_firewall() {
    log_info "Configuring UFW firewall..."

    ufw --force reset > /dev/null 2>&1
    ufw default deny incoming > /dev/null 2>&1
    ufw default allow outgoing > /dev/null 2>&1

    # Allow essential ports
    ufw allow 22/tcp comment 'SSH' > /dev/null 2>&1
    ufw allow 80/tcp comment 'HTTP' > /dev/null 2>&1
    ufw allow 443/tcp comment 'HTTPS' > /dev/null 2>&1

    ufw --force enable > /dev/null 2>&1

    log_success "Firewall configured (ports 22, 80, 443 open)"
}

configure_environment() {
    if [[ -f "$ENV_FILE" ]]; then
        log_warning "Environment file already exists: $ENV_FILE"
        read -p "Overwrite? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return
        fi
    fi

    log_info "Configuring environment variables..."
    echo ""
    echo "=== Bugwatch Environment Configuration ==="
    echo ""

    # Domain
    read -p "Enter your domain (e.g., bugwatch.example.com) [localhost]: " DOMAIN
    DOMAIN=${DOMAIN:-localhost}

    # Admin email
    read -p "Enter admin email (for SSL certificates): " ADMIN_EMAIL

    # Database
    read -p "PostgreSQL username [bugwatch]: " POSTGRES_USER
    POSTGRES_USER=${POSTGRES_USER:-bugwatch}

    read -s -p "PostgreSQL password (leave blank to generate): " POSTGRES_PASSWORD
    echo
    if [[ -z "$POSTGRES_PASSWORD" ]]; then
        POSTGRES_PASSWORD=$(generate_password)
        log_info "Generated PostgreSQL password"
    fi

    read -p "PostgreSQL database [bugwatch]: " POSTGRES_DB
    POSTGRES_DB=${POSTGRES_DB:-bugwatch}

    # JWT Secret
    JWT_SECRET=$(generate_secret)
    log_info "Generated JWT secret"

    # Optional integrations
    echo ""
    echo "Optional integrations (press Enter to skip):"
    read -p "Anthropic API Key (for AI features): " ANTHROPIC_API_KEY
    read -p "Stripe Secret Key (for billing): " STRIPE_SECRET_KEY
    read -p "Stripe Webhook Secret: " STRIPE_WEBHOOK_SECRET

    # Determine API URL and APP_URL
    if [[ "$DOMAIN" == "localhost" ]]; then
        API_URL="http://localhost:3000"
        APP_URL="http://localhost:3001"
    else
        API_URL="https://${DOMAIN}/api"
        APP_URL="https://${DOMAIN}"
    fi

    # Write environment file
    cat > "$ENV_FILE" << EOF
# =============================================================================
# Bugwatch Production Environment
# Generated: $(date)
# =============================================================================

# Domain Configuration
DOMAIN=${DOMAIN}
ADMIN_EMAIL=${ADMIN_EMAIL}

# Database
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}

# Server
SERVER_ADDR=0.0.0.0:3000
ENVIRONMENT=production
RUST_LOG=info

# Authentication
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_EXPIRATION=900
JWT_REFRESH_EXPIRATION=604800

# URLs
APP_URL=${APP_URL}
NEXT_PUBLIC_API_URL=${API_URL}

# AI (optional)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}

# Stripe (optional)
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-}

# Backup
BACKUP_RETENTION_DAYS=7
EOF

    chmod 600 "$ENV_FILE"
    log_success "Environment file created: $ENV_FILE"
}

setup_nginx() {
    log_info "Configuring Nginx..."

    # Get domain from env or use localhost
    local domain="localhost"
    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
        domain="${DOMAIN:-localhost}"
    fi

    # Copy nginx config
    cp "$SCRIPT_DIR/nginx/bugwatch.conf" "$NGINX_CONF"

    # Replace domain placeholder
    sed -i "s/DOMAIN_PLACEHOLDER/$domain/g" "$NGINX_CONF"

    # Create self-signed cert for initial setup
    mkdir -p /etc/nginx/ssl
    if [[ ! -f /etc/nginx/ssl/bugwatch.crt ]]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout /etc/nginx/ssl/bugwatch.key \
            -out /etc/nginx/ssl/bugwatch.crt \
            -subj "/CN=$domain" 2>/dev/null
    fi

    # Enable site
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/bugwatch
    rm -f /etc/nginx/sites-enabled/default

    # Test and reload
    nginx -t
    systemctl reload nginx

    log_success "Nginx configured"
}

setup_ssl() {
    local domain="$1"

    if [[ "$domain" == "localhost" ]]; then
        log_warning "Skipping SSL setup for localhost"
        return
    fi

    log_info "Setting up SSL for $domain..."

    # Update nginx with domain
    sed -i "s/DOMAIN_PLACEHOLDER/$domain/g" "$NGINX_CONF" 2>/dev/null || true
    systemctl reload nginx

    # Get certificate
    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
        certbot --nginx -d "$domain" \
            --non-interactive --agree-tos \
            -m "${ADMIN_EMAIL:-admin@$domain}" \
            --redirect || log_warning "SSL setup failed - you can retry with: ./deploy.sh ssl $domain"
    fi

    # Enable auto-renewal
    systemctl enable certbot.timer 2>/dev/null || true
    systemctl start certbot.timer 2>/dev/null || true

    log_success "SSL configured"
}

setup_backup_cron() {
    log_info "Setting up automated backups..."

    chmod +x "$SCRIPT_DIR/scripts/backup.sh"

    # Add cron job (daily at 3 AM)
    (crontab -l 2>/dev/null | grep -v "bugwatch.*backup"; \
     echo "0 3 * * * $SCRIPT_DIR/scripts/backup.sh >> $LOG_DIR/backup.log 2>&1") | crontab -

    log_success "Backup cron configured (daily at 3 AM)"
}

install_systemd_service() {
    log_info "Installing systemd service..."

    cp "$SCRIPT_DIR/systemd/bugwatch.service" /etc/systemd/system/
    sed -i "s|DEPLOY_DIR|$SCRIPT_DIR|g" /etc/systemd/system/bugwatch.service
    sed -i "s|PROJECT_ROOT|$PROJECT_ROOT|g" /etc/systemd/system/bugwatch.service

    systemctl daemon-reload
    systemctl enable bugwatch

    log_success "Systemd service installed"
}

# =============================================================================
# Deploy Command
# =============================================================================

cmd_deploy() {
    log_info "Deploying Bugwatch..."

    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found. Run './deploy.sh setup' first."
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        log_error "Docker not installed. Run './deploy.sh setup' first."
        exit 1
    fi

    # Validate environment
    source "$ENV_FILE"

    if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
        log_error "POSTGRES_PASSWORD is required"
        exit 1
    fi

    if [[ -z "${JWT_SECRET:-}" ]]; then
        log_error "JWT_SECRET is required"
        exit 1
    fi

    log_success "Environment validated"

    # Build and start
    log_info "Building and starting services..."
    cd "$PROJECT_ROOT"

    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

    # Wait for services
    log_info "Waiting for services to start..."
    sleep 15

    # Show status
    cmd_status

    log_success "Deployment complete!"
}

# =============================================================================
# Other Commands
# =============================================================================

cmd_status() {
    echo ""
    echo "=== Bugwatch Status ==="
    echo ""

    # Load env if exists
    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
    fi

    echo "Containers:"
    docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || echo "  Not running"
    echo ""

    echo "Health Checks:"

    # API
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "  API Server:    ${GREEN}HEALTHY${NC}"
    else
        echo -e "  API Server:    ${RED}UNHEALTHY${NC}"
    fi

    # Web
    if curl -sf http://localhost:3001 > /dev/null 2>&1; then
        echo -e "  Web Frontend:  ${GREEN}HEALTHY${NC}"
    else
        echo -e "  Web Frontend:  ${RED}UNHEALTHY${NC}"
    fi

    # Database
    if docker exec bugwatch-postgres pg_isready -U "${POSTGRES_USER:-bugwatch}" > /dev/null 2>&1; then
        echo -e "  PostgreSQL:    ${GREEN}HEALTHY${NC}"
    else
        echo -e "  PostgreSQL:    ${RED}UNHEALTHY${NC}"
    fi

    # Nginx
    if systemctl is-active --quiet nginx 2>/dev/null; then
        echo -e "  Nginx:         ${GREEN}RUNNING${NC}"
    else
        echo -e "  Nginx:         ${RED}STOPPED${NC}"
    fi

    echo ""
}

cmd_logs() {
    local service="${1:-}"

    if [[ -n "$service" ]]; then
        docker compose -f "$COMPOSE_FILE" logs -f "$service"
    else
        docker compose -f "$COMPOSE_FILE" logs -f
    fi
}

cmd_restart() {
    log_info "Restarting services..."

    if [[ -f "$ENV_FILE" ]]; then
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart
    else
        docker compose -f "$COMPOSE_FILE" restart
    fi

    log_success "Services restarted"
}

cmd_stop() {
    log_info "Stopping services..."
    docker compose -f "$COMPOSE_FILE" down
    log_success "Services stopped"
}

cmd_backup() {
    log_info "Running backup..."
    "$SCRIPT_DIR/scripts/backup.sh"
}

cmd_update() {
    log_info "Updating Bugwatch..."

    # Pull latest if git repo
    if [[ -d "$PROJECT_ROOT/.git" ]]; then
        cd "$PROJECT_ROOT"
        git pull origin main || git pull origin master || true
    fi

    cmd_deploy
}

cmd_ssl() {
    local domain="${1:-}"

    if [[ -z "$domain" ]]; then
        if [[ -f "$ENV_FILE" ]]; then
            source "$ENV_FILE"
            domain="${DOMAIN:-}"
        fi
    fi

    if [[ -z "$domain" ]]; then
        log_error "Usage: ./deploy.sh ssl <domain>"
        exit 1
    fi

    check_root
    setup_ssl "$domain"
}

cmd_help() {
    echo "Bugwatch Deployment Script"
    echo ""
    echo "Usage: ./deploy.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  setup     Initial server setup (requires root)"
    echo "  deploy    Deploy/update the application"
    echo "  status    Show service health status"
    echo "  logs      View logs (optionally: logs <service>)"
    echo "  restart   Restart all services"
    echo "  stop      Stop all services"
    echo "  backup    Run database backup"
    echo "  update    Pull latest code and redeploy"
    echo "  ssl       Setup SSL certificate"
    echo "  help      Show this help"
    echo ""
    echo "Examples:"
    echo "  sudo ./deploy.sh setup"
    echo "  ./deploy.sh deploy"
    echo "  ./deploy.sh logs server"
    echo "  sudo ./deploy.sh ssl bugwatch.example.com"
}

# =============================================================================
# Main
# =============================================================================

main() {
    local command="${1:-help}"
    shift || true

    case "$command" in
        setup)    cmd_setup "$@" ;;
        deploy)   cmd_deploy "$@" ;;
        status)   cmd_status "$@" ;;
        logs)     cmd_logs "$@" ;;
        restart)  cmd_restart "$@" ;;
        stop)     cmd_stop "$@" ;;
        backup)   cmd_backup "$@" ;;
        update)   cmd_update "$@" ;;
        ssl)      cmd_ssl "$@" ;;
        help|--help|-h) cmd_help ;;
        *)
            log_error "Unknown command: $command"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
