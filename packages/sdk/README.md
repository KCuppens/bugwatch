# Bugwatch SDKs

Official SDKs for [Bugwatch](https://bugwatch.dev) error tracking. Capture, track, and resolve errors across your entire stack with first-class support for JavaScript, Python, and Rust.

## Packages

| Language | Package | Install | Docs |
|----------|---------|---------|------|
| JavaScript | `@bugwatch/core` | `npm i @bugwatch/core` | [Docs](https://bugwatch.dev/docs/sdks/javascript/core) |
| JavaScript | `@bugwatch/node` | `npm i @bugwatch/node` | [Docs](https://bugwatch.dev/docs/sdks/javascript/node) |
| JavaScript | `@bugwatch/nextjs` | `npm i @bugwatch/nextjs` | [Docs](https://bugwatch.dev/docs/sdks/javascript/nextjs) |
| JavaScript | `@bugwatch/react` | `npm i @bugwatch/react` | [Docs](https://bugwatch.dev/docs/sdks/javascript/react) |
| JavaScript | `@bugwatch/express` | `npm i @bugwatch/express` | [Docs](https://bugwatch.dev/docs/sdks/javascript/express) |
| JavaScript | `@bugwatch/fastify` | `npm i @bugwatch/fastify` | [Docs](https://bugwatch.dev/docs/sdks/javascript/fastify) |
| Python | `bugwatch-python` | `pip install bugwatch-python` | [Docs](https://bugwatch.dev/docs/sdks/python) |
| Rust | `bugwatch` | `cargo add bugwatch` | [Docs](https://bugwatch.dev/docs/sdks/rust) |

## Quick Start

### Next.js

Install the SDK:

```bash
npm install @bugwatch/nextjs
```

Initialize Bugwatch on the server side using the `instrumentation.ts` hook:

```typescript
// instrumentation.ts
import { init } from '@bugwatch/nextjs';

init({ apiKey: 'YOUR_API_KEY' });
```

Wrap your app with `BugwatchProvider` to capture client-side errors:

```tsx
// app/layout.tsx
import { BugwatchProvider } from '@bugwatch/nextjs/client';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <BugwatchProvider options={{ apiKey: 'YOUR_API_KEY' }}>
          {children}
        </BugwatchProvider>
      </body>
    </html>
  );
}
```

### Python (Django)

Install the SDK:

```bash
pip install bugwatch-python
```

Add the middleware and API key to your Django settings:

```python
# settings.py
MIDDLEWARE = [
    'bugwatch.django.BugwatchMiddleware',
    ...
]
BUGWATCH_API_KEY = 'YOUR_API_KEY'
```

The Python SDK also ships with integrations for Flask, FastAPI, and Celery. See the [Python docs](https://bugwatch.dev/docs/sdks/python) for details.

### Rust (Async)

Add the crate with the `async` feature:

```bash
cargo add bugwatch --features async
```

Initialize Bugwatch at the start of your application:

```rust
use bugwatch::init;

#[tokio::main]
async fn main() {
    init(bugwatch::Options {
        api_key: "YOUR_API_KEY".into(),
        ..Default::default()
    });

    // Your app code...
}
```

A blocking mode (without Tokio) is also available. See the [Rust docs](https://bugwatch.dev/docs/sdks/rust) for details.

## Self-Hosted Endpoint

If you are running a self-hosted Bugwatch instance, set the `endpoint` option to your API URL:

```typescript
init({
  apiKey: 'YOUR_API_KEY',
  endpoint: 'https://your-selfhosted-api.example.com',
});
```

The default endpoint is `https://api.bugwatch.dev`.

## API Reference

### Core Functions

```typescript
// Initialize the SDK
init(options: BugwatchOptions): void

// Capture an exception
captureException(error: Error, context?: Partial<ErrorEvent>): string

// Capture a message
captureMessage(message: string, level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'): string

// Add a breadcrumb
addBreadcrumb(breadcrumb: { category: string; message: string; level?: string }): void

// Set user context
setUser(user: { id?: string; email?: string; username?: string } | null): void

// Set a tag
setTag(key: string, value: string): void

// Set extra context
setExtra(key: string, value: unknown): void
```

### Options

```typescript
interface BugwatchOptions {
  // Required
  apiKey: string;

  // Optional
  endpoint?: string;           // API endpoint (default: https://api.bugwatch.dev)
  environment?: string;        // e.g., 'production', 'staging'
  release?: string;            // App version
  debug?: boolean;             // Enable debug logging
  sampleRate?: number;         // 0.0 to 1.0
  maxBreadcrumbs?: number;     // Max breadcrumbs to capture
  tags?: Record<string, string>;
  user?: UserContext;
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  ignoreErrors?: (string | RegExp)[];
}
```

## Development

```bash
# Build all SDKs
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm typecheck
```

## Documentation

For full documentation, guides, and framework-specific instructions, visit [bugwatch.dev/docs/sdks](https://bugwatch.dev/docs/sdks).
