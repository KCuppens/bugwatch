import { addBreadcrumb, getClient, type Breadcrumb } from "@bugwatch/core";
import { AppState } from "react-native";

type BreadcrumbLevel = NonNullable<Breadcrumb["level"]>;

type ConsoleMethod = "debug" | "log" | "info" | "warn" | "error";

const MAX_CONSOLE_MESSAGE = 500;

const CONSOLE_LEVELS: ReadonlyArray<readonly [ConsoleMethod, BreadcrumbLevel]> = [
  ["debug", "debug"],
  ["log", "info"],
  ["info", "info"],
  ["warn", "warning"],
  ["error", "error"],
];

/** Objects are not serialised: they routinely hold tokens and PII. */
function formatConsoleArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "object" && arg !== null) return "[Object]";
  try {
    return String(arg);
  } catch {
    return "[unstringifiable]";
  }
}

/** Record `console.*` calls as breadcrumbs. Returns a function that restores console. */
export function setupConsoleBreadcrumbs(): () => void {
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  let recording = false;

  for (const [method, level] of CONSOLE_LEVELS) {
    const original = console[method];
    if (typeof original !== "function") continue;
    originals.set(method, original);

    const wrapped = (...args: unknown[]): void => {
      original.apply(console, args);
      // SDK debug output and re-entrant console calls must not become crumbs.
      if (recording || (typeof args[0] === "string" && args[0].startsWith("[Bugwatch]"))) return;
      recording = true;
      try {
        const message = args.map(formatConsoleArg).join(" ").slice(0, MAX_CONSOLE_MESSAGE);
        addBreadcrumb({ category: "console", message, level, data: { logger: method } });
      } catch {
        // Breadcrumb failures must never break logging.
      } finally {
        recording = false;
      }
    };
    console[method] = wrapped;
  }

  return () => {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  };
}

/** Query strings and fragments routinely carry tokens; keep only the path. */
function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

function levelForStatus(status: number): BreadcrumbLevel {
  if (status >= 500 || status === 0) return "error";
  return status >= 400 ? "warning" : "info";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface XhrState {
  method: string;
  url: string;
  start: number;
  skip: boolean;
}

/**
 * Record fetch and XMLHttpRequest calls as breadcrumbs. React Native's fetch
 * is built on XMLHttpRequest, so XHRs opened synchronously inside a fetch call
 * are skipped to avoid duplicates. Requests to the Bugwatch endpoint are never
 * recorded. Returns a function that restores the originals.
 */
export function setupNetworkBreadcrumbs(): () => void {
  const endpoint = getClient()?.getOptions().endpoint ?? "https://api.bugwatch.dev";
  const isOwnRequest = (url: string): boolean => url.startsWith(endpoint);
  const restorers: Array<() => void> = [];
  let fetchDepth = 0;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    const wrappedFetch: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

      fetchDepth++;
      let pending: Promise<Response>;
      try {
        pending = originalFetch.call(globalThis, input, init);
      } finally {
        fetchDepth--;
      }
      if (isOwnRequest(url)) return pending;

      const start = Date.now();
      const data = { method, url: stripQuery(url) };
      return pending.then(
        (response) => {
          addBreadcrumb({
            category: "fetch",
            message: `${method} ${data.url} [${response.status}]`,
            level: levelForStatus(response.status),
            data: { ...data, status_code: response.status, duration_ms: Date.now() - start },
          });
          return response;
        },
        (error: unknown) => {
          addBreadcrumb({
            category: "fetch",
            message: `${method} ${data.url} [network error]`,
            level: "error",
            data: { ...data, duration_ms: Date.now() - start },
          });
          throw error;
        }
      );
    };
    globalThis.fetch = wrappedFetch;
    restorers.push(() => {
      if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    });
  }

  if (typeof XMLHttpRequest !== "undefined") {
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const states = new WeakMap<XMLHttpRequest, XhrState>();

    const wrappedOpen = function (this: XMLHttpRequest, ...args: unknown[]): void {
      const url = String(args[1]);
      states.set(this, {
        method: String(args[0]).toUpperCase(),
        url,
        start: 0,
        skip: fetchDepth > 0 || isOwnRequest(url),
      });
      Reflect.apply(originalOpen, this, args);
    };

    const wrappedSend = function (this: XMLHttpRequest, ...args: unknown[]): void {
      const state = states.get(this);
      if (state && !state.skip) {
        state.start = Date.now();
        this.addEventListener("loadend", () => {
          const url = stripQuery(state.url);
          const status = this.status;
          addBreadcrumb({
            category: "xhr",
            message: `${state.method} ${url} [${status === 0 ? "network error" : status}]`,
            level: levelForStatus(status),
            data: { method: state.method, url, status_code: status, duration_ms: Date.now() - state.start },
          });
        });
      }
      Reflect.apply(originalSend, this, args);
    };

    proto.open = wrappedOpen as typeof proto.open;
    proto.send = wrappedSend as typeof proto.send;
    restorers.push(() => {
      if (proto.open === wrappedOpen) proto.open = originalOpen;
      if (proto.send === wrappedSend) proto.send = originalSend;
    });
  }

  return () => {
    for (const restore of restorers) restore();
  };
}

/**
 * Record foreground/background transitions. Events are flushed when the app
 * is backgrounded since the OS may suspend or kill the process afterwards.
 */
export function setupAppStateBreadcrumbs(): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    addBreadcrumb({ category: "app.lifecycle", message: `App state: ${state}`, level: "info" });
    if (state === "background") {
      getClient()
        ?.flush()
        .catch(() => {});
    }
  });
  return () => {
    if (subscription) subscription.remove();
  };
}
