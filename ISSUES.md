# Bugwatch - Project Issues & Tasks

> Checklist-style issue tracker for the Bugwatch project.
> Use `- [ ]` for incomplete tasks and `- [x]` for completed tasks.

---

## Milestone 1: Project Foundation (Week 1-2)

### Epic: Monorepo Setup
**Labels:** `setup`, `infrastructure`

- [ ] Initialize Turborepo monorepo structure
- [ ] Configure pnpm workspace (`pnpm-workspace.yaml`)
- [ ] Set up `turbo.json` with build/dev/test pipelines
- [ ] Create directory structure:
  - [ ] `apps/server/` - Rust backend
  - [ ] `apps/web/` - Next.js frontend
  - [ ] `packages/sdk/` - SDK packages
  - [ ] `packages/shared/` - Shared types
- [ ] Add root `package.json` with workspace scripts
- [ ] Configure TypeScript base config (`tsconfig.base.json`)
- [ ] Set up ESLint and Prettier configs
- [ ] Add `.gitignore` for all workspaces
- [ ] Create `README.md` with project overview

### Epic: Rust Backend Skeleton
**Labels:** `backend`, `rust`, `setup`

- [ ] Initialize Cargo workspace in `apps/server/`
- [ ] Add Axum as web framework dependency
- [ ] Add Tokio runtime with multi-threaded executor
- [ ] Create basic project structure:
  - [ ] `src/main.rs` - Entry point
  - [ ] `src/config.rs` - Configuration loading
  - [ ] `src/api/mod.rs` - API routes module
  - [ ] `src/error.rs` - Error types
- [ ] Implement health check endpoint (`GET /health`)
- [ ] Add structured logging with `tracing`
- [ ] Configure CORS middleware
- [ ] Add graceful shutdown handling
- [ ] Create `Dockerfile.server` for containerization

### Epic: Next.js Frontend Skeleton
**Labels:** `frontend`, `nextjs`, `setup`

- [ ] Initialize Next.js 15 app in `apps/web/`
- [ ] Configure App Router structure
- [ ] Install and configure Tailwind CSS
- [ ] Install and configure shadcn/ui
- [ ] Create base layout (`app/layout.tsx`)
- [ ] Add dark mode support with next-themes
- [ ] Set up API client utility (`lib/api.ts`)
- [ ] Create shared types file (`lib/types.ts`)
- [ ] Add loading and error boundary components
- [ ] Create `Dockerfile.web` for containerization

### Epic: Development Environment
**Labels:** `devops`, `setup`

- [ ] Create `docker-compose.yml` for local development
- [ ] Add hot-reload support for Rust (cargo-watch)
- [ ] Configure environment variables (`.env.example`)
- [ ] Set up VS Code workspace settings
- [ ] Add recommended VS Code extensions list
- [ ] Create development setup documentation

### Epic: CI/CD Pipeline
**Labels:** `devops`, `ci`

- [ ] Create GitHub Actions workflow (`.github/workflows/ci.yml`)
- [ ] Add Rust build and test job
- [ ] Add Rust clippy linting job
- [ ] Add Next.js build job
- [ ] Add TypeScript type checking job
- [ ] Add ESLint job for frontend
- [ ] Add Playwright E2E test job (placeholder)
- [ ] Configure caching for faster builds
- [ ] Add branch protection rules documentation

---

## Milestone 2: Core Backend (Week 3-4)

### Epic: Database Layer
**Labels:** `backend`, `database`

- [ ] Add SQLite dependency (`rusqlite` or `sqlx`)
- [ ] Create database connection pool
- [ ] Implement migrations system
- [ ] Create initial migration with schema:
  - [ ] `users` table
  - [ ] `sessions` table
  - [ ] `projects` table
  - [ ] `issues` table
  - [ ] `events` table
- [ ] Add database indexes for performance
- [ ] Create database abstraction trait (for future PostgreSQL)
- [ ] Add connection configuration (path, pool size)
- [ ] Implement database health check

### Epic: Authentication System
**Labels:** `backend`, `auth`, `security`

