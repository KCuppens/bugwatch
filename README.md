<div align="center">

<h1>Bugwatch</h1>

**Open-source error tracking. Unlimited events. No surprise bills.**

<br>

[![License: FSL-1.1-Apache-2.0](https://img.shields.io/badge/License-FSL--1.1--Apache--2.0-blue.svg)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/KCuppens/bugwatch/docker-publish.yml?branch=main)](https://github.com/KCuppens/bugwatch/actions)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fkcuppens%2Fbugwatch-blue?logo=docker)](https://ghcr.io/kcuppens/bugwatch)
[![Docs](https://img.shields.io/badge/Docs-bugwatch.dev-green)](https://bugwatch.dev/docs)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/bugwatch)

</div>

---

Bugwatch is an open-source error tracking platform built for teams that are tired of per-event pricing.
With unlimited events and simple per-seat billing, you never have to worry about cost spikes during an
incident. Bugwatch covers three monitoring pillars — **errors**, **uptime**, and **server health** — with
14 framework SDKs across JavaScript, Python, and Rust. Self-host with a single Docker Compose command
or use the managed cloud, all under the FSL-1.1-Apache-2.0 license that converts to Apache 2.0 in 2028.

---

## Screenshots

<table>
  <tr>
    <td><img src="apps/web/public/screenshots/dashboard.png" alt="Dashboard overview" width="400"/></td>
    <td><img src="apps/web/public/screenshots/issue-detail.png" alt="Issue detail view" width="400"/></td>
  </tr>
  <tr>
    <td align="center"><strong>Dashboard</strong></td>
    <td align="center"><strong>Issue Detail</strong></td>
  </tr>
  <tr>
    <td><img src="apps/web/public/screenshots/uptime.png" alt="Uptime monitoring" width="400"/></td>
    <td><img src="apps/web/public/screenshots/server.png" alt="Server monitoring" width="400"/></td>
  </tr>
  <tr>
    <td align="center"><strong>Uptime Monitoring</strong></td>
    <td align="center"><strong>Server Monitoring</strong></td>
  </tr>
</table>

---

## Get Started

### Cloud

1. **Sign up** at [bugwatch.dev](https://bugwatch.dev)
2. **Create a project** and copy your DSN
3. **Install an SDK** and start capturing errors (see below)

### Self-Hosted

1. **Clone the repo**

```bash
git clone https://github.com/KCuppens/bugwatch.git
cd bugwatch
```

2. **Create your `.env` file**

```bash
JWT_SECRET=your-secret-key-here
DOMAIN=bugwatch.example.com
```

3. **Start the stack**

```bash
docker compose -f docker-compose.self-hosted.yml up -d
```

4. **Open your browser** at `http://localhost:3000` and create your first account.

### Self-Host vs Cloud Build

Bugwatch ships a single codebase with two build targets, controlled by a Cargo
feature flag and one env var:

| Build      | Command                                         | `BUGWATCH_MODE` | Billing / Stripe                 | Tier limits                       |
| ---------- | ----------------------------------------------- | --------------- | -------------------------------- | --------------------------------- |
| Self-host  | `cargo build --release`                         | `self-hosted`   | Disabled (not compiled in)       | All orgs get the Team tier, free  |
| Cloud      | `cargo build --release --features saas`         | `saas`          | Stripe endpoints + webhooks      | Read from the org's subscription  |

- The default `docker-compose.self-hosted.yml` build targets the self-host profile — you do not need a Stripe account to run Bugwatch for your own team.
- The `saas` feature is the only thing that compiles in `async-stripe` and the AWS SES email transport, so self-host builds stay lean.
- The FSL-1.1 license permits running the cloud build for your own company, but prohibits offering Bugwatch as a competing hosted service until it converts to Apache 2.0 on **March 15, 2028**. See [LICENSE](LICENSE).

### Quick SDK Example (Next.js)

```bash
npm install @bugwatch/nextjs
```

```typescript
// instrumentation.ts
import { init } from "@bugwatch/nextjs";

init({ apiKey: "YOUR_API_KEY" });
```

---

## SDK Matrix

| Language   | Framework | Package                                                                  | Install Command                 |
| ---------- | --------- | ------------------------------------------------------------------------ | ------------------------------- |
| JavaScript | Core      | [`@bugwatch/core`](https://bugwatch.dev/docs/sdks/javascript/core)       | `npm install @bugwatch/core`    |
| JavaScript | Node.js   | [`@bugwatch/node`](https://bugwatch.dev/docs/sdks/javascript/node)       | `npm install @bugwatch/node`    |
| JavaScript | Next.js   | [`@bugwatch/nextjs`](https://bugwatch.dev/docs/sdks/javascript/nextjs)   | `npm install @bugwatch/nextjs`  |
| JavaScript | React     | [`@bugwatch/react`](https://bugwatch.dev/docs/sdks/javascript/react)     | `npm install @bugwatch/react`   |
| JavaScript | Express   | [`@bugwatch/express`](https://bugwatch.dev/docs/sdks/javascript/express) | `npm install @bugwatch/express` |
| JavaScript | Fastify   | [`@bugwatch/fastify`](https://bugwatch.dev/docs/sdks/javascript/fastify) | `npm install @bugwatch/fastify` |
| Python     | Base      | [`bugwatch-python`](https://bugwatch.dev/docs/sdks/python)               | `pip install bugwatch-python`   |
| Python     | Django    | [`bugwatch-python`](https://bugwatch.dev/docs/sdks/python/django)        | `pip install bugwatch-python`   |
| Python     | Flask     | [`bugwatch-python`](https://bugwatch.dev/docs/sdks/python/flask)         | `pip install bugwatch-python`   |
| Python     | FastAPI   | [`bugwatch-python`](https://bugwatch.dev/docs/sdks/python/fastapi)       | `pip install bugwatch-python`   |
| Python     | Celery    | [`bugwatch-python`](https://bugwatch.dev/docs/sdks/python/celery)        | `pip install bugwatch-python`   |
| Rust       | Async     | [`bugwatch`](https://bugwatch.dev/docs/sdks/rust/async)                  | `cargo add bugwatch`            |
| Rust       | Blocking  | [`bugwatch`](https://bugwatch.dev/docs/sdks/rust/blocking)               | `cargo add bugwatch`            |

---

## Features

**Unlimited Events** — No per-event billing, ever. Track every error across all your projects without worrying about volume spikes or overage charges.

**Uptime Monitoring** — HTTP monitors with configurable intervals, incident tracking, and status page integration — all built in, not bolted on.

**Server Monitoring** — Track CPU, memory, disk, and network metrics via a lightweight agent. See system health alongside your application errors.

**Real-time Alerting** — Get notified instantly through Slack, email, PagerDuty, or custom webhooks when issues occur or monitors go down.

**Smart Issue Grouping** — Fingerprint-based deduplication automatically groups related errors into issues, cutting through noise to surface what matters.

**Self-Hostable** — One Docker Compose file, your infrastructure, your data. No external dependencies, no phone-home telemetry.

---

## Why Bugwatch?

| Feature       | Bugwatch                        | Sentry                           |
| ------------- | ------------------------------- | -------------------------------- |
| Pricing model | Per-seat ($12–$25/mo)           | Per-event (volume-based)         |
| Event limits  | Unlimited on all plans          | Capped, overages billed          |
| Self-hosting  | Docker Compose, fully supported | Docker, limited official support |
| Setup time    | < 5 minutes                     | 10–30 minutes                    |
| SDK config    | 3 lines of code                 | Multi-step configuration         |
| Open source   | Yes                             | Partially (BSL licensed)         |
| License       | FSL-1.1-Apache-2.0              | BSL-1.1                          |

_See the [full comparison](https://bugwatch.dev/docs/migration/comparison) for a detailed breakdown._

---

## AI-Assisted Setup

Bugwatch supports the [llms.txt](https://llmstxt.org/) standard, making it easy to get setup help from AI assistants. Point your LLM at our documentation and ask it to configure Bugwatch for your stack.

**Example prompt:**

```
Using the Bugwatch documentation at https://bugwatch.dev/llms-full.txt, help me set up
error tracking for my Next.js 14 app with App Router. I want to capture both client-side
and server-side errors.
```

- [Full documentation for LLMs](https://bugwatch.dev/llms-full.txt)
- [AI prompts guide](https://bugwatch.dev/docs/getting-started/ai-prompts)

---

## Agent Integration

Bugwatch is designed to work with AI coding agents and automation tools. Generate an **Agent API Key** (`bw_agent_*`) from your project settings with scoped read, write, or admin permissions, then connect through whichever interface fits your workflow.

- **MCP Server** — First-class support for Claude Desktop, Cursor, and Windsurf via the Model Context Protocol:

  ```json
  {
    "mcpServers": {
      "bugwatch": {
        "command": "npx",
        "args": ["@bugwatch/mcp"],
        "env": { "BUGWATCH_AGENT_KEY": "bw_agent_..." }
      }
    }
  }
  ```

- **CLI** — Pipe structured output directly into terminal-based agents:

  ```bash
  bugwatch issues --json            # list open issues as JSON
  bugwatch resolve ISSUE-42         # mark an issue resolved
  bugwatch monitors status          # check uptime monitors
  ```

- **OpenAPI Spec** — A full OpenAPI 3.1 specification is available at `/api/v1/openapi.yaml` for building custom integrations or generating typed clients.

For the full guide — including per-key permission scopes and framework-specific recipes — see the [Agent Integration docs](https://bugwatch.dev/docs/agents).

---

## Architecture

```
┌──────────┐      ┌─────────────────────┐      ┌────────────┐      ┌──────────────────┐
│          │      │                     │      │            │      │                  │
│   SDKs   │─────▶│  API Server         │─────▶│ PostgreSQL │◀─────│  Dashboard       │
│          │      │  (Rust / Axum)      │      │            │      │  (Next.js)       │
│          │      │                     │      │            │      │                  │
└──────────┘      └─────────────────────┘      └────────────┘      └──────────────────┘
```

- **API Server** — Rust with Axum for high-throughput event ingestion and processing
- **Database** — PostgreSQL for reliable, scalable data storage
- **Dashboard** — Next.js 15 with App Router, shadcn/ui, and Tailwind CSS

---

## Project Structure

```
bugwatch/
├── apps/
│   ├── server/          # Rust API server (Axum)
│   └── web/             # Next.js dashboard + docs
├── packages/
│   └── sdk/             # Official SDKs
│       ├── core/        # @bugwatch/core
│       ├── node/        # @bugwatch/node
│       ├── nextjs/      # @bugwatch/nextjs
│       ├── react/       # @bugwatch/react
│       ├── express/     # @bugwatch/express
│       └── fastify/     # @bugwatch/fastify
├── docker-compose.self-hosted.yml
├── Caddyfile
└── CONTRIBUTING.md
```

---

## Community

We welcome contributions and feedback from the community.

- [Contributing Guide](CONTRIBUTING.md) — How to set up your dev environment and submit PRs
- [Code of Conduct](CODE_OF_CONDUCT.md) — Our standards for community participation
- [Security Policy](SECURITY.md) — How to report vulnerabilities responsibly
- [Documentation](https://bugwatch.dev/docs) — Guides, API reference, and SDK docs
- [Discord](https://discord.gg/bugwatch) — Chat with the team and other users
- [GitHub Discussions](https://github.com/KCuppens/bugwatch/discussions) — Ask questions and share ideas

---

## License

Bugwatch is licensed under the [FSL-1.1-Apache-2.0](LICENSE) (Functional Source License).

**What this means in plain English:**

- **Free to use and modify** — You can run Bugwatch for your own projects, contribute to it, and modify it however you want.
- **One restriction** — You cannot offer Bugwatch as a hosted error tracking service that competes with the managed product.
- **Converts to Apache 2.0** — On **March 15, 2028**, the license automatically converts to the permissive Apache 2.0 license with no restrictions.

For full license details, see the [LICENSE](LICENSE) file.
