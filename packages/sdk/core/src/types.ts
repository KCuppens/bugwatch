/**
 * Configuration options for the Bugwatch SDK
 */
export interface BugwatchOptions {
  /** Your project's API key */
  apiKey: string;
  /** API endpoint URL (defaults to https://api.bugwatch.dev) */
  endpoint?: string;
  /** Application environment (e.g., 'production', 'staging') */
  environment?: string;
  /** Application release/version */
  release?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Sample rate for error events (0.0 to 1.0) */
  sampleRate?: number;
  /** Maximum breadcrumbs to capture */
  maxBreadcrumbs?: number;
  /** Tags to attach to all events */
  tags?: Record<string, string>;
  /** User context */
  user?: UserContext;
  /** Before send hook - return null to drop the event */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  /** Before breadcrumb hook - return null to drop the breadcrumb */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb) => Breadcrumb | null;
  /** Patterns to ignore (matches against error message) */
  ignoreErrors?: (string | RegExp)[];
  /**
   * Drop errors where any stack frame filename or the window.onerror source URL
   * matches one of these patterns (substring match for strings, regex test for RegExp).
   * These are script URLs, not the current page URL.
   * Examples: ['gtm.js', 'facebook.net', /doubleclick\.net/i]
   * Use case: suppress ad scripts, Facebook Pixel, Google Tag Manager, Hotjar, etc.
   */
  denyUrls?: (string | RegExp)[];
  /**
   * Only capture errors where at least one stack frame filename or the window.onerror
   * source URL matches one of these patterns (script URLs, not the page URL).
   * Stackless errors (no frames available) are always allowed through to avoid silent
   * blind spots in cross-origin environments. Empty array is equivalent to undefined.
   * IMPORTANT: a typo here silently drops all non-matching errors — use debug:true to verify.
   * Examples: ['myapp.com', /app\.example\.com/i]
   */
  allowUrls?: (string | RegExp)[];
  /**
   * Minimum event level to capture. Events below this level are dropped.
   * Level order (ascending): "debug" < "info" < "warning" < "error" < "fatal".
   * Applies to both captureException and captureMessage. Default: "debug" (capture all).
   */
  minLevel?: "debug" | "info" | "warning" | "error" | "fatal";
  /**
   * When true, automatically drops a curated set of known-useless browser errors
   * (Script error., ResizeObserver loop, AbortError, ChunkLoadError, etc.).
   * Default: false (opt-in).
   */
  filterBrowserNoise?: boolean;
  /**
   * Maximum number of errors to send per browser session. After this limit is
   * reached all subsequent capture calls are dropped. Set to 0 (default) to disable.
   * Resets on page reload. Counts total errors across all types.
   */
  maxErrorsPerSession?: number;
  /**
   * @experimental Performance monitoring is experimental and the API may change.
   * Set `experimentalPerformance: true` to enable.
   */
  enablePerformance?: boolean;
  /**
   * @experimental Opt in to experimental performance monitoring. Without this flag
   * `Transaction.finish()` is a no-op.
   */
  experimentalPerformance?: boolean;
  /** Sample rate for transactions (0.0 to 1.0) */
  tracesSampleRate?: number;
  /** PII scrubbing config — automatically masks sensitive values in events */
  sanitize?: SanitizeOptions;
  /** Offline event queue config — persists events when network is unavailable */
  offline?: OfflineOptions;
  /**
   * Called whenever an event is dropped (rate limited, sampled out, beforeSend returned null, etc.).
   * Use this to monitor SDK health in production — silent drops are the #1 source of "the SDK isn't working" bugs.
   */
  onDropped?: (
    eventId: string,
    reason:
      | "rate_limited"
      | "sample_rate"
      | "not_initialized"
      | "before_send"
      | "network_error"
      | "ignored"
      | "deny_url"
      | "allow_url"
      | "min_level"
      | "browser_noise"
      | "session_rate_limit"
  ) => void;
}

/**
 * PII scrubbing configuration
 */
export interface SanitizeOptions {
  /** Master switch (default: true) */
  enabled?: boolean;
  /** Additional sensitive key substrings to mask (case-insensitive). Merged with defaults. */
  sensitiveKeys?: string[];
  /** If true, also masks email addresses (default: false — many legit error reports include emails) */
  scrubEmails?: boolean;
  /** Additional regex patterns matched against string values */
  customPatterns?: RegExp[];
}

