import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { Bugwatch } from "./client";
import { Transaction } from "./performance";
import type { ErrorEvent, Breadcrumb, Integration, BugwatchClient } from "./types";

/**
 * Helper: build a Response-like object compatible with the transport's
 * usage of fetch (.ok, .status, .headers.get, .text()).
 */
function makeOkResponse(): Response {
  return new Response("", { status: 200 });
}

/**
 * Mock globalThis.fetch with a vi.fn that returns 200 OK by default.
 * Returns the mock fn so callers can inspect calls.
 */
function installFetchMock(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(makeOkResponse()));
   
  (globalThis as any).fetch = fn;
  return fn;
}

/**
 * Read the JSON body that was POSTed by the HttpTransport on a particular call.
 */
function getSentEvent(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): ErrorEvent {
  const call = fetchMock.mock.calls[callIndex];
  expect(call, `expected fetch call #${callIndex}`).toBeDefined();
  const init = call![1] as RequestInit;
  return JSON.parse(init.body as string) as ErrorEvent;
}

/**
 * Wait for any pending microtasks / queued sends to resolve.
 */
async function flushMicrotasks(): Promise<void> {
  // A few macrotask hops cover the transport's internal Promise chain.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("Bugwatch client", () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let randomSpy: MockInstance<() => number> | null = null;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default deterministic Math.random — well below sampleRate=1.0 default.
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    randomSpy = null;
     
    (globalThis as any).fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------
  describe("constructor", () => {
    it("merges options with DEFAULT_OPTIONS", () => {
      const client = new Bugwatch({ apiKey: "key" });
      const opts = client.getOptions();
      expect(opts.endpoint).toBe("https://api.bugwatch.dev");
      expect(opts.debug).toBe(false);
      expect(opts.sampleRate).toBe(1.0);
      expect(opts.maxBreadcrumbs).toBe(100);
      expect(opts.environment).toBe("production");
      expect(opts.apiKey).toBe("key");
    });

    it("user-provided options override defaults", () => {
      const client = new Bugwatch({
        apiKey: "k",
        endpoint: "https://example.com",
        environment: "staging",
        debug: true,
      });
      const opts = client.getOptions();
      expect(opts.endpoint).toBe("https://example.com");
      expect(opts.environment).toBe("staging");
      expect(opts.debug).toBe(true);
    });

    it("uses NoopTransport when apiKey is missing (no fetch call)", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "" });
      const id = client.captureMessage("hello");
      expect(id).toBeTruthy();
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("warns to console when apiKey is missing AND debug=true", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
       
      new Bugwatch({ apiKey: "" as any, debug: true });
      expect(warn).toHaveBeenCalled();
    });

    it("applies initial tags", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        tags: { env: "ci", region: "us-east" },
      });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.tags?.env).toBe("ci");
      expect(sent.tags?.region).toBe("us-east");
    });

    it("applies initial user", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        user: { id: "u1", email: "a@b.com" },
      });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.user?.id).toBe("u1");
      // email may be filtered by scrubbing if scrubEmails enabled, but default is off
      expect(sent.user?.email).toBe("a@b.com");
    });

    it("respects custom maxBreadcrumbs ring buffer size", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k", maxBreadcrumbs: 2 });
      client.addBreadcrumb({ category: "a", message: "first" });
      client.addBreadcrumb({ category: "a", message: "second" });
      client.addBreadcrumb({ category: "a", message: "third" });
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs).toBeDefined();
      expect(sent.breadcrumbs!.length).toBe(2);
      expect(sent.breadcrumbs!.map((b) => b.message)).toEqual(["second", "third"]);
    });
  });

  // -------------------------------------------------------------------
  // captureException
  // -------------------------------------------------------------------
  describe("captureException", () => {
    it("returns a non-empty event_id on success", async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      const id = client.captureException(new Error("boom"));
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it('returns "" when not initialized (after close)', async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      await client.close();
      const id = client.captureException(new Error("x"));
      expect(id).toBe("");
    });

    it('returns "" when sampled out and calls onDropped("sample_rate") with a non-empty eventId', async () => {
      const fetchMock = installFetchMock();
      const onDropped = vi.fn();
      // 0.9 > 0.1 → sampled out. We avoid sampleRate=0 because the source
      // uses `sampleRate || 1.0` which treats 0 as "default".
      randomSpy!.mockReturnValue(0.9);
      const client = new Bugwatch({ apiKey: "k", sampleRate: 0.1, onDropped });
      const id = client.captureException(new Error("x"));
      expect(id).toBe("");
      // earlyEventId is now generated upfront so all drops get a real non-empty ID
      expect(onDropped).toHaveBeenCalledWith(expect.any(String), "sample_rate");
      expect(onDropped.mock.calls[0]![0]).not.toBe("");
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not crash if onDropped throws on sample_rate path", () => {
      installFetchMock();
      const onDropped = vi.fn(() => {
        throw new Error("hook bad");
      });
      randomSpy!.mockReturnValue(0.9);
      const client = new Bugwatch({ apiKey: "k", sampleRate: 0.1, onDropped });
      expect(() => client.captureException(new Error("x"))).not.toThrow();
    });

    it("ignores errors matching string ignoreErrors patterns", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        ignoreErrors: ["NetworkError"],
      });
      const id = client.captureException(new Error("NetworkError: down"));
      expect(id).toBe("");
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores errors matching RegExp ignoreErrors patterns", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        ignoreErrors: [/timeout/i],
      });
      const id = client.captureException(new Error("Request TIMEOUT after 5s"));
      expect(id).toBe("");
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does NOT ignore non-matching errors", async () => {
      installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        ignoreErrors: ["ZZZNeverMatches"],
      });
      const id = client.captureException(new Error("totally normal"));
      expect(id).not.toBe("");
    });

    it("works when ignoreErrors is empty / undefined (no-op)", async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k", ignoreErrors: [] });
      const id = client.captureException(new Error("anything"));
      expect(id).not.toBe("");
    });

    it("includes a fingerprint tag when an exception is present", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureException(new Error("fingerprint me"));
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.tags?.fingerprint).toBeDefined();
      expect(typeof sent.tags?.fingerprint).toBe("string");
      expect(sent.tags!.fingerprint!.length).toBeGreaterThan(0);
    });

    it("does NOT include fingerprint tag for plain captureMessage", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.tags?.fingerprint).toBeUndefined();
    });

    it("includes parsed stacktrace on the event exception", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      const err = new Error("with stack");
      client.captureException(err);
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.exception).toBeDefined();
      expect(Array.isArray(sent.exception!.stacktrace)).toBe(true);
    });

    it("context parameter is merged into the event", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureException(new Error("x"), {
        tags: { custom: "yes" },
        extra: { foo: 1 },
      });
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.tags?.custom).toBe("yes");
      expect(sent.extra?.foo).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // captureMessage
  // -------------------------------------------------------------------
  describe("captureMessage", () => {
    it('defaults level to "info"', async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hello");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.level).toBe("info");
    });

    it("respects an explicit level", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("warn me", "warning");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.level).toBe("warning");
    });

    it("returns a non-empty event_id", () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      const id = client.captureMessage("hi");
      expect(id.length).toBeGreaterThan(0);
    });

    it('returns "" when not initialized (after close)', async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      await client.close();
      expect(client.captureMessage("hi")).toBe("");
    });
  });

  // -------------------------------------------------------------------
  // addBreadcrumb / clearBreadcrumbs
  // -------------------------------------------------------------------
  describe("addBreadcrumb / clearBreadcrumbs", () => {
    it("adds a breadcrumb with auto timestamp", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.addBreadcrumb({ category: "ui", message: "clicked" });
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs).toBeDefined();
      expect(sent.breadcrumbs!.length).toBe(1);
      expect(sent.breadcrumbs![0]!.message).toBe("clicked");
      expect(typeof sent.breadcrumbs![0]!.timestamp).toBe("string");
    });

    it("ring buffer evicts oldest beyond maxBreadcrumbs", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k", maxBreadcrumbs: 3 });
      for (let i = 1; i <= 5; i++) {
        client.addBreadcrumb({ category: "x", message: `b${i}` });
      }
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs!.map((b) => b.message)).toEqual(["b3", "b4", "b5"]);
    });

    it("beforeBreadcrumb returning null drops the crumb", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        beforeBreadcrumb: () => null,
      });
      client.addBreadcrumb({ category: "x", message: "drop me" });
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      // breadcrumbs may be [] or undefined on the wire.
      expect(!sent.breadcrumbs || sent.breadcrumbs.length === 0).toBe(true);
    });

    it("beforeBreadcrumb returning a modified crumb is stored", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        beforeBreadcrumb: (b) => ({ ...b, message: "modified!" }),
      });
      client.addBreadcrumb({ category: "x", message: "orig" });
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs![0]!.message).toBe("modified!");
    });

    it("beforeBreadcrumb throwing → original crumb stored, no crash", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        beforeBreadcrumb: () => {
          throw new Error("hook broke");
        },
      });
      expect(() => client.addBreadcrumb({ category: "x", message: "survives" })).not.toThrow();
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs![0]!.message).toBe("survives");
    });

    it("beforeBreadcrumb throwing logs when debug=true", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const client = new Bugwatch({
        apiKey: "k",
        debug: true,
        beforeBreadcrumb: () => {
          throw new Error("boom");
        },
      });
      client.addBreadcrumb({ category: "x", message: "y" });
      expect(errSpy).toHaveBeenCalled();
    });

    it("beforeBreadcrumb returning null logs when debug=true", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = new Bugwatch({
        apiKey: "k",
        debug: true,
        beforeBreadcrumb: () => null,
      });
      client.addBreadcrumb({ category: "x", message: "y" });
      expect(logSpy).toHaveBeenCalled();
    });

    it("clearBreadcrumbs removes all breadcrumbs", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.addBreadcrumb({ category: "x", message: "one" });
      client.addBreadcrumb({ category: "x", message: "two" });
      client.clearBreadcrumbs();
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(!sent.breadcrumbs || sent.breadcrumbs.length === 0).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // setUser / setTag / setExtra / setSessionId
  // -------------------------------------------------------------------
  describe("scope setters", () => {
    it("setUser sets the user on outgoing events", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.setUser({ id: "user-7", username: "kobe" });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.user?.id).toBe("user-7");
      expect(sent.user?.username).toBe("kobe");
    });

    it("setUser(null) clears the user", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        user: { id: "x" },
      });
      client.setUser(null);
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.user).toBeUndefined();
    });

    it("setTag adds a tag to outgoing events", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.setTag("feature", "checkout");
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.tags?.feature).toBe("checkout");
    });

    it("setExtra adds extra context to outgoing events", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.setExtra("orderId", 1234);
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.extra?.orderId).toBe(1234);
    });

    it("setSessionId attaches session_id to outgoing events", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.setSessionId("sess-42");
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.session_id).toBe("sess-42");
    });
  });

  // -------------------------------------------------------------------
  // beforeSend hook
  // -------------------------------------------------------------------
  describe("beforeSend hook", () => {
    it('returning null drops event and calls onDropped("before_send")', async () => {
      const fetchMock = installFetchMock();
      const onDropped = vi.fn();
      const client = new Bugwatch({
        apiKey: "k",
        beforeSend: () => null,
        onDropped,
      });
      const id = client.captureException(new Error("nope"));
      expect(id).toBe("");
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onDropped).toHaveBeenCalledWith(expect.any(String), "before_send");
    });

    it("returning a modified event sends the modified version", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        beforeSend: (e) => ({ ...e, message: "REWRITTEN" }),
      });
      client.captureMessage("orig");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.message).toBe("REWRITTEN");
    });

    it("throwing → original event still sent", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        beforeSend: () => {
          throw new Error("hook bad");
        },
      });
      client.captureMessage("orig");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.message).toBe("orig");
    });

    it("throwing in debug=true logs the error", async () => {
      installFetchMock();
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const client = new Bugwatch({
        apiKey: "k",
        debug: true,
        beforeSend: () => {
          throw new Error("hook bad");
        },
      });
      client.captureMessage("orig");
      await flushMicrotasks();
      expect(errSpy).toHaveBeenCalled();
    });

    it("beforeSend returning null logs in debug mode", async () => {
      installFetchMock();
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = new Bugwatch({
        apiKey: "k",
        debug: true,
        beforeSend: () => null,
      });
      client.captureMessage("nope");
      await flushMicrotasks();
      expect(logSpy).toHaveBeenCalled();
    });

    it("does not crash if onDropped throws in before_send path", () => {
      installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        beforeSend: () => null,
        onDropped: () => {
          throw new Error("downstream broke");
        },
      });
      expect(() => client.captureMessage("x")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // PII scrubbing
  // -------------------------------------------------------------------
  describe("PII scrubbing", () => {
    it("masks sensitive keys in event extras automatically", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        sanitize: { enabled: true },
      });
      client.setExtra("password", "hunter2");
      client.setExtra("benign", "ok");
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      // sensitive key should be masked
      expect(sent.extra?.password).not.toBe("hunter2");
      // benign key should pass through
      expect(sent.extra?.benign).toBe("ok");
    });
  });

  // -------------------------------------------------------------------
  // use() integration registration
  // -------------------------------------------------------------------
  describe("use()", () => {
    it("calls integration.setup(this) and returns this", () => {
      installFetchMock();
      const setup = vi.fn();
      const integration: Integration = { name: "test", setup };
      const client = new Bugwatch({ apiKey: "k" });
      const result = client.use(integration);
      expect(setup).toHaveBeenCalledTimes(1);
      const arg = setup.mock.calls[0]![0] as BugwatchClient;
      expect(arg).toBe(client);
      expect(result).toBe(client);
    });
  });

  // -------------------------------------------------------------------
  // Platform detection (detectPlatform — exercised via captureMessage)
  // -------------------------------------------------------------------
  describe("detectPlatform", () => {
    it("default in Node test environment is 'node'", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.platform).toBe("node");
    });

    it("returns 'javascript' when window is defined", async () => {
      const fetchMock = installFetchMock();
      vi.stubGlobal("window", {});
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.platform).toBe("javascript");
    });
  });

  // -------------------------------------------------------------------
  // Event ID uniqueness
  // -------------------------------------------------------------------
  describe("event_id", () => {
    it("each event gets a unique non-empty id", () => {
      installFetchMock();
      // Restore real Math.random for this test so generateEventId varies.
      randomSpy!.mockRestore();
      const client = new Bugwatch({ apiKey: "k" });
      const ids = new Set<string>();
      for (let i = 0; i < 25; i++) {
        const id = client.captureMessage(`m-${i}`);
        expect(id.length).toBeGreaterThan(0);
        ids.add(id);
      }
      // Allow tiny chance of collision but expect overwhelmingly unique.
      expect(ids.size).toBeGreaterThan(20);
    });
  });

  // -------------------------------------------------------------------
  // startTransaction / performance monitoring
  // -------------------------------------------------------------------
  describe("startTransaction", () => {
    it("returns a Transaction instance", () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      const tx = client.startTransaction("checkout", "http.server");
      expect(tx).toBeInstanceOf(Transaction);
    });

    it("finish() is a no-op when enablePerformance=false", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      const tx = client.startTransaction("a", "op");
      tx.finish();
      await flushMicrotasks();
      // No transaction call to fetch /api/v1/transactions
      const txCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/transactions"));
      expect(txCalls.length).toBe(0);
    });

    it("finish() sends transaction when enablePerformance + experimental + sample", async () => {
      const fetchMock = installFetchMock();
      randomSpy!.mockReturnValue(0); // ensure tracesSampleRate=1.0 passes
      const client = new Bugwatch({
        apiKey: "k",
        enablePerformance: true,
        experimentalPerformance: true,
        tracesSampleRate: 1.0,
      });
      const tx = client.startTransaction("a", "op");
      tx.finish();
      await flushMicrotasks();
      const txCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/transactions"));
      expect(txCalls.length).toBeGreaterThan(0);
    });

    it("finish() does NOT send when tracesSampleRate=0", async () => {
      const fetchMock = installFetchMock();
      randomSpy!.mockReturnValue(0.5); // 0.5 > 0 → sampled out
      const client = new Bugwatch({
        apiKey: "k",
        enablePerformance: true,
        experimentalPerformance: true,
        tracesSampleRate: 0,
      });
      const tx = client.startTransaction("a", "op");
      tx.finish();
      await flushMicrotasks();
      const txCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/transactions"));
      expect(txCalls.length).toBe(0);
    });

    it("finish() is no-op after close()", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        enablePerformance: true,
        experimentalPerformance: true,
      });
      const tx = client.startTransaction("a", "op");
      await client.close();
      tx.finish();
      await flushMicrotasks();
      const txCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/transactions"));
      expect(txCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // flush / close
  // -------------------------------------------------------------------
  describe("flush / close", () => {
    it("flush() resolves (delegates to transport.flush)", async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hi");
      await expect(client.flush()).resolves.toBeUndefined();
    });

    it("flush() resolves even with NoopTransport (no apiKey)", async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "" });
      await expect(client.flush()).resolves.toBeUndefined();
    });

    it("close() resolves and prevents further events", async () => {
      installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      await client.close();
      expect(client.captureException(new Error("x"))).toBe("");
      expect(client.captureMessage("y")).toBe("");
    });

    it("close() falls back to flush() when transport has no close", async () => {
      installFetchMock();
      // NoopTransport has no close() — close() should call flush() (which is also undefined),
      // and still resolve without crashing.
      const client = new Bugwatch({ apiKey: "" });
      await expect(client.close()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // RingBuffer indirect tests
  // -------------------------------------------------------------------
  describe("RingBuffer (indirect via breadcrumbs)", () => {
    it("empty buffer → no breadcrumbs on event", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      // Empty array or undefined are both acceptable shapes.
      expect(!sent.breadcrumbs || sent.breadcrumbs.length === 0).toBe(true);
    });

    it("preserves order oldest → newest", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k", maxBreadcrumbs: 5 });
      const order = ["a", "b", "c", "d"];
      for (const m of order) {
        client.addBreadcrumb({ category: "x", message: m });
      }
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs!.map((b) => b.message)).toEqual(order);
    });

    it("clear() resets the ring buffer", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k", maxBreadcrumbs: 3 });
      client.addBreadcrumb({ category: "x", message: "old" });
      client.clearBreadcrumbs();
      client.addBreadcrumb({ category: "x", message: "new" });
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs!.length).toBe(1);
      expect(sent.breadcrumbs![0]!.message).toBe("new");
    });

    it("falls back to default maxBreadcrumbs when 0 is passed", async () => {
      // 0 is falsy → constructor falls back to 100. We can't easily prove
      // the size, but we can verify many crumbs are kept.
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k", maxBreadcrumbs: 0 });
      for (let i = 0; i < 50; i++) {
        client.addBreadcrumb({ category: "x", message: `b${i}` });
      }
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.breadcrumbs!.length).toBe(50);
    });
  });

  // -------------------------------------------------------------------
  // Misc shape checks
  // -------------------------------------------------------------------
  describe("event shape", () => {
    it("includes sdk name and version", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.sdk?.name).toBe("@bugwatch/core");
      expect(typeof sent.sdk?.version).toBe("string");
    });

    it("includes environment + release on outgoing events", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({
        apiKey: "k",
        environment: "qa",
        release: "1.2.3",
      });
      client.captureMessage("hi");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      expect(sent.environment).toBe("qa");
      expect(sent.release).toBe("1.2.3");
    });

    it("breadcrumb contains an ISO timestamp", async () => {
      const fetchMock = installFetchMock();
      const client = new Bugwatch({ apiKey: "k" });
      client.addBreadcrumb({ category: "x", message: "ts" });
      client.captureMessage("done");
      await flushMicrotasks();
      const sent = getSentEvent(fetchMock);
      const crumb = sent.breadcrumbs![0] as Breadcrumb;
      expect(crumb.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
