# Bugwatch SDKs

This directory contains the official Bugwatch SDKs for error tracking.

## Packages

| Package | Description |
|---------|-------------|
| `@bugwatch/core` | Core SDK with shared functionality |
| `@bugwatch/node` | Node.js SDK with process error handlers |
| `@bugwatch/nextjs` | Next.js SDK with server/client support |
| `@bugwatch/react` | React SDK with ErrorBoundary component |

## Quick Start

### Next.js

```bash
npm install @bugwatch/nextjs
```

```javascript
// next.config.js
const { withBugwatch } = require('@bugwatch/nextjs');

module.exports = withBugwatch({
  apiKey: 'your-api-key',
  environment: process.env.NODE_ENV,
})({
  // your next.js config
});
```

```tsx
// app/layout.tsx (or _app.tsx for pages router)
import { BugwatchProvider } from '@bugwatch/nextjs/client';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <BugwatchProvider options={{ apiKey: 'your-api-key' }}>
          {children}
        </BugwatchProvider>
      </body>
    </html>
  );
}
```

### React

```bash
npm install @bugwatch/react
```

```tsx
import { BugwatchProvider } from '@bugwatch/react';

function App() {
  return (
    <BugwatchProvider
      options={{
        apiKey: 'your-api-key',
        environment: 'production',
      }}
      fallback={(error, reset) => (
        <div>
          <h1>Something went wrong</h1>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    >
      <YourApp />
    </BugwatchProvider>
  );
}
```

### Node.js

```bash
npm install @bugwatch/node
```

```javascript
const { init, captureException } = require('@bugwatch/node');

init({
  apiKey: 'your-api-key',
  environment: 'production',
});

// Errors are automatically captured
// You can also manually capture:
try {
  doSomething();
} catch (error) {
  captureException(error);
}
```

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
  release?: string;           // App version
  debug?: boolean;            // Enable debug logging
  sampleRate?: number;        // 0.0 to 1.0
  maxBreadcrumbs?: number;    // Max breadcrumbs to capture
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