- [ ] Implement password hashing with bcrypt
- [ ] Create JWT token generation (access + refresh)
- [ ] Implement JWT validation middleware
- [ ] Create auth endpoints:
  - [ ] `POST /api/v1/auth/signup`
  - [ ] `POST /api/v1/auth/login`
  - [ ] `POST /api/v1/auth/logout`
  - [ ] `POST /api/v1/auth/refresh`
  - [ ] `GET /api/v1/auth/me`
- [ ] Add password validation rules
- [ ] Implement failed login rate limiting
- [ ] Add account lockout after failed attempts
- [ ] Create session management (store, invalidate)
- [ ] Add password requirements validation
- [ ] Write unit tests for auth logic
- [ ] Write integration tests for auth endpoints

### Epic: Project Management API
**Labels:** `backend`, `api`

- [ ] Implement API key generation (`bw_live_xxx` format)
- [ ] Create project endpoints:
  - [ ] `GET /api/v1/projects` - List user's projects
  - [ ] `POST /api/v1/projects` - Create project
  - [ ] `GET /api/v1/projects/:id` - Get project
  - [ ] `PATCH /api/v1/projects/:id` - Update project
  - [ ] `DELETE /api/v1/projects/:id` - Delete project
  - [ ] `POST /api/v1/projects/:id/keys` - Rotate API key
- [ ] Add project slug generation
- [ ] Implement authorization (owner check)
- [ ] Add pagination for project list
- [ ] Write integration tests

### Epic: Event Ingestion API
**Labels:** `backend`, `api`, `core`

- [ ] Define ErrorEvent struct matching schema
- [ ] Create event ingestion endpoint (`POST /api/v1/events`)
- [ ] Implement API key authentication
- [ ] Add request validation:
  - [ ] Required fields check
  - [ ] Timestamp validation
  - [ ] Level enum validation
  - [ ] SDK metadata validation
- [ ] Implement payload size limit (1MB default)
- [ ] Add async event processing (queue)
- [ ] Return 202 Accepted response
- [ ] Handle duplicate event_id (idempotency)
- [ ] Add error response formatting
- [ ] Write comprehensive tests for validation

### Epic: Error Fingerprinting
**Labels:** `backend`, `core`, `algorithm`

- [ ] Implement fingerprint generation algorithm
- [ ] Create message normalization:
  - [ ] Strip quoted strings
  - [ ] Replace numbers with `*`
  - [ ] Replace IPs with `*`
  - [ ] Replace UUIDs with `*`
- [ ] Implement stack trace normalization
- [ ] Filter to in-app frames only
- [ ] Generate SHA256 hash (16 chars)
- [ ] Add fingerprint override support (custom grouping)
- [ ] Write unit tests with edge cases
- [ ] Test fingerprint stability

### Epic: Issue Management
**Labels:** `backend`, `api`, `core`

- [ ] Implement issue creation on new fingerprint
- [ ] Update issue on existing fingerprint:
  - [ ] Increment count
  - [ ] Update last_seen
  - [ ] Update user_count (distinct users)
- [ ] Create issue endpoints:
  - [ ] `GET /api/v1/projects/:id/issues` - List issues
  - [ ] `GET /api/v1/projects/:id/issues/:issue_id` - Get issue
  - [ ] `PATCH /api/v1/projects/:id/issues/:issue_id` - Update status
  - [ ] `DELETE /api/v1/projects/:id/issues/:issue_id` - Delete issue
- [ ] Add filtering (status, level, date range)
- [ ] Add sorting (last_seen, count, first_seen)
- [ ] Implement pagination
- [ ] Add search by title/message
- [ ] Write integration tests

### Epic: Rate Limiting
**Labels:** `backend`, `security`

- [x] Implement token bucket algorithm
- [x] Create per-project rate limiter
- [x] Configure limits by tier:
  - [x] Free: 100 events/min
  - [x] Pro: 1,000 events/min
  - [x] Enterprise: 10,000 events/min
- [x] Add rate limit response headers
- [x] Return 429 with retry-after
- [x] Add burst handling
- [x] Store rate limit state (in-memory with DashMap)
- [x] Write tests for rate limiting

---

## Milestone 3: Web Dashboard (Week 5-6)

### Epic: Authentication UI
**Labels:** `frontend`, `auth`

