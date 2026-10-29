# Bugwatch on infrauno (the `buguno` cell)

This directory documents how Bugwatch is **actually deployed in production**, which
differs from the generic "gold pattern" blue-green files at the repo root
(`docker-compose.blue.yml`, `Caddyfile.blue`, `scripts/deploy-blue-green.sh`,
`scripts/setup-server.sh`). Those root files are the reference pattern the infrauno
model was derived from; **prod runs the adapted cell described here.**

## Where it runs

- **Host:** `infrauno` (SSH host in `~/.ssh/config`), a shared box running ~20
  `*uno` apps behind one central Caddy.
- **Deploy dir:** `/opt/buguno` (not `/opt/bugwatch`). Manually managed, not a git
  checkout — treat the files in this directory as the source of truth and copy
  them over when they change.
- **Identity:** internal/deploy name is `buguno` (Phase-1 rename of bugwatch).
  Public `bugwatch.dev` and the published SDKs are untouched;
  `api.bugwatch.dev` is kept alive via `routes/buguno-api.caddy`.
- **Registered** in `/opt/infrauno/registry.yml` under `buguno` (subdomain
  `buguno.webuno.io`, extra hostname `api.bugwatch.dev`, GHCR `bugwatch-*`
  images, db `buguno`).

## Topology

```
Cloudflare (proxied CNAME -> cf tunnel)  bugwatch.dev / api.bugwatch.dev / buguno.webuno.io
                     │
             shared `caddy` container   (/opt/infrauno/shared/Caddyfile + routes/*.caddy)
                     │  imports routes/buguno.caddy for http://bugwatch.dev
        ┌────────────┼─────────────────────────────┐
        │ /api/*, /health, /install.sh, /agent/*    │ -> buguno-server-<color>:3000
        │ /mcp*                                      │ -> buguno-mcp-<color>:3002
        │ (everything else)                         │ -> buguno-web-<color>:3001
        └───────────────────────────────────────────┘
  networks: edge (shared with Caddy) + internal (buguno-internal, db)
```

Containers: `buguno-{server,web,mcp}-<color>` (active color in
`/opt/buguno/.active-color`) and `buguno-db`.

## Deploying (server + web + mcp)

A push to `main` deploys through HookCI once every check passes
(`.hookci.yml` `deployments.production`). The deploy step runs as `hookci-deploy`
on infrauno:

1. `scripts/deploy/build-images.sh` builds `bugwatch-{server,web,mcp}:sha-<12 hex>`
   on the host. Nothing goes through GHCR.
2. `sudo -n /opt/buguno/hookci-deploy-prod.sh <sha>` (root, the only command
   `/etc/sudoers.d/hookci-buguno` allows) checks the three images exist, takes
   `/var/lock/buguno-deploy.lock`, runs
   `IMAGE_TAG=sha-<12 hex> /opt/infrauno/scripts/deploy-cell.sh buguno`, logs to
   `/opt/buguno/deploys.log` and keeps the newest 3 tags per image.

`deploy-cell.sh`: `up -d` the idle color, health-gates **every** service
in that color's compose, then repoints all `routes/buguno*.caddy` with
`sed -E "s/-(blue|green):/-<next>:/g"` and reloads the shared Caddy, then stops
the old color's app services (never the shared `db`). The server applies its
migrations on boot.

Rollback to a kept tag, on infrauno as root:

```bash
docker image ls bugwatch-server   # pick a sha-<12 hex> tag
IMAGE_TAG=sha-<12 hex> bash /opt/infrauno/scripts/deploy-cell.sh buguno
```

The compose files use `bugwatch-*:${IMAGE_TAG:-unset}` with `pull_policy: never`, so
`up` without `IMAGE_TAG` fails instead of starting an unknown image.

## The hosted MCP server (`/mcp`)

`https://bugwatch.dev/mcp` — a Streamable HTTP MCP server (stateless) that lets an
agent inspect and resolve issues directly. Source: `packages/mcp` (entry
`src/http.ts`). Same tool/resource/prompt surface as the stdio server.

**Auth model — single shared key:** the container holds one Bugwatch agent key
(`BUGWATCH_AGENT_KEY`); every caller acts as that key. The public endpoint is
gated by a shared bearer secret (`MCP_AUTH_TOKEN`) — callers send
`Authorization: Bearer <MCP_AUTH_TOKEN>`. If `MCP_AUTH_TOKEN` is unset the
endpoint is open (a warning is logged at boot).

Client config:

```json
{ "mcpServers": { "bugwatch": {
  "url": "https://bugwatch.dev/mcp",
  "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
}}}
```

### Secrets (`/opt/buguno/.env`)

- `BUGWATCH_AGENT_KEY` — a `bw_agent_*` key (generate in the dashboard, or mint via
  the DB, see below). Scope it appropriately; the MCP uses read + resolve.
- `MCP_AUTH_TOKEN` — random bearer secret gating `/mcp`.

Both `server` and `mcp` use `env_file: [.env]`, so **editing `.env` recreates the
server container too** (a few-seconds API blip). Expect that when rotating these.

### Updating the MCP image

The MCP image is built and deployed with server and web on every `main` deploy.

### Minting an agent key via the DB

The dashboard is the intended path. To mint directly (matches
`apps/server/src/auth/agent.rs`): key = `bw_agent_` + 32 random bytes hex;
`key_hash = HMAC_SHA256(key, JWT_SECRET)` hex; insert into `agent_keys`
(`organization_id`, `name`, `key_hash`, `key_prefix` = first 12 chars,
`permissions` = `["read","write"]`, `created_by`). Agent access to a project with a
NULL `organization_id` falls back to `project.owner_id == org.owner_id`, but the
**list** endpoint filters by org — projects were backfilled with the org id so the
key can enumerate them.

## Why swaps keep `/mcp` working

- `mcp` is defined in **both** `docker-compose.blue.yml` and `.green.yml`, so
  `deploy-cell.sh` brings it up in the new color and health-gates
  `buguno-mcp-<color>`.
- The Caddy repoint `sed -E "s/-(blue|green):/-<next>:/g"` rewrites
  `buguno-mcp-green:3002` → `buguno-mcp-blue:3002` alongside server/web.

## Files here (mirrors of the host)

| Repo file | Host path |
|---|---|
| `docker-compose.blue.yml` | `/opt/buguno/docker-compose.blue.yml` |
| `docker-compose.green.yml` | `/opt/buguno/docker-compose.green.yml` |
| `hookci-deploy-prod.sh` | `/opt/buguno/hookci-deploy-prod.sh` (root, 0755) |
| `routes/buguno.caddy` | `/opt/infrauno/shared/routes/buguno.caddy` |
| `routes/buguno-api.caddy` | `/opt/infrauno/shared/routes/buguno-api.caddy` |

When you change these, copy them to the host paths above (the host is not a git
checkout). `/etc/sudoers.d/hookci-buguno` (root, 0440):
`hookci-deploy ALL=(root) NOPASSWD: /opt/buguno/hookci-deploy-prod.sh`.
