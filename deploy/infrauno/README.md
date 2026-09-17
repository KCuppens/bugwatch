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

Containers (active color, currently **green**): `buguno-server-green`,
`buguno-web-green`, `buguno-mcp-green`, `buguno-db`.

## Deploying (server + web)

Deploys are blue-green via the shared orchestrator (invoked over SSH from the
product's GitHub Actions deploy job, or run by hand on the host):

```bash
# on infrauno, IMAGE_TAG selects the ghcr tag (default: latest)
IMAGE_TAG=sha-xxxxxxx GHCR_TOKEN=... GHCR_USER=... \
  bash /opt/infrauno/scripts/deploy-cell.sh buguno
```

`deploy-cell.sh`: pulls + `up -d` the idle color, health-gates **every** service
in that color's compose, then repoints all `routes/buguno*.caddy` with
`sed -E "s/-(blue|green):/-<next>:/g"` and reloads the shared Caddy, then stops
the old color's app services (never the shared `db`).

> **CI status:** GitHub Actions is currently **billing-locked**, so nothing builds
> or deploys via CI. Until that's resolved, images are built/deployed by hand on
> the host (below).

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

### Building / updating the MCP image (manual, while CI is locked)

The compose references `bugwatch-mcp:local`, built on the host:

```bash
# from a machine with the repo checked out:
cd packages/mcp
tar czf - --exclude=node_modules --exclude=dist --exclude='*.test.ts' \
    package.json tsconfig.json tsup.config.ts Dockerfile src \
  | ssh infrauno 'rm -rf /root/buguno-mcp-build && mkdir -p /root/buguno-mcp-build/packages/mcp \
      && tar xzf - -C /root/buguno-mcp-build/packages/mcp'
ssh infrauno 'cd /root/buguno-mcp-build && docker build -f packages/mcp/Dockerfile -t bugwatch-mcp:local .'
# recreate the active-color mcp container
ssh infrauno 'cd /opt/buguno && docker compose -p buguno-green -f docker-compose.green.yml up -d mcp'
```

Once CI is unlocked, `deploy.yml` builds and pushes `ghcr.io/kcuppens/bugwatch-mcp`;
switch the compose `image:` from `bugwatch-mcp:local` to the GHCR ref so swaps pull
it like server/web. (`deploy-cell.sh` does `pull || true`, so `:local` is tolerated
in the meantime — pull fails, the local image is used.)

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
| `routes/buguno.caddy` | `/opt/infrauno/shared/routes/buguno.caddy` |
| `routes/buguno-api.caddy` | `/opt/infrauno/shared/routes/buguno-api.caddy` |

When you change these, copy them to the host paths above (the host is not a git
checkout).