- [x] Create signup page (`/signup`)
- [x] Create login page (`/login`)
- [x] Implement form validation
- [x] Add password strength indicator
- [x] Create auth context/provider
- [x] Implement token storage (localStorage with refresh)
- [x] Add auto token refresh
- [x] Create logout functionality
- [x] Add protected route wrapper
- [x] Redirect logic (auth → dashboard, unauth → login)
- [ ] Add "forgot password" placeholder

### Epic: Dashboard Layout
**Labels:** `frontend`, `ui`

- [x] Create main layout with sidebar
- [x] Implement project selector dropdown (placeholder)
- [x] Add navigation menu:
  - [x] Issues
  - [x] Uptime (placeholder)
  - [x] Settings
- [x] Create top bar with:
  - [x] Search (⌘K trigger placeholder)
  - [x] Help button
  - [x] Settings button
  - [x] User menu
- [ ] Add responsive design (mobile sidebar)
- [x] Implement dark/light mode toggle
- [ ] Add breadcrumb navigation

### Epic: Project Management UI
**Labels:** `frontend`, `ui`

- [x] Create project list page
- [x] Add create project modal
- [x] Display project API key (with copy button)
- [x] Add regenerate API key button (with confirmation)
- [x] Create project settings page
- [x] Add delete project (with confirmation)
- [x] Show project stats summary

### Epic: Issues List Page
**Labels:** `frontend`, `ui`, `core`

- [x] Create issues table component
- [x] Display issue row:
  - [x] Severity indicator (color)
  - [x] Title (truncated)
  - [x] Location (file:line)
  - [x] Event count
  - [x] Last seen (relative time)
  - [x] AI Fix button
- [x] Add filters:
  - [x] Status (unresolved, resolved, ignored) - basic
  - [ ] Level (fatal, error, warning)
  - [ ] Time range
- [ ] Implement sorting
- [ ] Add pagination (or infinite scroll)
- [ ] Create bulk actions (resolve, ignore)
- [ ] Add empty state
- [ ] Implement loading skeleton

### Epic: Issue Detail Page
**Labels:** `frontend`, `ui`, `core`

- [x] Create issue header:
  - [x] Title
  - [ ] Status dropdown
  - [ ] Assignee dropdown (placeholder)
  - [x] Action buttons (Ignore, Resolve)
- [x] Display stats bar (events, users, first/last seen, release)
- [x] Create tabs:
  - [x] Stack Trace
  - [x] Breadcrumbs
  - [x] Tags
  - [x] Events
- [x] Implement stack trace viewer:
  - [x] Expandable frames
  - [x] Code context display
  - [x] In-app frame highlighting
  - [x] Click to copy
- [x] Add breadcrumbs timeline
- [x] Display tags as chips
- [x] Create events list with pagination (basic)
- [x] Add AI Fix button/section

### Epic: Command Palette (⌘K)
**Labels:** `frontend`, `ui`, `ux`

- [ ] Install/configure cmdk or similar
- [ ] Create command palette modal
- [ ] Add recent issues section
- [ ] Add command shortcuts:
  - [ ] Go to Issues (⌘I)
  - [ ] Create Project (⌘N)
  - [ ] AI Fix (⌘F)
  - [ ] Search
- [ ] Implement fuzzy search
- [ ] Add keyboard navigation
- [ ] Style to match design system

---

## Milestone 4: Error Intelligence (Week 7-8)

### Epic: Source Map Support
**Labels:** `backend`, `sourcemaps`

- [ ] Create sourcemaps table migration
- [ ] Implement source map upload endpoint
- [ ] Add source map parsing (source-map crate)
- [ ] Implement position lookup
- [ ] Apply source maps during event processing
- [ ] Handle missing source maps gracefully
- [ ] Add source map CLI command
- [ ] Implement source map cleanup (old releases)
- [ ] Write tests

### Epic: Release Tracking
**Labels:** `backend`, `core`

- [ ] Add release field to events
- [ ] Track releases per project
- [ ] Show release in issue detail
- [ ] Filter issues by release
- [ ] Add release stats (new issues, regressions)

### Epic: Stack Trace Enhancement
**Labels:** `frontend`, `ui`

