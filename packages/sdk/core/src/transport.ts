import type { ErrorEvent, PerformanceEvent, Transport, BugwatchOptions } from "./types";
import { createPersistentQueue, type PersistentQueue } from "./persistent-queue";

const DEFAULT_ENDPOINT = "https://api.bugwatch.dev";
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;
const DRAIN_RATE_DELAY_MS = 200; // 5 events/sec on drain to avoid thundering herd

/**
 * Safely serialize a value to JSON, handling circular references.
 */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) {
        return "[Circular]";
      }
      seen.add(val);
    }
    return val;
  });
}

/**
 * Truncate an event's breadcrumbs and extra data to fit within size limits.
 * Returns the serialized JSON string.
 */
function serializeWithTruncation(event: ErrorEvent): string {
  let json = safeJsonStringify(event);

  if (json.length <= MAX_PAYLOAD_BYTES) {
    return json;
  }

  // First pass: drop breadcrumbs progressively
  if (event.breadcrumbs && event.breadcrumbs.length > 0) {
    const truncated = { ...event, breadcrumbs: [] as typeof event.breadcrumbs };
    json = safeJsonStringify(truncated);

    if (json.length <= MAX_PAYLOAD_BYTES) {
      return json;
    }
  }

  // Second pass: drop extra data and breadcrumbs
  const stripped = { ...event, breadcrumbs: undefined, extra: undefined };
  json = safeJsonStringify(stripped);

  if (json.length <= MAX_PAYLOAD_BYTES) {
    return json;
  }

  // Third pass: truncate exception stacktrace
  if (stripped.exception?.stacktrace && stripped.exception.stacktrace.length > 5) {
    stripped.exception = {
      ...stripped.exception,
      stacktrace: stripped.exception.stacktrace.slice(0, 5),
    };
    json = safeJsonStringify(stripped);
  }

  // Final pass: truncate message if still too large
  if (json.length > MAX_PAYLOAD_BYTES && stripped.message && stripped.message.length > 500) {
    stripped.message = stripped.message.slice(0, 500) + "...(truncated)";
    json = safeJsonStringify(stripped);
  }

  return json;
}

/**
 * Check if an HTTP status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * HTTP transport for sending events to the Bugwatch API
 */
export class HttpTransport implements Transport {
  private endpoint: string;
  private apiKey: string;
  private debug: boolean;
  private timeoutMs: number;
  private inFlightRequests: Set<Promise<void>> = new Set();
  private rateLimitedUntil: number = 0;
  private persistentQueue: PersistentQueue;
  private drainPromise: Promise<void> | null = null;
  private onDropped?: BugwatchOptions["onDropped"];

  constructor(options: BugwatchOptions) {
    this.endpoint = options.endpoint || DEFAULT_ENDPOINT;
    this.apiKey = options.apiKey;
    this.debug = options.debug || false;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
    this.onDropped = options.onDropped;
    this.persistentQueue = createPersistentQueue(options.offline);
    // Drain on init — fire and forget. Failures are silent.
    this.drainPersistentQueue();
  }

  /**
   * Drain queued events from previous sessions / network outages.
   * Rate-limited to avoid thundering herd on a freshly recovered connection.
   */
  private drainPersistentQueue(): void {
    if (this.drainPromise) return;
    this.drainPromise = (async () => {
      try {
        const events = await this.persistentQueue.drain();
        if (events.length === 0) return;
        if (this.debug) {
          console.log(`[Bugwatch] Draining ${events.length} queued event(s)`);
        }
        for (const event of events) {
          // Re-send via the standard path, but skip persistent queue on failure
          // to avoid an infinite re-queue loop.
          await this.sendWithRetry(event, 0, /* persistOnFailure */ false).catch(() => undefined);
          await new Promise((r) => setTimeout(r, DRAIN_RATE_DELAY_MS));
        }
      } finally {
        this.drainPromise = null;
      }
    })();
  }

  async send(event: ErrorEvent): Promise<void> {
    // Respect rate limit backoff
    if (Date.now() < this.rateLimitedUntil) {
      if (this.debug) {
        console.warn("[Bugwatch] Rate limited, dropping event:", event.event_id);
      }
      return;
    }

    // Wrap in a new promise so we can add it to the Set synchronously
    // before any async work starts, preventing a race with flush().
    let resolve!: () => void;
    const tracked = new Promise<void>((r) => { resolve = r; });
    this.inFlightRequests.add(tracked);
    this.sendWithRetry(event).finally(() => {
      this.inFlightRequests.delete(tracked);
      resolve();
    });
  }

