# Bugwatch Web

Next.js 15 dashboard and documentation site for Bugwatch, built with the App Router and [Fumadocs](https://fumadocs.vercel.app).

## Prerequisites

- Node.js 20+
- npm 10+

## Quick Start

```bash
npm install
npm run dev
```

The app starts on `http://localhost:3001` by default.

## Key Environment Variables

| Variable                      | Description                                               |
| ----------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`         | Backend API URL (default: `http://localhost:3000/api/v1`) |
| `NEXT_PUBLIC_DEPLOYMENT_MODE` | `saas` or `self-hosted` — controls billing UI visibility  |
| `ANALYZE`                     | Set to `true` to generate a bundle analysis report        |

## Directory Structure

```
src/
├── app/
│   ├── (dashboard)/     # Authenticated dashboard routes
│   ├── docs/            # Documentation pages (Fumadocs)
│   ├── login/           # Auth pages
│   ├── signup/
│   └── forgot-password/
├── components/
│   ├── landing/         # Marketing landing page
│   ├── billing/         # Subscription management
│   ├── onboarding/      # Setup wizard
│   ├── skeletons/       # Loading state skeletons
│   └── ui/              # shadcn/ui primitives
├── hooks/               # Custom React hooks
└── lib/                 # API client, auth, utilities
content/
└── docs/                # MDX documentation (49 pages)
```

## Component Development

Components follow the **CVA + Radix** pattern:

- **Variants** — Use [class-variance-authority](https://cva.style) for component variants (see `components/ui/button.tsx` for reference)
- **Primitives** — Built on [Radix UI](https://radix-ui.com) for accessible, unstyled primitives
- **Design tokens** — Colors and spacing defined as CSS custom properties in `globals.css` (e.g., `--accent`, `--surface-1`)
- **Glass morphism** — Use the `glass-card` and `glass` utility classes for the signature frosted-glass look

## Build Optimization

SDKs must be built before the web app (they're local workspace dependencies):

```bash
# From the monorepo root
npm run build --workspace=packages/sdk/core
npm run build --workspace=packages/sdk/node
npm run build --workspace=packages/sdk/nextjs
npm run build --workspace=apps/web
```

**Bundle analysis:**

```bash
npm run analyze
```

This generates a visual report of the bundle composition using `@next/bundle-analyzer`.

## Fumadocs (Documentation)

- Content lives in `content/docs/` as MDX files
- Navigation ordering is controlled by `meta.json` files in each directory
- The `.source/` directory is auto-generated — do not edit it manually
- `@source` alias in `tsconfig.json` points to `.source/index.ts`

## Type Checking

```bash
npx tsc --noEmit
```

## Testing

```bash
npm test              # Run tests
npm run test:watch    # Watch mode
npm run test:coverage # Run with coverage report
```

- Uses [Vitest](https://vitest.dev) with jsdom environment
- Test files: `*.test.ts` / `*.test.tsx` co-located with source files
- Coverage thresholds: 60% (statements, branches, functions, lines)

## Documentation

- [Full Docs](https://bugwatch.dev/docs)
- [Self-Hosting Guide](https://bugwatch.dev/docs/self-hosting)