- [ ] Syntax highlighting for code context
- [ ] Line number display
- [ ] Error line highlighting
- [ ] Frame expansion animation
- [ ] Copy stack trace button
- [ ] Link to source (GitHub integration later)

---

## Milestone 5: Alerting & Integrations (Week 9-10)

### Epic: Alert Rules Engine
**Labels:** `backend`, `alerts`

- [ ] Create alert_rules table migration
- [ ] Define alert condition types:
  - [ ] New issue
  - [ ] Issue spike (count threshold)
  - [ ] Error rate increase
- [ ] Implement rule evaluation
- [ ] Create alert rule endpoints:
  - [ ] CRUD for alert rules
- [ ] Add default rule on project creation

### Epic: Email Notifications
**Labels:** `backend`, `notifications`

- [ ] Choose email provider (Resend, Postmark, SES)
- [ ] Create email templates:
  - [ ] New issue alert
  - [ ] Issue spike alert
  - [ ] Weekly digest
- [ ] Implement email sending service
- [ ] Add email preferences to user settings
- [ ] Queue email sending (async)
- [ ] Add unsubscribe handling

### Epic: Slack Integration
**Labels:** `backend`, `integrations`

- [ ] Create Slack OAuth flow
- [ ] Implement incoming webhook storage
- [ ] Create Slack message formatter
- [ ] Add Slack as alert action
- [ ] Create Slack notification settings UI

### Epic: Webhook Notifications
**Labels:** `backend`, `integrations`

- [ ] Implement generic webhook action
- [ ] Add webhook URL configuration
- [ ] Implement webhook signing (HMAC)
- [ ] Add retry logic for failed webhooks
- [ ] Create webhook payload schema

---

## Milestone 6: Production Readiness (Week 11-12)

### Epic: Performance Optimization
**Labels:** `backend`, `performance`

- [ ] Add database query optimization
- [ ] Implement connection pooling
- [ ] Add caching layer (issues list, project settings)
- [ ] Optimize fingerprint lookup (bloom filter?)
- [ ] Add request timing middleware
- [ ] Profile and optimize hot paths
- [ ] Add database vacuum/optimize job

### Epic: Security Hardening
**Labels:** `security`

- [ ] Security audit of auth system
- [ ] Add CSRF protection
- [ ] Implement request signing for SDK
- [ ] Add API key scoping (read/write)
- [ ] Audit rate limiting
- [ ] Add security headers
- [ ] Create security documentation

### Epic: Testing Suite
**Labels:** `testing`

- [ ] Achieve 80%+ backend coverage
- [ ] Achieve 60%+ frontend coverage
- [ ] Add E2E tests with Playwright:
  - [ ] Auth flow
  - [ ] Create project
  - [ ] View issues
  - [ ] Issue detail
- [ ] Add load testing scripts
- [ ] Create test data generators

### Epic: Documentation
**Labels:** `docs`

- [ ] Write API documentation
- [ ] Create SDK integration guide
- [ ] Add self-hosting guide
- [ ] Write troubleshooting guide
- [ ] Create architecture overview
- [ ] Add contributing guide

### Epic: Landing Page
**Labels:** `frontend`, `marketing`

- [ ] Design landing page
- [ ] Implement hero section
- [ ] Add feature highlights
- [ ] Create pricing section
- [ ] Add FAQ section
- [ ] Implement email signup (waitlist)
- [ ] Add SEO meta tags
- [ ] Create Open Graph images

---

## Milestone 7: SDK Development (Week 5-8, parallel)

### Epic: @bugwatch/core
**Labels:** `sdk`, `core`

- [ ] Initialize package in `packages/sdk/core/`
- [ ] Define TypeScript interfaces (ErrorEvent, etc.)
- [ ] Implement event builder
- [ ] Create transport layer (fetch-based)
- [ ] Add retry logic with exponential backoff
- [ ] Implement offline queue
- [ ] Add breadcrumb collector
- [ ] Create user context manager
- [ ] Add release/environment detection
- [ ] Implement sampling
- [ ] Write unit tests

### Epic: @bugwatch/node
**Labels:** `sdk`, `node`

