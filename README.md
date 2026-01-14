# Bugwatch

**Watch your bugs. Fix them faster.**

AI-Powered Error Tracking with free unlimited error logging and pay-per-AI-fix.

## Features

- **Unlimited Free Errors** - No event limits, no surprise bills
- **AI-Powered Fixes** - Click "AI Fix" and get a PR on GitHub in seconds
- **Zero-Config SDK** - Just `import '@bugwatch/auto'` and go
- **Developer Feedback** - Errors in toasts, terminal, and VS Code
- **Self-Hostable** - Single binary, SQLite default, MIT licensed

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Rust 1.83+ (for backend development)
- Docker (optional, for containerized development)

### Development Setup

1. Clone the repository:
```bash
git clone https://github.com/KCuppens/bugwatch.git
cd bugwatch
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Start the development servers:
```bash
# Start both frontend and backend
pnpm dev

# Or start individually:
# Backend (Rust)
cd apps/server && cargo run

# Frontend (Next.js)
cd apps/web && pnpm dev
```

### Using Docker

```bash
# Development with hot reload
docker-compose -f docker-compose.dev.yml up

# Production build
docker-compose -f docker/docker-compose.yml up --build
```

## Project Structure

```
bugwatch/
├── apps/
│   ├── server/          # Rust Axum backend
│   └── web/             # Next.js frontend
├── packages/
│   ├── sdk/             # SDK packages (@bugwatch/*)
│   └── shared/          # Shared types
├── docker/              # Docker configuration
└── migrations/          # Database migrations
```

## Architecture

- **Backend**: Rust with Axum web framework
- **Frontend**: Next.js 15 with App Router
- **Database**: SQLite (default) / PostgreSQL (scale)
- **AI**: Claude API for fix generation
- **UI**: shadcn/ui + Tailwind CSS

## SDK Usage

```typescript
// Just import - zero configuration needed
import '@bugwatch/auto'

// Errors are automatically captured and sent to Bugwatch
// Toast notifications appear in development mode
```

## API Endpoints

- `POST /api/v1/events` - Ingest error events
- `GET /api/v1/projects` - List projects
- `GET /api/v1/projects/:id/issues` - List issues
- `POST /api/v1/issues/:id/ai-fix` - Request AI fix

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.
