import type {
  BugwatchOptions,
  BugwatchClient,
  ErrorEvent,
  PerformanceEvent,
  Breadcrumb,
  UserContext,
  Transport,
  Integration,
  ExceptionInfo,
} from "./types";
import { HttpTransport, NoopTransport } from "./transport";
import { parseStackTrace, extractErrorInfo } from "./stacktrace";
import { fingerprintFromException } from "./fingerprint";
import { getMergedContext } from "./context";
import { Transaction } from "./performance";
import { scrubEvent } from "./scrubbing";
import { shouldDenyUrl, shouldAllowUrl, shouldDropByLevel, isBrowserNoise, sessionErrorCounter } from "./filters";

/**
 * Ring buffer for efficient breadcrumb storage.
 * Avoids array shifting/slicing on every breadcrumb addition.
 */
class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private maxSize: number) {
    this.buffer = new Array(maxSize);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) {
      this.count++;
    }
  }

  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }

    const result: T[] = [];
    // Start from the oldest item
    const start = this.count < this.maxSize ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }
}

const SDK_NAME = "@bugwatch/core";
const SDK_VERSION = "0.1.0";

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  // Fallback for environments without crypto.randomUUID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Partial<BugwatchOptions> = {
  endpoint: "https://api.bugwatch.dev",
  debug: false,
  sampleRate: 1.0,
  maxBreadcrumbs: 100,
  environment: "production",
};

/**
 * Core Bugwatch client implementation
 */
export class Bugwatch implements BugwatchClient {
  private options: BugwatchOptions;
  private transport: Transport;
  private breadcrumbs: RingBuffer<Breadcrumb>;
  private tags: Record<string, string> = {};
  private extra: Record<string, unknown> = {};
  private user: UserContext | null = null;
  private sessionId: string | null = null;
  private integrations: Integration[] = [];
  private initialized = false;

  constructor(options: BugwatchOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const sr = this.options.sampleRate;
    if (sr !== undefined && (sr < 0 || sr > 1)) {
      throw new Error(`[Bugwatch] Invalid sampleRate: ${sr}. Must be between 0 and 1.`);
    }
    const mes = this.options.maxErrorsPerSession;
    if (mes !== undefined && (!Number.isInteger(mes) || mes < 0)) {
      throw new Error(
        `[Bugwatch] Invalid maxErrorsPerSession: ${mes}. Must be a non-negative integer (use 0 to disable).`
      );
    }

    const key = this.options.apiKey?.trim();
    if (key && !key.startsWith("bw_")) {
      console.warn('[Bugwatch] apiKey does not start with "bw_" — verify the correct project key is being used.');
    }

    const ep = this.options.endpoint ?? "";
    if (ep && !ep.startsWith("https://") && !ep.includes("localhost") && !ep.includes("127.0.0.1")) {
      console.warn(
        `[Bugwatch] Endpoint "${ep}" does not use HTTPS. All error events (including stack traces and user context) will be transmitted insecurely.`
      );
    }

    this.transport = this.createTransport();
    this.breadcrumbs = new RingBuffer<Breadcrumb>(this.options.maxBreadcrumbs || 100);

    // Apply initial tags
    if (options.tags) {
      this.tags = { ...options.tags };
    }

    // Apply initial user
    if (options.user) {
      this.user = options.user;
    }

    this.initialized = true;
  }

  private createTransport(): Transport {
    if (!this.options.apiKey) {
      if (this.options.debug) {
        console.warn("[Bugwatch] No API key provided, SDK is disabled");
      }
      return new NoopTransport();
    }

    return new HttpTransport(this.options);
  }

  /**
   * Register an integration
   */
  use(integration: Integration): this {
    this.integrations.push(integration);
    integration.setup(this);
    return this;
  }

  /**
   * Get SDK options
   */
  getOptions(): BugwatchOptions {
    return this.options;
  }