- [ ] Initialize package in `packages/sdk/node/`
- [ ] Implement global error handler
- [ ] Add uncaughtException handler
- [ ] Add unhandledRejection handler
- [ ] Create Express middleware
- [ ] Add context extraction (req info)
- [ ] Implement console transport (pretty print)
- [ ] Add process info collection
- [ ] Write integration tests

### Epic: @bugwatch/react
**Labels:** `sdk`, `react`

- [ ] Initialize package in `packages/sdk/react/`
- [ ] Create ErrorBoundary component
- [ ] Implement auto-wrapping HOC
- [ ] Add React context for config
- [ ] Capture component stack
- [ ] Add hooks (useBugwatch)
- [ ] Write tests

### Epic: @bugwatch/nextjs
**Labels:** `sdk`, `nextjs`

- [ ] Initialize package in `packages/sdk/nextjs/`
- [ ] Create `withBugwatch` config wrapper
- [ ] Implement server-side capture
- [ ] Add client-side capture
- [ ] Handle App Router errors
- [ ] Handle API route errors
- [ ] Add middleware integration
- [ ] Auto-detect environment
- [ ] Write tests

### Epic: Dev Server & Toast UI
**Labels:** `sdk`, `dx`

- [ ] Create dev server (runs on :3001)
- [ ] Implement WebSocket server
- [ ] Create toast UI component (React)
- [ ] Style toast with shadow DOM isolation
- [ ] Add toast animations
- [ ] Implement expanded view
- [ ] Add "Open in VS Code" button
- [ ] Add "Copy" button
- [ ] Connect browser to dev server via WebSocket
- [ ] Handle reconnection

### Epic: Zero-Config Setup
**Labels:** `sdk`, `dx`

- [ ] Implement framework detection
- [ ] Create browser OAuth flow
- [ ] Implement API key storage to .env.local
- [ ] Add interactive terminal prompts
- [ ] Handle headless environments
- [ ] Create @bugwatch/auto package
- [ ] Test zero-config flow end-to-end

### Epic: CLI Tool
**Labels:** `sdk`, `cli`

- [ ] Create `bugwatch` CLI package
- [ ] Implement commands:
  - [ ] `bugwatch init` - Setup wizard
  - [ ] `bugwatch login` - Authenticate
  - [ ] `bugwatch test-error` - Send test event
  - [ ] `bugwatch status` - Show connection status
  - [ ] `bugwatch open` - Open dashboard
- [ ] Add interactive prompts
- [ ] Add colorful output
- [ ] Write help documentation

---

## Milestone 8: AI Features (Week 13-14)

### Epic: Context Gathering
**Labels:** `backend`, `ai`

- [ ] Create context gathering service
- [ ] Fetch error details from database
- [ ] Parse stack trace for file paths
- [ ] Implement GitHub file fetching (with token)
- [ ] Gather surrounding code context
- [ ] Collect recent git history (optional)
- [ ] Build context package for AI

### Epic: AI Fix Generation
**Labels:** `backend`, `ai`

- [ ] Create Claude API client
- [ ] Design fix generation prompt
- [ ] Implement structured output parsing
- [ ] Generate unified diff format
- [ ] Add explanation generation
- [ ] Implement confidence scoring
- [ ] Add fix caching (similar errors)
- [ ] Create ai_fixes table migration
- [ ] Store fix attempts and results

### Epic: AI Fix API
**Labels:** `backend`, `api`

- [ ] Create AI fix endpoint (`POST /api/v1/issues/:id/ai-fix`)
- [ ] Implement async processing (job queue)
- [ ] Add status endpoint (`GET /api/v1/ai-fixes/:id`)
- [ ] Implement streaming response (SSE)
- [ ] Add credit check before processing
- [ ] Deduct credits on completion
- [ ] Store feedback (thumbs up/down)

### Epic: AI Fix UI
**Labels:** `frontend`, `ai`

- [ ] Create AI Fix modal component
- [ ] Show cost and credit balance
- [ ] Implement live activity log
- [ ] Add progress indicator
- [ ] Display generated diff (syntax highlighted)
- [ ] Show AI explanation
- [ ] Add copy code button
- [ ] Create feedback buttons (thumbs up/down)
- [ ] Add "View on GitHub" link (after PR)

---

## Milestone 9: GitHub Integration (Week 13-14)