/**
 * Offline event queue configuration
 */
export interface OfflineOptions {
  /** Master switch (default: true in browser, false in Node) */
  enabled?: boolean;
  /** Maximum events to persist (default: 100, oldest evicted) */
  maxEvents?: number;
}

/**
 * User context attached to events
 */
export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

/**
 * Stack frame in an error stack trace
 */
export interface StackFrame {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

/**
 * Exception/error information
 */
export interface ExceptionInfo {
  type: string;
  value: string;
  stacktrace: StackFrame[];
}

/**
 * Breadcrumb for tracking events leading to an error
 */
export interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

/**
 * Request context for HTTP errors
 */
export interface RequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query_string?: string;
  data?: unknown;
}

/**
 * Runtime information
 */
export interface RuntimeInfo {
  name: string;
  version: string;
}

/**
 * SDK information
 */
export interface SdkInfo {
  name: string;
  version: string;
}

/**
 * The main error event payload sent to the API
 */
export interface ErrorEvent {
  /** Event ID (generated by SDK) */
  event_id: string;
  /** Timestamp in ISO format */
  timestamp: string;
  /** Platform identifier */
  platform: string;
  /** Error level */
  level: "fatal" | "error" | "warning" | "info" | "debug";
  /** Error message */
  message: string;
  /** Exception information */
  exception?: ExceptionInfo;
  /** Breadcrumbs */
  breadcrumbs?: Breadcrumb[];
  /** Tags */
  tags?: Record<string, string>;
  /**
   * Extra context data.
   * Note: `__sourceUrl` is a reserved SDK field used internally for URL-based
   * filtering (denyUrls/allowUrls). It is stripped before the event is sent.
   * Do not set it directly in your own context.
   */
  extra?: Record<string, unknown>;
  /** User context */
  user?: UserContext;
  /** Request context */
  request?: RequestContext;
  /** Application environment */
  environment?: string;
  /** Application release */
  release?: string;
  /** Server name / hostname */
  server_name?: string;
  /** SDK information */
  sdk?: SdkInfo;
  /** Runtime information */
  runtime?: RuntimeInfo;
  /** Session ID for linking to session replay */
  session_id?: string;
  /**
   * Pre-computed fingerprint for grouping.
   * When set, the server uses this value instead of re-computing the
   * fingerprint from the exception — allows SDK-side custom grouping without
   * burying the value inside `tags`.
   */
  fingerprint?: string;
}

/**
 * Transport interface for sending events
 */
export interface Transport {
  send(event: ErrorEvent): Promise<void>;
  /**
   * Send a performance transaction event.
   * Optional — transports that don't support performance monitoring can omit this.
   */
  sendTransaction?(event: PerformanceEvent): Promise<void>;
  /**
   * Flush any pending events.
   * Ensures all queued events are sent before the promise resolves.
   */
  flush?(): Promise<void>;
  /**
   * Close the transport and release any resources.
   * After calling this method, the transport should not be used again.
   */
  close?(): Promise<void>;
}

/**
 * Integration interface for platform-specific functionality
 */
export interface Integration {
  name: string;
  setup(client: BugwatchClient): void;
}

/**
 * Bugwatch client interface
 */
export interface BugwatchClient {
  captureException(error: Error, context?: Partial<ErrorEvent>): string;
  captureMessage(message: string, level?: ErrorEvent["level"]): string;
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void;
  setUser(user: UserContext | null): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
  getOptions(): BugwatchOptions;
  /**
   * Flush any pending events.
   * Call this before process exit to ensure no events are lost.
   */
  flush(): Promise<void>;
  /**
   * Close the client and release any resources.
   * This flushes any pending events and closes the transport.
   */
  close(): Promise<void>;
}

/**
 * Performance event payload sent to the API
 */
export interface PerformanceEvent {
  transaction_name: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  op: string;
  description?: string;
  status: string;
  duration_ms: number;
  started_at: string;
  finished_at: string;
  environment?: string;
  release?: string;
  tags?: Record<string, string>;
  data?: Record<string, unknown>;
  user_id?: string;
  spans: SpanData[];
}

/**
 * Span data within a performance transaction
 */
export interface SpanData {
  span_id: string;
  parent_span_id?: string;
  op: string;
  description?: string;
  status: string;
  duration_ms: number;
  started_at: string;
  finished_at: string;
  data?: Record<string, unknown>;
}
