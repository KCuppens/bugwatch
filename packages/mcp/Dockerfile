# Bugwatch hosted MCP server (Streamable HTTP transport).
# Build context is the repo root.

# Stage 1: build the bundle with tsup
FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/mcp/package.json ./
RUN npm install --no-audit --no-fund
COPY packages/mcp/tsconfig.json packages/mcp/tsup.config.ts ./
COPY packages/mcp/src ./src
RUN npm run build

# Stage 2: production runtime (prod deps only)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY packages/mcp/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist

RUN addgroup -S nodejs -g 1001 && adduser -S mcp -u 1001
USER mcp

ENV MCP_HTTP_PORT=3002
EXPOSE 3002

CMD ["node", "dist/http.js"]