### Epic: GitHub OAuth
**Labels:** `backend`, `github`

- [ ] Create GitHub OAuth flow
- [ ] Store encrypted access tokens
- [ ] Implement token refresh
- [ ] Add repository selection UI
- [ ] Store repo connections per project
- [ ] Handle token revocation

### Epic: GitHub API Client
**Labels:** `backend`, `github`

- [ ] Create GitHub API wrapper
- [ ] Implement repository access check
- [ ] Add file content fetching
- [ ] Implement branch creation
- [ ] Add commit creation (via Contents API)
- [ ] Implement PR creation
- [ ] Add label management
- [ ] Handle API rate limits

### Epic: PR Creation Flow
**Labels:** `backend`, `github`

- [ ] Generate branch name (fix/bugwatch-xxx)
- [ ] Create branch from base
- [ ] Commit fix to branch
- [ ] Generate PR description from template
- [ ] Create pull request
- [ ] Add Bugwatch label
- [ ] Link PR to issue in Bugwatch

### Epic: GitHub Webhooks
**Labels:** `backend`, `github`

- [ ] Create webhook endpoint
- [ ] Verify webhook signatures
- [ ] Handle PR merged event → resolve issue
- [ ] Handle PR closed event → mark fix rejected
- [ ] Handle push events (optional)

---

## Milestone 10: Billing & Monetization (Week 15-16)

### Epic: Stripe Integration
**Labels:** `backend`, `billing`

- [ ] Create Stripe account and API keys
- [ ] Implement customer creation
- [ ] Add subscription plans (Pro, Enterprise)
- [ ] Create checkout session endpoint
- [ ] Implement billing portal link
- [ ] Handle subscription webhooks:
  - [ ] subscription.created
  - [ ] subscription.updated
  - [ ] subscription.deleted
  - [ ] invoice.paid
  - [ ] invoice.payment_failed

### Epic: Credit System
**Labels:** `backend`, `billing`

- [ ] Create credits table
- [ ] Implement credit purchase flow
- [ ] Add credit deduction on AI fix
- [ ] Create credit balance endpoint
- [ ] Add low credit warning
- [ ] Implement bulk discount pricing
- [ ] Add credit history/transactions

### Epic: Tier Enforcement
**Labels:** `backend`, `billing`

- [ ] Implement tier checks:
  - [ ] Event retention by tier
  - [ ] Team member limits
  - [ ] Rate limits by tier
  - [ ] Uptime monitor limits
- [ ] Add upgrade prompts in UI
- [ ] Create tier comparison page
- [ ] Handle downgrades gracefully

### Epic: Billing UI
**Labels:** `frontend`, `billing`

- [ ] Create billing settings page
- [ ] Show current plan
- [ ] Add upgrade button
- [ ] Display credit balance
- [ ] Add purchase credits button
- [ ] Show usage stats
- [ ] Display invoices list
- [ ] Add billing portal link

---

## Milestone 11: Uptime Monitoring (Week 15-16)

### Epic: Monitor Management
**Labels:** `backend`, `uptime`

- [ ] Create monitors table migration
- [ ] Implement monitor endpoints:
  - [ ] CRUD for monitors
  - [ ] Get monitor status
- [ ] Add monitor limits by tier
- [ ] Validate URL format

### Epic: Check Scheduler
**Labels:** `backend`, `uptime`

- [ ] Create background scheduler
- [ ] Implement HTTP health check
- [ ] Add timeout handling
- [ ] Store check results
- [ ] Calculate uptime percentage
- [ ] Detect status changes (up → down)
- [ ] Trigger alerts on down

### Epic: Uptime UI
**Labels:** `frontend`, `uptime`

- [ ] Create uptime dashboard
- [ ] Display monitor list with status
- [ ] Add uptime sparklines
- [ ] Create monitor detail page
- [ ] Add response time chart
- [ ] Display incidents list
- [ ] Create add monitor modal

---

## Milestone 12: Data Management

### Epic: Data Retention
**Labels:** `backend`, `data`

- [ ] Create cleanup job (scheduled)
- [ ] Implement retention by tier:
  - [ ] Free: 7 days
  - [ ] Pro: 90 days
  - [ ] Enterprise: 365 days
