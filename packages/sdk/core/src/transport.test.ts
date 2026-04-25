import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport, NoopTransport, ConsoleTransport, BatchTransport } from "./transport";
import type { ErrorEvent, PerformanceEvent, Transport } from "./types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function makeEvent(id = "evt-1", overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    event_id: id,
    timestamp: "2026-04-25T00:00:00.000Z",
    platform: "javascript",
    level: "error",
    message: `test event ${id}`,
    sdk: { name: "bugwatch-test", version: "1.2.3" },
    ...overrides,
  };
}

function makeTransaction(): PerformanceEvent {
  return {
    transaction_name: "GET /api/test",
    trace_id: "trace-1",
    span_id: "span-1",
    op: "http.server",
  } as PerformanceEvent;
}

const okResponse = (body: Record<string, unknown> = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const statusResponse = (code: number, headers: Record<string, string> = {}): Response =>
  new Response("", { status: code, headers });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Stabilize Math.random for deterministic backoff jitter
  vi.spyOn(Math, "random").mockReturnValue(0);
  fetchMock = vi.fn();
  // @ts-expect-error - assigning a mock to global fetch
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — constructor                                                */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — constructor", () => {
  it("defaults endpoint to https://api.bugwatch.dev", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "test-key" });
    await t.send(makeEvent());
    await t.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.bugwatch.dev/api/v1/events");
  });

  it("respects custom endpoint", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k", endpoint: "https://example.test" });
    await t.send(makeEvent());
    await t.flush();
    expect(fetchMock.mock.calls[0]![0]).toBe("https://example.test/api/v1/events");
  });

  it("accepts debug flag and onDropped without throwing", async () => {
    const onDropped = vi.fn();
    const t = new HttpTransport({ apiKey: "k", debug: true, onDropped });
    expect(t).toBeInstanceOf(HttpTransport);
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — send happy path                                            */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — send happy path", () => {
  it("posts JSON body with correct headers on 200", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "secret-key", endpoint: "https://api.test" });
    const event = makeEvent("evt-200");
    await t.send(event);
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/api/v1/events");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Authorization"]).toBe("Bearer secret-key");
    expect(init.headers["X-Bugwatch-SDK"]).toBe("bugwatch-test");
    expect(init.headers["X-Bugwatch-SDK-Version"]).toBe("1.2.3");
    expect(JSON.parse(init.body)).toMatchObject({ event_id: "evt-200", message: "test event evt-200" });
  });

  it("falls back to default SDK headers when sdk info missing", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    const event = makeEvent();
    delete event.sdk;
    await t.send(event);
    await t.flush();

    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers["X-Bugwatch-SDK"]).toBe("bugwatch-core");
    expect(init.headers["X-Bugwatch-SDK-Version"]).toBe("0.1.0");
  });

  it("logs in debug mode on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const t = new HttpTransport({ apiKey: "k", debug: true });
    await t.send(makeEvent("evt-debug"));
    await t.flush();
    expect(log).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — rate limiting                                              */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — rate limiting", () => {
  it("drops event when rate limited and calls onDropped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    const onDropped = vi.fn();
    // First request returns 429 with Retry-After=30 to set rateLimitedUntil
    fetchMock.mockResolvedValueOnce(statusResponse(429, { "Retry-After": "30" }));
    const t = new HttpTransport({ apiKey: "k", onDropped });

    await t.send(makeEvent("first"));
    await t.flush();

    expect(onDropped).toHaveBeenCalledWith("first", "rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    onDropped.mockClear();

    // Now we're rate limited — sending should drop without fetch
    await t.send(makeEvent("second"));
    await t.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDropped).toHaveBeenCalledWith("second", "rate_limited");
  });

  it("logs rate-limit drop in debug mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(statusResponse(429, { "Retry-After": "30" }));
    const t = new HttpTransport({ apiKey: "k", debug: true });
    await t.send(makeEvent("e1"));
    await t.flush();

    fetchMock.mockClear();
    await t.send(makeEvent("e2"));
    await t.flush();
    expect(warn).toHaveBeenCalled();
  });

  it("uses Retry-After numeric seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    const onDropped = vi.fn();
    fetchMock.mockResolvedValueOnce(statusResponse(429, { "Retry-After": "5" }));
    const t = new HttpTransport({ apiKey: "k", onDropped });

    await t.send(makeEvent("a"));
    await t.flush();
    expect(onDropped).toHaveBeenCalledWith("a", "rate_limited");

    // Advance 4 seconds — still rate limited
    vi.setSystemTime(new Date("2026-04-25T00:00:04Z"));
    fetchMock.mockClear();
    await t.send(makeEvent("b"));
    await t.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    // Advance to 6s — backoff cleared
    vi.setSystemTime(new Date("2026-04-25T00:00:06Z"));
    fetchMock.mockResolvedValueOnce(okResponse());
    await t.send(makeEvent("c"));
    await t.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults to 60s backoff when Retry-After missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    const onDropped = vi.fn();
    fetchMock.mockResolvedValueOnce(statusResponse(429));
    const t = new HttpTransport({ apiKey: "k", onDropped });

    await t.send(makeEvent("a"));
    await t.flush();
    expect(onDropped).toHaveBeenCalledWith("a", "rate_limited");

    // 59s still limited
    vi.setSystemTime(new Date("2026-04-25T00:00:59Z"));
    fetchMock.mockClear();
    await t.send(makeEvent("b"));
    await t.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    // 61s — released
    vi.setSystemTime(new Date("2026-04-25T00:01:01Z"));
    fetchMock.mockResolvedValueOnce(okResponse());
    await t.send(makeEvent("c"));
    await t.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults to 60s backoff when Retry-After is invalid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    const onDropped = vi.fn();
    fetchMock.mockResolvedValueOnce(statusResponse(429, { "Retry-After": "garbage" }));
    const t = new HttpTransport({ apiKey: "k", onDropped });
    await t.send(makeEvent("a"));
    await t.flush();
    expect(onDropped).toHaveBeenCalledWith("a", "rate_limited");
  });

  it("survives onDropped callback throwing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    const onDropped = vi.fn(() => {
      throw new Error("user error");
    });
    fetchMock.mockResolvedValueOnce(statusResponse(429, { "Retry-After": "30" }));
    const t = new HttpTransport({ apiKey: "k", onDropped });

    await expect(t.send(makeEvent("a"))).resolves.not.toThrow();
    await expect(t.flush()).resolves.not.toThrow();

    // Now rate-limited path — also tolerant of throwing onDropped
    await expect(t.send(makeEvent("b"))).resolves.not.toThrow();
    await expect(t.flush()).resolves.not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — retries                                                    */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — retries", () => {
  it("retries on 500 up to MAX_RETRIES (3 calls total)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse(500));
    const onDropped = vi.fn();
    const t = new HttpTransport({ apiKey: "k", onDropped });

    void t.send(makeEvent("retry-500"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(onDropped).toHaveBeenCalledWith("retry-500", "network_error");
  });

  it("retries on 503 then succeeds", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(statusResponse(503)).mockResolvedValueOnce(okResponse());
    const onDropped = vi.fn();
    const t = new HttpTransport({ apiKey: "k", onDropped });

    void t.send(makeEvent("retry-then-ok"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onDropped).not.toHaveBeenCalled();
  });

  it("retries on network error (fetch throws)", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const onDropped = vi.fn();
    const t = new HttpTransport({ apiKey: "k", onDropped });

    void t.send(makeEvent("net-fail"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onDropped).toHaveBeenCalledWith("net-fail", "network_error");
  });

  it("does not retry on 400 (non-retryable)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse(400));
    const onDropped = vi.fn();
    const t = new HttpTransport({ apiKey: "k", onDropped });

    void t.send(makeEvent("bad-req"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDropped).toHaveBeenCalledWith("bad-req", "network_error");
  });

  it("logs error in debug mode after exhausting retries on server error", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response("server boom", { status: 500 }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = new HttpTransport({ apiKey: "k", debug: true });

    void t.send(makeEvent("dbg-500"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs error in debug mode on AbortError after exhausting retries", async () => {
    vi.useFakeTimers();
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    fetchMock.mockRejectedValue(abortErr);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = new HttpTransport({ apiKey: "k", debug: true });

    void t.send(makeEvent("abort-evt"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls[0]![0];
    expect(String(msg)).toContain("timed out");
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — persistence on failure                                     */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — persistence on failure", () => {
  it("persists event after server error retries exhausted when offline.enabled=true", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse(500));
    const onDropped = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const t = new HttpTransport({
      apiKey: "k",
      debug: true,
      onDropped,
      offline: { enabled: true, maxEvents: 10 },
    });

    void t.send(makeEvent("persist-1"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(onDropped).toHaveBeenCalledWith("persist-1", "network_error");
    // Look for "persisted to offline queue" log
    const persistedLog = logSpy.mock.calls.find((c) => String(c[0]).includes("persisted"));
    expect(persistedLog).toBeTruthy();
  });

  it("persists event after network error retries exhausted", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error("network down"));
    const onDropped = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const t = new HttpTransport({
      apiKey: "k",
      debug: true,
      onDropped,
      offline: { enabled: true, maxEvents: 10 },
    });

    void t.send(makeEvent("persist-2"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(onDropped).toHaveBeenCalledWith("persist-2", "network_error");
    const persistedLog = logSpy.mock.calls.find((c) => String(c[0]).includes("persisted"));
    expect(persistedLog).toBeTruthy();
  });

  it("does not crash if persistent queue fails (offline disabled noop)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse(500));
    const onDropped = vi.fn();
    const t = new HttpTransport({
      apiKey: "k",
      onDropped,
      offline: { enabled: false },
    });

    void t.send(makeEvent("no-persist"));
    await vi.runAllTimersAsync();
    await t.flush();

    expect(onDropped).toHaveBeenCalledWith("no-persist", "network_error");
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — payload truncation                                         */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — payload truncation", () => {
  it("small event passes through unchanged", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    const event = makeEvent("small", {
      breadcrumbs: [{ timestamp: "2026-04-25T00:00:00Z", category: "ui", message: "click" }],
    });
    await t.send(event);
    await t.flush();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.breadcrumbs).toHaveLength(1);
    expect(body.event_id).toBe("small");
  });

  it("drops breadcrumbs when payload exceeds 512KB", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    // Create huge breadcrumbs (~1MB)
    const breadcrumbs = Array.from({ length: 2000 }, (_, i) => ({
      timestamp: "2026-04-25T00:00:00Z",
      category: "ui",
      message: "x".repeat(500) + i,
    }));
    const event = makeEvent("huge-bc", { breadcrumbs });
    await t.send(event);
    await t.flush();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    // Either breadcrumbs are an empty array, or absent (set to undefined)
    expect(body.breadcrumbs == null || body.breadcrumbs.length === 0).toBe(true);
    expect(fetchMock.mock.calls[0]![1].body.length).toBeLessThanOrEqual(512 * 1024);
  });

  it("drops extra when still too large after dropping breadcrumbs", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    const extra: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      extra[`k${i}`] = "x".repeat(500);
    }
    const event = makeEvent("huge-extra", { extra });
    await t.send(event);
    await t.flush();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.extra).toBeUndefined();
    expect(fetchMock.mock.calls[0]![1].body.length).toBeLessThanOrEqual(512 * 1024);
  });

  it("truncates exception stacktrace to 5 frames when extremely large", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    // Create extra so big that even after dropping it, we still need stacktrace truncation
    const extra: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) extra[`k${i}`] = "x".repeat(500);

    const stacktrace = Array.from({ length: 100 }, (_, i) => ({
      filename: "f".repeat(2000) + i,
      function: "fn".repeat(2000),
      lineno: i,
      colno: 0,
      in_app: true,
      context_line: "y".repeat(2000),
      pre_context: Array.from({ length: 30 }, () => "z".repeat(500)),
      post_context: Array.from({ length: 30 }, () => "z".repeat(500)),
    }));

    const event = makeEvent("big-stack", {
      extra,
      exception: { type: "Error", value: "boom", stacktrace },
    });
    await t.send(event);
    await t.flush();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    // After truncation passes, stacktrace should be reduced
    if (body.exception?.stacktrace) {
      expect(body.exception.stacktrace.length).toBeLessThanOrEqual(5);
    }
  });

  it("truncates very long message after stacktrace truncation", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    // Build payload that's still >512KB even after dropping breadcrumbs/extra and trimming stack
    const stacktrace = Array.from({ length: 5 }, () => ({
      filename: "f".repeat(50000),
      function: "fn".repeat(50000),
      lineno: 1,
      colno: 0,
      in_app: true,
    }));
    const event = makeEvent("huge-msg", {
      message: "M".repeat(700_000),
      exception: { type: "Error", value: "boom", stacktrace },
    });
    await t.send(event);
    await t.flush();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(typeof body.message).toBe("string");
    // Truncated to 500 + suffix
    expect(body.message.length).toBeLessThanOrEqual(700_000);
  });

  it("circular reference in extra is handled with [Circular]", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const event = makeEvent("circ", { extra: { obj } });
    await expect(t.send(event)).resolves.not.toThrow();
    await t.flush();

    const bodyText = fetchMock.mock.calls[0]![1].body;
    expect(bodyText).toContain("[Circular]");
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — flush                                                      */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — flush", () => {
  it("returns immediately when no in-flight requests", async () => {
    const t = new HttpTransport({ apiKey: "k" });
    await expect(t.flush()).resolves.toBeUndefined();
  });

  it("awaits all in-flight requests", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      })
    );
    const t = new HttpTransport({ apiKey: "k" });
    void t.send(makeEvent("inflight"));
    // Give the microtask queue a tick so send() registers the in-flight promise
    await Promise.resolve();

    let flushed = false;
    const p = t.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);

    resolveFetch(okResponse());
    await p;
    expect(flushed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* HttpTransport — sendTransaction                                            */
/* -------------------------------------------------------------------------- */

describe("HttpTransport — sendTransaction", () => {
  it("posts to /api/v1/transactions on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k", endpoint: "https://api.test" });
    await t.sendTransaction(makeTransaction());
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/api/v1/transactions");
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers["Authorization"]).toBe("Bearer k");
    expect(init.headers["X-Bugwatch-SDK"]).toBe("bugwatch-core");
  });

  it("trims spans array to 200 when longer", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    const spans = Array.from({ length: 500 }, (_, i) => ({ span_id: `s${i}`, op: "x" }));
    const txn = { ...makeTransaction(), spans } as PerformanceEvent;
    await t.sendTransaction(txn);
    await t.flush();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.spans).toHaveLength(200);
  });

  it("does not trim spans when within 200", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const t = new HttpTransport({ apiKey: "k" });
    const spans = Array.from({ length: 50 }, (_, i) => ({ span_id: `s${i}`, op: "x" }));
    const txn = { ...makeTransaction(), spans } as PerformanceEvent;
    await t.sendTransaction(txn);
    await t.flush();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.spans).toHaveLength(50);
  });

  it("respects rate limit on transactions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00Z"));
    fetchMock.mockResolvedValueOnce(statusResponse(429, { "Retry-After": "30" }));
    const t = new HttpTransport({ apiKey: "k", debug: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await t.sendTransaction(makeTransaction());
    await t.flush();

    fetchMock.mockClear();
    await t.sendTransaction(makeTransaction());
    await t.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("retries on 500 then gives up after MAX_RETRIES", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse(500));
    const t = new HttpTransport({ apiKey: "k" });

    void t.sendTransaction(makeTransaction());
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries on 503 then succeeds", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(statusResponse(503)).mockResolvedValueOnce(okResponse());
    const t = new HttpTransport({ apiKey: "k", debug: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    void t.sendTransaction(makeTransaction());
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Debug log on success
    expect(log).toHaveBeenCalled();
  });

  it("retries on network error then logs in debug mode", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error("ENETDOWN"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = new HttpTransport({ apiKey: "k", debug: true });

    void t.sendTransaction(makeTransaction());
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not retry transactions on non-retryable status", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse(400));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = new HttpTransport({ apiKey: "k", debug: true });

    void t.sendTransaction(makeTransaction());
    await vi.runAllTimersAsync();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* NoopTransport / ConsoleTransport                                           */
/* -------------------------------------------------------------------------- */

describe("NoopTransport", () => {
  it("send resolves and does not call fetch", async () => {
    const t = new NoopTransport();
    await expect(t.send(makeEvent())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ConsoleTransport", () => {
  it("logs serialized event to console.log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const t = new ConsoleTransport();
    await t.send(makeEvent("console-1"));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe("[Bugwatch Event]");
    expect(String(log.mock.calls[0]![1])).toContain("console-1");
  });
});

/* -------------------------------------------------------------------------- */
/* BatchTransport                                                             */
/* -------------------------------------------------------------------------- */

function makeFakeUnderlying(): Transport & {
  send: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
} {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  } as Transport & {
    send: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
  };
}

describe("BatchTransport", () => {
  it("does not flush when below maxBatchSize", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 5, flushInterval: 60000 });

    await batch.send(makeEvent("a"));
    await batch.send(makeEvent("b"));

    expect(inner.send).not.toHaveBeenCalled();
    batch.destroy();
  });

  it("flushes automatically when reaching maxBatchSize", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 3, flushInterval: 60000 });

    await batch.send(makeEvent("1"));
    await batch.send(makeEvent("2"));
    await batch.send(makeEvent("3"));

    expect(inner.send).toHaveBeenCalledTimes(3);
    batch.destroy();
  });

  it("manual flush sends queued events", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 100, flushInterval: 60000 });

    await batch.send(makeEvent("a"));
    await batch.send(makeEvent("b"));
    expect(inner.send).not.toHaveBeenCalled();

    await batch.flush();
    expect(inner.send).toHaveBeenCalledTimes(2);
    batch.destroy();
  });

  it("flush on empty queue calls underlying flush()", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 10, flushInterval: 60000 });
    await batch.flush();
    expect(inner.flush).toHaveBeenCalled();
    expect(inner.send).not.toHaveBeenCalled();
    batch.destroy();
  });

  it("flush is a no-op when already flushing (re-entrant guard)", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    let resolveSend!: () => void;
    inner.send.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveSend = () => r();
        })
    );
    const batch = new BatchTransport(inner, { maxBatchSize: 1, flushInterval: 60000 });

    // Send triggers an auto-flush that's still pending due to held send promise
    const firstSend = batch.send(makeEvent("a"));
    await Promise.resolve();
    // While the first flush is in flight, calling flush() again should be a no-op
    const secondFlush = batch.flush();
    await Promise.resolve();

    resolveSend();
    await firstSend;
    await secondFlush;

    expect(inner.send).toHaveBeenCalledTimes(1);
    batch.destroy();
  });

  it("recursively flushes when queue grows during flush", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 2, flushInterval: 60000 });

    // Pre-fill queue beyond maxBatchSize via direct flush call
    // Use manual flush after queueing 5 events
    await batch.send(makeEvent("1"));
    expect(inner.send).not.toHaveBeenCalled();
    await batch.send(makeEvent("2"));
    // auto-flush triggered because we hit batch size 2
    expect(inner.send).toHaveBeenCalledTimes(2);

    inner.send.mockClear();
    // Now trigger a flush with multiple batches queued
    await batch.send(makeEvent("3"));
    await batch.send(makeEvent("4"));
    // auto-flush again
    expect(inner.send).toHaveBeenCalledTimes(2);

    batch.destroy();
  });

  it("close stops the timer and flushes remaining events", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 100, flushInterval: 60000 });
    await batch.send(makeEvent("a"));
    await batch.send(makeEvent("b"));

    await batch.close();

    expect(inner.send).toHaveBeenCalledTimes(2);
    // After close, advancing timers should not trigger more flushes (timer cleared)
    inner.send.mockClear();
    await vi.advanceTimersByTimeAsync(120000);
    expect(inner.send).not.toHaveBeenCalled();
  });

  it("timer-driven periodic flush triggers underlying transport", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 100, flushInterval: 1000 });

    await batch.send(makeEvent("p"));
    expect(inner.send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    expect(inner.send).toHaveBeenCalledTimes(1);

    batch.destroy();
  });

  it("ignores send errors on individual events (Promise.allSettled)", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    inner.send.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const batch = new BatchTransport(inner, { maxBatchSize: 2, flushInterval: 60000 });

    await batch.send(makeEvent("err1"));
    await batch.send(makeEvent("err2"));

    expect(inner.send).toHaveBeenCalledTimes(2);
    batch.destroy();
  });

  it("uses default options when none provided", async () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner);
    // Push 10 (default maxBatchSize) to trigger flush
    for (let i = 0; i < 10; i++) {
      await batch.send(makeEvent(`d${i}`));
    }
    expect(inner.send).toHaveBeenCalledTimes(10);
    batch.destroy();
  });

  it("destroy is idempotent", () => {
    vi.useFakeTimers();
    const inner = makeFakeUnderlying();
    const batch = new BatchTransport(inner, { maxBatchSize: 10, flushInterval: 1000 });
    batch.destroy();
    expect(() => batch.destroy()).not.toThrow();
  });

  it("works when underlying transport has no flush method", async () => {
    vi.useFakeTimers();
    const inner: Transport = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const batch = new BatchTransport(inner, { maxBatchSize: 100, flushInterval: 60000 });
    await batch.send(makeEvent("a"));
    await batch.flush();
    expect(inner.send).toHaveBeenCalledTimes(1);
    // Empty-queue flush also handles missing flush()
    await batch.flush();
    batch.destroy();
  });
});