  /**
   * Scrub, run beforeSend, and dispatch an event. Returns event_id or "" if dropped.
   */
  private processAndSend(raw: import("./types").ErrorEvent): string {
    const event = scrubEvent(raw, this.options.sanitize);

    let processedEvent: import("./types").ErrorEvent | null = event;
    if (this.options.beforeSend) {
      try {
        processedEvent = this.options.beforeSend(event);
      } catch (err) {
        if (this.options.debug) {
          console.error("[Bugwatch] beforeSend threw an error:", err);
        }
        processedEvent = event;
      }
    }

    if (!processedEvent) {
      if (this.options.debug) {
        console.log("[Bugwatch] Event dropped by beforeSend");
      }
      try {
        this.options.onDropped?.(event.event_id, "before_send");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    this.transport.send(processedEvent).catch((err) => {
      if (this.options.debug) console.error("[Bugwatch] transport.send failed:", err);
      try {
        this.options.onDropped?.(processedEvent.event_id, "network_error");
      } catch (e) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", e);
      }
    });

    return processedEvent.event_id;
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: Partial<ErrorEvent>): string {
    if (!this.initialized) {
      return "";
    }

    // Generate event ID upfront so all drop reasons (including pre-creation) report a real ID
    const earlyEventId = generateEventId();

    // Sample rate check
    if (Math.random() > (this.options.sampleRate || 1.0)) {
      if (this.options.debug) console.log("[Bugwatch] Error dropped: sample_rate");
      try {
        this.options.onDropped?.(earlyEventId, "sample_rate");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    // Check ignore patterns
    if (this.shouldIgnoreError(error)) {
      if (this.options.debug) console.log(`[Bugwatch] Error dropped: ignored (message: "${error.message}")`);
      try {
        this.options.onDropped?.(earlyEventId, "ignored");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    // Auto-filter known browser noise (pre-creation, cheap path)
    if (this.options.filterBrowserNoise && isBrowserNoise(error)) {
      if (this.options.debug) console.log(`[Bugwatch] Error dropped: browser_noise (message: "${error.message}")`);
      try {
        this.options.onDropped?.(earlyEventId, "browser_noise");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    const event = this.createEventFromError(error, context);
    const filenames = event.exception?.stacktrace.map((f) => f.filename) ?? [];
    // Extract source URL for URL-based filtering. Strip from event.extra so it
    // is never sent to the server (internal SDK field, not user data).
    const rawSourceUrl = context?.extra?.__sourceUrl;
    const sourceUrl = typeof rawSourceUrl === "string" && rawSourceUrl.length > 0 ? rawSourceUrl : undefined;
    if (event.extra && "__sourceUrl" in event.extra) {
      delete event.extra.__sourceUrl;
    }

    // Drop errors from denied script URLs
    if (this.options.denyUrls && shouldDenyUrl(filenames, sourceUrl, this.options.denyUrls)) {
      if (this.options.debug)
        console.log(`[Bugwatch] Error dropped: deny_url (source: "${sourceUrl ?? filenames[0] ?? "(unknown)"}")`);
      try {
        this.options.onDropped?.(event.event_id, "deny_url");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    // Drop errors not matching the allowed URL whitelist
    if (this.options.allowUrls && !shouldAllowUrl(filenames, sourceUrl, this.options.allowUrls)) {
      if (this.options.debug)
        console.log(
          `[Bugwatch] Error dropped: allow_url (no frame matched allowUrls; stackless errors always pass through)`
        );
      try {
        this.options.onDropped?.(event.event_id, "allow_url");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    // Drop events below minimum level
    if (this.options.minLevel && shouldDropByLevel(event.level, this.options.minLevel)) {
      if (this.options.debug)
        console.log(`[Bugwatch] Error dropped: min_level (level "${event.level}" below "${this.options.minLevel}")`);
      try {
        this.options.onDropped?.(event.event_id, "min_level");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    // Client-side session rate limit (checked last so counter only ticks for real sends)
    if (this.options.maxErrorsPerSession) {
      if (sessionErrorCounter.isLimitReached(this.options.maxErrorsPerSession)) {
        if (this.options.debug)
          console.log(`[Bugwatch] Error dropped: session_rate_limit (limit: ${this.options.maxErrorsPerSession})`);
        try {
          this.options.onDropped?.(event.event_id, "session_rate_limit");
        } catch (err) {
          if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
        }
        return "";
      }
      sessionErrorCounter.increment();
    }

    return this.processAndSend(event);
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, level: ErrorEvent["level"] = "info"): string {
    if (!this.initialized) {
      return "";
    }

    // Sample rate check (consistent with captureException)
    if (Math.random() > (this.options.sampleRate || 1.0)) {
      if (this.options.debug) console.log("[Bugwatch] Message dropped: sample_rate");
      try {
        this.options.onDropped?.(generateEventId(), "sample_rate");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    // Drop messages below minimum level (pre-creation — level is known from arg,
    // so we can check before event creation unlike captureException)
    if (this.options.minLevel && shouldDropByLevel(level, this.options.minLevel)) {
      if (this.options.debug)
        console.log(`[Bugwatch] Message dropped: min_level (level "${level}" below "${this.options.minLevel}")`);
      try {
        this.options.onDropped?.("", "min_level");
      } catch (err) {
        if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
      }
      return "";
    }

    const event = this.createEvent({ message, level });

    // Client-side session rate limit (shared counter with captureException)
    if (this.options.maxErrorsPerSession) {
      if (sessionErrorCounter.isLimitReached(this.options.maxErrorsPerSession)) {
        if (this.options.debug)
          console.log(`[Bugwatch] Message dropped: session_rate_limit (limit: ${this.options.maxErrorsPerSession})`);
        try {
          this.options.onDropped?.(event.event_id, "session_rate_limit");
        } catch (err) {
          if (this.options.debug) console.error("[Bugwatch] onDropped callback threw:", err);
        }
        return "";
      }
      sessionErrorCounter.increment();
    }

    return this.processAndSend(event);
  }

  /**
   * Add a breadcrumb
   */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
    let crumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: new Date().toISOString(),
    };

    // Run beforeBreadcrumb hook with error handling — return null to drop
    if (this.options.beforeBreadcrumb) {
      try {
        const result = this.options.beforeBreadcrumb(crumb);
        if (result === null) {
          if (this.options.debug) {
            console.log("[Bugwatch] Breadcrumb dropped by beforeBreadcrumb");
          }
          return;
        }
        crumb = result;
      } catch (err) {
        if (this.options.debug) {
          console.error("[Bugwatch] beforeBreadcrumb threw an error:", err);
        }
        // Continue with original crumb if hook throws
      }
    }

    // Ring buffer automatically handles max size
    this.breadcrumbs.push(crumb);
  }

  /**
   * Set user context
   */
  setUser(user: UserContext | null): void {
    this.user = user;
  }

  /**
   * Set a tag
   */
  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  /**
   * Set extra context
   */
  setExtra(key: string, value: unknown): void {
    this.extra[key] = value;
  }

  /**
   * Set session ID for linking events to session replay recordings
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Clear breadcrumbs
   */
  clearBreadcrumbs(): void {
    this.breadcrumbs.clear();
  }

  /**
   * Create an event from an Error object
   */
  private createEventFromError(error: Error, context?: Partial<ErrorEvent>): ErrorEvent {
    const { type, value } = extractErrorInfo(error);
    const stacktrace = parseStackTrace(error);

    const exception: ExceptionInfo = {
      type,
      value,
      stacktrace,
    };

    return this.createEvent({
      level: "error",
      message: `${type}: ${value}`,
      exception,
      ...context,
    });
  }

  /**
   * Create a base event
   */
  private createEvent(partial: Partial<ErrorEvent>): ErrorEvent {
    // Get merged context from request scope (if available) and global scope
    // Request context takes precedence over global context
    const mergedContext = getMergedContext(this.user, this.tags, this.extra, this.breadcrumbs.toArray());

    // Destructure fields that need merging so ...restPartial doesn't overwrite them
    const { tags: partialTags, extra: partialExtra, breadcrumbs: partialBreadcrumbs, ...restPartial } = partial;

    const event: ErrorEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      platform: this.detectPlatform(),
      level: partial.level || "error",
      message: partial.message || "",
      environment: this.options.environment,
      release: this.options.release,
      ...(this.options.serverName && { server_name: this.options.serverName }),
      ...(this.options.runtime && { runtime: this.options.runtime }),
      tags: { ...mergedContext.tags, ...partialTags },
      extra: { ...mergedContext.extra, ...partialExtra },
      breadcrumbs: partialBreadcrumbs
        ? [...mergedContext.breadcrumbs, ...partialBreadcrumbs]
        : mergedContext.breadcrumbs,
      sdk: {
        name: SDK_NAME,
        version: SDK_VERSION,
      },
      ...restPartial,
    };

    // Add user context (merged context user + partial user)
    if (mergedContext.user || partial.user) {
      event.user = { ...mergedContext.user, ...partial.user };
    }

    // Attach session ID if set (for session replay linking)
    if (this.sessionId) {
      event.session_id = this.sessionId;
    }

    // Generate fingerprint if exception exists (stored top-level so server uses it for grouping)
    if (event.exception) {
      event.fingerprint = fingerprintFromException(event.exception);
    }

    return event;
  }

  /**
   * Check if error should be ignored
   */
  private shouldIgnoreError(error: Error): boolean {
    if (!this.options.ignoreErrors || this.options.ignoreErrors.length === 0) {
      return false;
    }
    const message = error.message || String(error);
    for (const pattern of this.options.ignoreErrors) {
      try {
        if (typeof pattern === "string") {
          if (message.includes(pattern)) return true;
        } else if (pattern.test(message)) {
          return true;
        }
      } catch {
        if (this.options.debug) {
          console.warn("[Bugwatch] ignoreErrors pattern threw — skipping:", pattern);
        }
      }
    }
    return false;
  }

  /**
   * Detect the current platform
   */
  private detectPlatform(): string {
    if (typeof window !== "undefined") {
      return "javascript";
    }
    if (typeof process !== "undefined" && process.versions?.node) {
      return "node";
    }
    if (typeof EdgeRuntime !== "undefined") {
      return "edge";
    }
    return "javascript";
  }

  /**
   * Start a new performance transaction.
   * Call .finish() on the returned Transaction to send it to the server.
   */
  startTransaction(name: string, op: string): Transaction {
    const onFinish = (event: PerformanceEvent) => {
      if (!this.initialized) return;
      if (!this.options.enablePerformance) return;

      // Sample rate check for traces
      const tracesSampleRate = this.options.tracesSampleRate ?? 1.0;
      if (Math.random() > tracesSampleRate) return;

      // Send via transport (sendTransaction is optional on the Transport interface)
      if (this.transport.sendTransaction) {
        this.transport.sendTransaction(event).catch(() => {
          // Errors are logged by transport
        });
      }
    };

    return new Transaction(
      name,
      op,
      onFinish,
      this.options.environment,
      this.options.release,
      this.options.experimentalPerformance === true
    );
  }

  /**
   * Flush any pending events.
   * Call this before process exit to ensure no events are lost.
   */
  async flush(): Promise<void> {
    if (this.transport.flush) {
      await this.transport.flush();
    }
  }

  /**
   * Close the client and release any resources.
   * This flushes any pending events and closes the transport.
   * After calling this method, the client should not be used again.
   */
  async close(): Promise<void> {
    if (this.transport.close) {
      await this.transport.close();
    } else {
      await this.flush();
    }
    this.initialized = false;
  }
}

// Type declaration for edge runtime
declare const EdgeRuntime: string | undefined;
