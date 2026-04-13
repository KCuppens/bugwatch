# Stage 1: Install dependencies
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .

# Build SDK packages first (core -> node -> nextjs)
RUN cd packages/sdk/core && pnpm build
RUN cd packages/sdk/node && pnpm build
RUN cd packages/sdk/nextjs && pnpm build

# Build-time env vars (NEXT_PUBLIC_* are inlined at build time)
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_DEPLOYMENT_MODE=self-hosted
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_DEPLOYMENT_MODE=${NEXT_PUBLIC_DEPLOYMENT_MODE}
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/apps/web

RUN pnpm build

# Stage 3: Production runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# In monorepo standalone mode, server.js is at apps/web/server.js
CMD ["node", "apps/web/server.js"]