  private async sendWithRetry(event: ErrorEvent, attempt = 0, persistOnFailure = true): Promise<void> {
    const url = `${this.endpoint}/api/v1/events`;

    if (this.debug && attempt === 0) {
      console.log("[Bugwatch] Sending event:", event.event_id);
    }

    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;

      try {
        const body = serializeWithTruncation(event);

        const response = await this.fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
            "X-Bugwatch-SDK": event.sdk?.name || "bugwatch-core",
            "X-Bugwatch-SDK-Version": event.sdk?.version || "0.1.0",
          },
          body,
          ...(controller && { signal: controller.signal }),
        });

        if (!response.ok) {
          // Handle rate limiting with backoff
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
            const backoffMs = !isNaN(parsed) && parsed > 0
              ? parsed * 1000
              : 60_000;
            this.rateLimitedUntil = Date.now() + backoffMs;

            if (this.debug) {
              console.warn(`[Bugwatch] Rate limited. Backing off for ${backoffMs}ms`);
            }
            return; // Drop event, don't retry during rate limit
          }

          if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return this.sendWithRetry(event, attempt + 1);
          }

          if (this.debug) {
            const errorText = await response.text().catch(() => "");
            console.error("[Bugwatch] Failed to send event:", response.status, errorText);
          }
          return;
        }

        if (this.debug) {
          console.log("[Bugwatch] Event sent successfully:", event.event_id);
        }
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      // Retry on network errors (timeout, connection refused, etc.)
      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendWithRetry(event, attempt + 1, persistOnFailure);
      }

      if (this.debug) {
        const message = error instanceof Error && error.name === "AbortError"
          ? `[Bugwatch] Request timed out after ${this.timeoutMs}ms`
          : "[Bugwatch] Transport error:";
        console.error(message, error);
      }

      // Network failure after all retries — persist for next session if enabled
      if (persistOnFailure) {
        try {
          const ok = await this.persistentQueue.enqueue(event);
          if (ok && this.debug) {
            console.log("[Bugwatch] Event persisted to offline queue:", event.event_id);
          }
        } catch {
          // Queue itself failed — silent drop, never crash the host app
        }
      }
      // Don't throw - we don't want SDK errors to break the application
    }
  }

  /**
   * Send a performance transaction to the API.
   */
  async sendTransaction(event: PerformanceEvent): Promise<void> {
    if (Date.now() < this.rateLimitedUntil) {
      if (this.debug) {
        console.warn("[Bugwatch] Rate limited, dropping transaction:", event.transaction_name);
      }
      return;
    }

    const promise = (async () => {
      const url = `${this.endpoint}/api/v1/transactions`;

      if (this.debug) {
        console.log("[Bugwatch] Sending transaction:", event.transaction_name);
      }

      try {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller
          ? setTimeout(() => controller.abort(), this.timeoutMs)
          : null;

        try {
          const response = await this.fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${this.apiKey}`,
              "X-Bugwatch-SDK": "bugwatch-core",
            },
            body: JSON.stringify(event),
            ...(controller && { signal: controller.signal }),
          });

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get("Retry-After");
              const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
              const backoffMs = !isNaN(parsed) && parsed > 0 ? parsed * 1000 : 60_000;
              this.rateLimitedUntil = Date.now() + backoffMs;
            }
            if (this.debug) {
              console.error("[Bugwatch] Failed to send transaction:", response.status);
            }
            return;
          }

          if (this.debug) {
            console.log("[Bugwatch] Transaction sent successfully:", event.transaction_name);
          }
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
        }
      } catch (error) {
        if (this.debug) {
          console.error("[Bugwatch] Transport error sending transaction:", error);
        }
      }
    })();
    this.inFlightRequests.add(promise);
    promise.finally(() => this.inFlightRequests.delete(promise));
    await promise;
  }

  /**
   * Wait for all in-flight requests to complete.
   */
  async flush(): Promise<void> {
    if (this.inFlightRequests.size > 0) {
      await Promise.allSettled([...this.inFlightRequests]);
    }
  }

  /**
   * Abstract fetch to support different environments
   */
  private async fetch(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    // Use global fetch (available in Node 18+, browsers, and edge runtimes)
    if (typeof globalThis.fetch === "function") {
      return globalThis.fetch(url, options);
    }

    throw new Error("No fetch implementation available");
  }
}

/**
 * No-op transport for testing or disabled SDK
 */
export class NoopTransport implements Transport {
  async send(_event: ErrorEvent): Promise<void> {
    // Do nothing
  }
}

/**
 * Console transport for development/debugging
 */
export class ConsoleTransport implements Transport {
  async send(event: ErrorEvent): Promise<void> {
    console.log("[Bugwatch Event]", safeJsonStringify(event));
  }
}

/**
 * Batching transport that queues events and sends them in batches
 */
export class BatchTransport implements Transport {
  private transport: Transport;
  private queue: ErrorEvent[] = [];
  private maxBatchSize: number;
  private flushInterval: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    transport: Transport,
    options: { maxBatchSize?: number; flushInterval?: number } = {}
  ) {
    this.transport = transport;
    this.maxBatchSize = options.maxBatchSize || 10;
    this.flushInterval = options.flushInterval || 5000;

    // Start flush timer
    this.startTimer();
  }

  async send(event: ErrorEvent): Promise<void> {
    this.queue.push(event);

    if (this.queue.length >= this.maxBatchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) {
      // Also flush the underlying transport's in-flight requests
      if (this.transport.flush) {
        await this.transport.flush();
      }
      return;
    }

    const events = this.queue.splice(0, this.maxBatchSize);

    // Send events in parallel, don't fail the batch if individual events fail
    await Promise.allSettled(events.map((event) => this.transport.send(event)));

    // If there are still events in the queue, flush recursively
    if (this.queue.length > 0) {
      await this.flush();
    }

    // Wait for underlying transport's in-flight requests
    if (this.transport.flush) {
      await this.transport.flush();
    }
  }

  private startTimer(): void {
    if (typeof setInterval !== "undefined") {
      this.timer = setInterval(() => {
        this.flush().catch(() => {
          // Ignore flush errors
        });
      }, this.flushInterval);

      // Unref timer in Node.js to not block process exit
      if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
        (this.timer as NodeJS.Timeout).unref();
      }
    }
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Close the transport, flushing any remaining events and stopping the timer.
   */
  async close(): Promise<void> {
    this.destroy(); // Stop timer first to prevent new flushes
    await this.flush();
  }
}
