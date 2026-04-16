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
      try { this.options.onDropped?.(event.event_id, "before_send"); } catch { /* */ }
      return "";
    }

    this.transport.send(processedEvent).catch(() => {
      // Errors are logged by transport
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

    // Sample rate check
    if (Math.random() > (this.options.sampleRate || 1.0)) {
      try { this.options.onDropped?.("", "sample_rate"); } catch { /* */ }
      return "";
    }

    // Check ignore patterns
    if (this.shouldIgnoreError(error)) {
      return "";
    }

    return this.processAndSend(this.createEventFromError(error, context));
  }

  /**
   * Capture a message
   */
  captureMessage(
    message: string,
    level: ErrorEvent["level"] = "info"
  ): string {
    if (!this.initialized) {
      return "";
    }

    return this.processAndSend(this.createEvent({ message, level }));
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
  private createEventFromError(
    error: Error,
    context?: Partial<ErrorEvent>
  ): ErrorEvent {
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
    const mergedContext = getMergedContext(
      this.user,
      this.tags,
      this.extra,
      this.breadcrumbs.toArray()
    );

    const event: ErrorEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      platform: this.detectPlatform(),
      level: partial.level || "error",
      message: partial.message || "",
      environment: this.options.environment,
      release: this.options.release,
      tags: { ...mergedContext.tags, ...partial.tags },
      extra: { ...mergedContext.extra, ...partial.extra },
      breadcrumbs: mergedContext.breadcrumbs,
      sdk: {
        name: SDK_NAME,
        version: SDK_VERSION,
      },
      ...partial,
    };

    // Add user context (merged context user + partial user)
    if (mergedContext.user || partial.user) {
      event.user = { ...mergedContext.user, ...partial.user };
    }

    // Attach session ID if set (for session replay linking)
    if (this.sessionId) {
      event.session_id = this.sessionId;
    }

    // Generate fingerprint if exception exists
    if (event.exception) {
      const fingerprint = fingerprintFromException(event.exception);
      event.tags = { ...event.tags, fingerprint };
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
      if (typeof pattern === "string") {
        if (message.includes(pattern)) {
          return true;
        }
      } else if (pattern instanceof RegExp) {
        if (pattern.test(message)) {
          return true;
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
      this.options.experimentalPerformance === true,
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
