import type { ErrorEvent, Transport, BugwatchOptions } from "./types";

const DEFAULT_ENDPOINT = "https://api.bugwatch.dev";

/**
 * HTTP transport for sending events to the Bugwatch API
 */
export class HttpTransport implements Transport {
  private endpoint: string;
  private apiKey: string;
  private debug: boolean;

  constructor(options: BugwatchOptions) {
    this.endpoint = options.endpoint || DEFAULT_ENDPOINT;
    this.apiKey = options.apiKey;
    this.debug = options.debug || false;
  }

  async send(event: ErrorEvent): Promise<void> {
    const url = `${this.endpoint}/api/v1/events`;

    if (this.debug) {
      console.log("[Bugwatch] Sending event:", event.event_id);
    }

    try {
      const response = await this.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
          "X-Bugwatch-SDK": event.sdk?.name || "bugwatch-core",
          "X-Bugwatch-SDK-Version": event.sdk?.version || "0.1.0",
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (this.debug) {
          console.error("[Bugwatch] Failed to send event:", response.status, errorText);
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          if (this.debug) {
            console.warn(`[Bugwatch] Rate limited. Retry after ${retryAfter}s`);
          }
        }

        throw new Error(`Failed to send event: ${response.status}`);
      }

      if (this.debug) {
        console.log("[Bugwatch] Event sent successfully:", event.event_id);
      }
    } catch (error) {
      if (this.debug) {
        console.error("[Bugwatch] Transport error:", error);
      }
      // Don't throw - we don't want SDK errors to break the application
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
    console.log("[Bugwatch Event]", JSON.stringify(event, null, 2));
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
      return;
    }

    const events = this.queue.splice(0, this.maxBatchSize);

    // Send events in parallel
    await Promise.all(events.map((event) => this.transport.send(event)));
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
}