- [ ] Delete old events
- [ ] Update issue counts after cleanup
- [ ] Delete empty issues
- [ ] Add cleanup logging

### Epic: Data Export
**Labels:** `backend`, `api`

- [ ] Create export endpoint
- [ ] Support JSON export
- [ ] Support CSV export
- [ ] Add export for issues
- [ ] Add export for events
- [ ] Implement async export for large datasets

### Epic: Backup System
**Labels:** `backend`, `ops`

- [ ] Implement SQLite backup command
- [ ] Create backup schedule (cron)
- [ ] Add S3 upload (optional)
- [ ] Implement backup retention
- [ ] Add backup monitoring
- [ ] Document restore procedure

---

## Milestone 13: Launch Preparation (Week 17-20)

### Epic: Beta Testing
**Labels:** `launch`

- [ ] Create beta signup form
- [ ] Invite 20-50 beta users
- [ ] Set up feedback collection (form/Discord)
- [ ] Monitor for bugs and issues
- [ ] Iterate on AI fix quality
- [ ] Gather testimonials

### Epic: Launch Checklist
**Labels:** `launch`

- [ ] Final security audit
- [ ] Load testing complete
- [ ] Documentation complete
- [ ] Landing page live
- [ ] Pricing page live
- [ ] Legal pages (Terms, Privacy)
- [ ] Support email set up
- [ ] Monitoring and alerting set up
- [ ] On-call schedule defined

### Epic: Launch Marketing
**Labels:** `launch`, `marketing`

- [ ] Write launch blog post
- [ ] Prepare Hacker News post
- [ ] Prepare Product Hunt launch
- [ ] Create Twitter/X thread
- [ ] Prepare demo video
- [ ] Create comparison content
- [ ] Set up analytics

---

## Backlog (Post-Launch)

### Epic: Team Management
**Labels:** `feature`, `teams`

- [ ] Create teams/organizations model
- [ ] Implement RBAC (roles: owner, admin, member)
- [ ] Add team invitations
- [ ] Implement member management UI
- [ ] Add project-level permissions

### Epic: SSO/SAML (Enterprise)
**Labels:** `feature`, `enterprise`

- [ ] Implement SAML 2.0 support
- [ ] Add Google Workspace SSO
- [ ] Add Okta integration
- [ ] Add Azure AD integration
- [ ] Create SSO configuration UI

### Epic: Session Replay
**Labels:** `feature`, `addon`

- [ ] Research session replay implementation
- [ ] Design storage strategy
- [ ] Implement recording SDK
- [ ] Create replay viewer
- [ ] Add privacy controls

### Epic: Performance Monitoring
**Labels:** `feature`, `performance`

- [ ] Define performance event schema
- [ ] Implement transaction tracing
- [ ] Add latency tracking
- [ ] Create performance dashboard
- [ ] Add slow query detection

### Epic: VS Code Extension
**Labels:** `sdk`, `vscode`

- [ ] Create VS Code extension package
- [ ] Implement error highlighting
- [ ] Add gutter icons for error lines
- [ ] Create sidebar with recent errors
- [ ] Add hover tooltips
- [ ] Implement "AI Fix" action
- [ ] Publish to VS Code marketplace

### Epic: PostgreSQL Support
**Labels:** `backend`, `scale`

- [ ] Abstract database layer
- [ ] Add PostgreSQL migrations
- [ ] Test with PostgreSQL
- [ ] Add database selection config
- [ ] Document migration path

---

## Bug Fixes

*Add bugs here as they are discovered*

- [ ]

---

## Tech Debt

*Track technical debt items here*

- [ ]

---

## Notes

### Priority Labels
- `P0` - Critical, blocks launch
- `P1` - High priority, needed for v1
- `P2` - Medium priority, can be post-launch
- `P3` - Low priority, nice to have

### Status Labels
- `in-progress` - Currently being worked on
- `blocked` - Blocked by another task
- `needs-review` - Ready for code review
- `done` - Completed

### Area Labels
- `backend` - Rust server
- `frontend` - Next.js web app
- `sdk` - Client SDKs
- `docs` - Documentation
- `devops` - Infrastructure/CI/CD
