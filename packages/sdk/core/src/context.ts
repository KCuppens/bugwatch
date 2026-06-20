/**
 * Request-scoped context using AsyncLocalStorage.
 *
 * This module provides thread-safe, request-isolated context storage
 * for Node.js environments. Each concurrent request gets its own
 * isolated context that won't leak to other requests.
 */

import type { UserContext, Breadcrumb } from "./types";

/**
 * Request-scoped context that is isolated per request
 */
export interface ScopedContext {
  user: UserContext | null;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  breadcrumbs: Breadcrumb[];
}

/**
 * Create a new empty scoped context
 */
export function createScopedContext(): ScopedContext {
  return {
    user: null,
    tags: {},
    extra: {},
    breadcrumbs: [],
  };
}

// AsyncLocalStorage is only available in Node.js environments
let asyncLocalStorage: import("async_hooks").AsyncLocalStorage<ScopedContext> | null = null;

/**
 * Check if we're in a Node.js environment with async_hooks support
 */
function isNodeEnvironment(): boolean {
  return typeof process !== "undefined" &&
         process.versions?.node !== undefined &&
         typeof require !== "undefined";
}

/**
 * Initialize the AsyncLocalStorage if available
 */
function getAsyncLocalStorage(): import("async_hooks").AsyncLocalStorage<ScopedContext> | null {
  if (asyncLocalStorage) {
    return asyncLocalStorage;
  }

  if (!isNodeEnvironment()) {
    return null;
  }

  try {
    // Dynamic import for Node.js environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asyncHooks = require("async_hooks") as typeof import("async_hooks");
    asyncLocalStorage = new asyncHooks.AsyncLocalStorage<ScopedContext>();
    return asyncLocalStorage;
  } catch {
    // async_hooks not available (browser, edge runtime, etc.)
    return null;
  }
}

/**
 * Run a function within an isolated context.
 *
 * All context operations (setUser, setTag, etc.) within this function
 * will be scoped to this context and won't affect other concurrent requests.
 *
 * @param context - The initial context for this scope
 * @param fn - The function to run within the context
 * @returns The result of the function
 */
export function runWithContext<T>(context: ScopedContext, fn: () => T): T {
  const storage = getAsyncLocalStorage();
  if (storage) {
    return storage.run(context, fn);
  }
  // Fallback: just run the function without isolation
  return fn();
}

/**
 * Run an async function within an isolated context.
 */
export async function runWithContextAsync<T>(
  context: ScopedContext,
  fn: () => Promise<T>
): Promise<T> {
  const storage = getAsyncLocalStorage();
  if (storage) {
    return storage.run(context, fn);
  }
  return fn();
}

/**
 * Get the current request-scoped context.
 * Returns undefined if not running within a context scope.
 */
export function getRequestContext(): ScopedContext | undefined {
  const storage = getAsyncLocalStorage();
  return storage?.getStore();
}

/**
 * Check if we're currently running within a scoped context
 */
export function hasRequestContext(): boolean {
  return getRequestContext() !== undefined;
}

/**
 * Set user in the current request context (if available)
 * Returns true if the user was set in request context, false otherwise
 */
export function setRequestUser(user: UserContext | null): boolean {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.user = user;
    return true;
  }
  return false;
}

/**
 * Set a tag in the current request context (if available)
 * Returns true if the tag was set in request context, false otherwise
 */
export function setRequestTag(key: string, value: string): boolean {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.tags[key] = value;
    return true;
  }
  return false;
}

/**
 * Set extra data in the current request context (if available)
 * Returns true if the extra was set in request context, false otherwise
 */
export function setRequestExtra(key: string, value: unknown): boolean {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.extra[key] = value;
    return true;
  }
  return false;
}

/**
 * Add a breadcrumb to the current request context (if available)
 * Returns true if the breadcrumb was added to request context, false otherwise
 */
export function addRequestBreadcrumb(breadcrumb: Breadcrumb, maxBreadcrumbs: number = 100): boolean {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.breadcrumbs.push(breadcrumb);
    // Limit breadcrumbs
    if (ctx.breadcrumbs.length > maxBreadcrumbs) {
      ctx.breadcrumbs = ctx.breadcrumbs.slice(-maxBreadcrumbs);
    }
    return true;
  }
  return false;
}

/**
 * Get the merged context from request scope and global scope
 */
export function getMergedContext(
  globalUser: UserContext | null,
  globalTags: Record<string, string>,
  globalExtra: Record<string, unknown>,
  globalBreadcrumbs: Breadcrumb[]
): {
  user: UserContext | null;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  breadcrumbs: Breadcrumb[];
} {
  const reqCtx = getRequestContext();

  if (!reqCtx) {
    return {
      user: globalUser,
      tags: globalTags,
      extra: globalExtra,
      breadcrumbs: globalBreadcrumbs,
    };
  }

  // Request context takes precedence over global context
  return {
    user: reqCtx.user || globalUser,
    tags: { ...globalTags, ...reqCtx.tags },
    extra: { ...globalExtra, ...reqCtx.extra },
    breadcrumbs: [...globalBreadcrumbs, ...reqCtx.breadcrumbs],
  };
}
