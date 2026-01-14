import type {
  BugwatchOptions,
  BugwatchClient,
  ErrorEvent,
  Breadcrumb,
  UserContext,
  Transport,
  Integration,
  ExceptionInfo,
} from "./types";
import { HttpTransport, NoopTransport } from "./transport";
import { parseStackTrace, extractErrorInfo } from "./stacktrace";
import { fingerprintFromException } from "./fingerprint";

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
  private breadcrumbs: Breadcrumb[] = [];
  private tags: Record<string, string> = {};
  private extra: Record<string, unknown> = {};
  private user: UserContext | null = null;
  private integrations: Integration[] = [];
  private initialized = false;

  constructor(options: BugwatchOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.transport = this.createTransport();

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
   * Capture an exception
   */
  captureException(error: Error, context?: Partial<ErrorEvent>): string {
    if (!this.initialized) {
      return "";
    }

    // Sample rate check
    if (Math.random() > (this.options.sampleRate || 1.0)) {
      return "";
    }

    // Check ignore patterns
    if (this.shouldIgnoreError(error)) {
      return "";
    }

    const event = this.createEventFromError(error, context);

    // Run beforeSend hook
    const processedEvent = this.options.beforeSend
      ? this.options.beforeSend(event)
      : event;

    if (!processedEvent) {
      if (this.options.debug) {
        console.log("[Bugwatch] Event dropped by beforeSend");
      }
      return "";
    }

    // Send event asynchronously
    this.transport.send(processedEvent).catch(() => {
      // Errors are logged by transport
    });

    return processedEvent.event_id;
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

    const event = this.createEvent({
      message,
      level,
    });

    // Run beforeSend hook
    const processedEvent = this.options.beforeSend
      ? this.options.beforeSend(event)
      : event;

    if (!processedEvent) {
      return "";
    }

    this.transport.send(processedEvent).catch(() => {
      // Errors are logged by transport
    });

    return processedEvent.event_id;
  }

  /**
   * Add a breadcrumb
   */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
    const crumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: new Date().toISOString(),
    };

    this.breadcrumbs.push(crumb);

    // Limit breadcrumbs
    const max = this.options.maxBreadcrumbs || 100;
    if (this.breadcrumbs.length > max) {
      this.breadcrumbs = this.breadcrumbs.slice(-max);
    }
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
   * Clear breadcrumbs
   */
  clearBreadcrumbs(): void {
    this.breadcrumbs = [];
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
    const event: ErrorEvent = {
      event_id: generateEventId(),
      timestamp: new Date().toISOString(),
      platform: this.detectPlatform(),
      level: partial.level || "error",
      message: partial.message || "",
      environment: this.options.environment,
      release: this.options.release,
      tags: { ...this.tags, ...partial.tags },
      extra: { ...this.extra, ...partial.extra },
      breadcrumbs: [...this.breadcrumbs],
      sdk: {
        name: SDK_NAME,
        version: SDK_VERSION,
      },
      ...partial,
    };

    // Add user context
    if (this.user || partial.user) {
      event.user = { ...this.user, ...partial.user };
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
}

// Type declaration for edge runtime
declare const EdgeRuntime: string | undefined;
