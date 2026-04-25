import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Bugwatch,
  init,
  getClient,
  reset,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
  flush,
  close,
  startTransaction,
  Transaction,
  runWithContext,
  getRequestContext,
  createScopedContext,
} from "./index";

describe("index.ts (global SDK API)", () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    reset();
    vi.unstubAllEnvs();
    // Ensure no leakage from outer process env into tests.
    vi.stubEnv("BUGWATCH_API_KEY", "");
    vi.stubEnv("BUGWATCH_ENVIRONMENT", "");
    vi.stubEnv("BUGWATCH_RELEASE", "");
    vi.stubEnv("BUGWATCH_DEBUG", "");
    vi.stubEnv("BUGWATCH_ENDPOINT", "");

    originalFetch = globalThis.fetch;
    // Stub fetch so transport calls don't actually fire.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    // Deterministic Math.random for sample rate decisions.
    vi.spyOn(Math, "random").mockReturnValue(0.1);
  });

  afterEach(() => {
    reset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = originalFetch;
  });

  // -------------------------------------------------------------------
  // init()
  // -------------------------------------------------------------------
  describe("init()", () => {
    it("creates a Bugwatch client with explicit options", () => {
      const client = init({ apiKey: "bw_live_test" });
      expect(client).toBeInstanceOf(Bugwatch);
      expect(client.getOptions().apiKey).toBe("bw_live_test");
    });

    it("returns the same client and warns on second init() without reset", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const first = init({ apiKey: "bw_live_a" });
      const second = init({ apiKey: "bw_live_b" });
      expect(second).toBe(first);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("called twice");
    });

    it("uses BUGWATCH_API_KEY env var when no options given", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_envkey");
      const client = init();
      expect(client.getOptions().apiKey).toBe("bw_live_envkey");
    });

    it("explicit options override env vars", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_env");
      vi.stubEnv("BUGWATCH_ENVIRONMENT", "production");
      const client = init({ apiKey: "bw_live_explicit", environment: "staging" });
      const opts = client.getOptions();
      expect(opts.apiKey).toBe("bw_live_explicit");
      expect(opts.environment).toBe("staging");
    });

    it("merges env vars with explicit options when keys don't conflict", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_envkey");
      vi.stubEnv("BUGWATCH_ENVIRONMENT", "qa");
      const client = init({ release: "9.9.9" });
      const opts = client.getOptions();
      expect(opts.apiKey).toBe("bw_live_envkey");
      expect(opts.environment).toBe("qa");
      expect(opts.release).toBe("9.9.9");
    });

    it("throws when no API key provided and env not set", () => {
      expect(() => init()).toThrow(/BUGWATCH_API_KEY/);
    });

    it("throws when explicit options have no apiKey and env not set", () => {
      expect(() => init({ environment: "staging" })).toThrow(/BUGWATCH_API_KEY/);
    });
  });

  // -------------------------------------------------------------------
  // getClient()
  // -------------------------------------------------------------------
  describe("getClient()", () => {
    it("returns null before init", () => {
      expect(getClient()).toBeNull();
    });

    it("returns the client after init", () => {
      const client = init({ apiKey: "bw_live_x" });
      expect(getClient()).toBe(client);
    });
  });

  // -------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------
  describe("reset()", () => {
    it("clears the global client", () => {
      init({ apiKey: "bw_live_x" });
      expect(getClient()).not.toBeNull();
      reset();
      expect(getClient()).toBeNull();
    });

    it("allows fresh init() after reset (no double-init warning)", () => {
      init({ apiKey: "bw_live_a" });
      reset();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const second = init({ apiKey: "bw_live_b" });
      expect(second.getOptions().apiKey).toBe("bw_live_b");
      // No "called twice" warning should be logged on this fresh init.
      const calledTwiceWarnings = warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("called twice")
      );
      expect(calledTwiceWarnings.length).toBe(0);
    });

    it("resets lazyInitWarned flag", () => {
      // First lazy init in debug mode logs the warning.
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      vi.stubEnv("BUGWATCH_DEBUG", "true");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      captureMessage("hi");
      const lazyMsgsBefore = warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("Auto-initialized")
      ).length;
      expect(lazyMsgsBefore).toBe(1);

      reset();
      // After reset + lazy init again, the warning should fire again.
      captureMessage("hi");
      const lazyMsgsAfter = warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("Auto-initialized")
      ).length;
      expect(lazyMsgsAfter).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // Global wrappers BEFORE init()
  // -------------------------------------------------------------------
  describe("global wrappers before init", () => {
    it('captureException returns "" and warns when not initialized', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const id = captureException(new Error("x"));
      expect(id).toBe("");
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]![0]).toContain("not initialized");
    });

    it('captureMessage returns "" and warns when not initialized', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const id = captureMessage("hi");
      expect(id).toBe("");
      expect(warn).toHaveBeenCalled();
    });

    it("addBreadcrumb is a silent no-op when not initialized (no auto-init)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => addBreadcrumb({ category: "x", message: "y" })).not.toThrow();
      expect(getClient()).toBeNull();
      // addBreadcrumb does NOT auto-init; no warning expected.
      expect(warn).not.toHaveBeenCalled();
    });

    it("setUser is a silent no-op when not initialized", () => {
      expect(() => setUser({ id: "u1" })).not.toThrow();
      expect(getClient()).toBeNull();
    });

    it("setTag is a silent no-op when not initialized", () => {
      expect(() => setTag("env", "prod")).not.toThrow();
      expect(getClient()).toBeNull();
    });

    it("setExtra is a silent no-op when not initialized", () => {
      expect(() => setExtra("foo", 1)).not.toThrow();
      expect(getClient()).toBeNull();
    });

    it("flush warns and resolves when not initialized (no auto-init)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(flush()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]![0]).toContain("not initialized");
    });

    it("close warns and resolves when not initialized (no auto-init)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(close()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]![0]).toContain("not initialized");
    });

    it("startTransaction returns a no-op Transaction when no client and no env key", () => {
      const tx = startTransaction("name", "op");
      expect(tx).toBeInstanceOf(Transaction);
      expect(() => tx.finish()).not.toThrow();
      // No client should have been created.
      expect(getClient()).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Global wrappers AFTER init() — delegate to globalClient
  // -------------------------------------------------------------------
  describe("global wrappers after init", () => {
    it("captureException delegates to globalClient.captureException", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "captureException").mockReturnValue("event-1");
      const result = captureException(new Error("boom"), { tags: { a: "b" } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toBeInstanceOf(Error);
      expect(result).toBe("event-1");
    });

    it("captureMessage delegates to globalClient.captureMessage", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "captureMessage").mockReturnValue("msg-1");
      const result = captureMessage("hello", "warning");
      expect(spy).toHaveBeenCalledWith("hello", "warning");
      expect(result).toBe("msg-1");
    });

    it("addBreadcrumb falls back to globalClient.addBreadcrumb when not in request context", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "addBreadcrumb").mockImplementation(() => {});
      addBreadcrumb({ category: "ui", message: "click" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toMatchObject({
        category: "ui",
        message: "click",
      });
    });

    it("setUser falls back to globalClient.setUser when not in request context", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "setUser").mockImplementation(() => {});
      setUser({ id: "u1" });
      expect(spy).toHaveBeenCalledWith({ id: "u1" });
    });

    it("setTag falls back to globalClient.setTag when not in request context", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "setTag").mockImplementation(() => {});
      setTag("env", "prod");
      expect(spy).toHaveBeenCalledWith("env", "prod");
    });

    it("setExtra falls back to globalClient.setExtra when not in request context", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "setExtra").mockImplementation(() => {});
      setExtra("orderId", 42);
      expect(spy).toHaveBeenCalledWith("orderId", 42);
    });

    it("flush delegates to globalClient.flush", async () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "flush").mockResolvedValue(undefined);
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("close delegates to globalClient.close and clears global state", async () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "close").mockResolvedValue(undefined);
      await close();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(getClient()).toBeNull();
    });

    it("startTransaction delegates to globalClient.startTransaction when initialized", () => {
      const client = init({ apiKey: "bw_live_x" });
      const fakeTx = new Transaction("name", "op");
      const spy = vi.spyOn(client, "startTransaction").mockReturnValue(fakeTx);
      const result = startTransaction("name", "op");
      expect(spy).toHaveBeenCalledWith("name", "op");
      expect(result).toBe(fakeTx);
    });
  });

  // -------------------------------------------------------------------
  // Lazy init from BUGWATCH_API_KEY
  // -------------------------------------------------------------------
  describe("lazy init from BUGWATCH_API_KEY", () => {
    it("captureException auto-initializes when env API key is set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      expect(getClient()).toBeNull();
      const id = captureException(new Error("boom"));
      // After auto-init, the client should be created and event_id non-empty.
      expect(getClient()).not.toBeNull();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("captureMessage auto-initializes when env API key is set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      expect(getClient()).toBeNull();
      const id = captureMessage("hi");
      expect(getClient()).not.toBeNull();
      expect(id.length).toBeGreaterThan(0);
    });

    it("startTransaction auto-initializes when env API key is set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      expect(getClient()).toBeNull();
      const tx = startTransaction("nm", "op");
      expect(tx).toBeInstanceOf(Transaction);
      expect(getClient()).not.toBeNull();
    });

    it("addBreadcrumb does NOT auto-init even when env API key is set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      addBreadcrumb({ category: "x", message: "y" });
      expect(getClient()).toBeNull();
    });

    it("flush does NOT auto-init even when env API key is set", async () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await flush();
      expect(getClient()).toBeNull();
      expect(warn).toHaveBeenCalled();
    });

    it("close does NOT auto-init even when env API key is set", async () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await close();
      expect(getClient()).toBeNull();
      expect(warn).toHaveBeenCalled();
    });

    it("debug=true logs auto-init notice once, not twice", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      vi.stubEnv("BUGWATCH_DEBUG", "true");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      captureMessage("hi");
      // Second lazy-triggering call after init is already done — does NOT
      // re-run tryLazyInit since globalClient is set.
      captureMessage("again");

      const autoInitLogs = warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("Auto-initialized")
      );
      expect(autoInitLogs.length).toBe(1);
    });

    it("debug=false does NOT log auto-init notice", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_lazy");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      captureMessage("hi");
      const autoInitLogs = warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("Auto-initialized")
      );
      expect(autoInitLogs.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Request context routing (runWithContext)
  // -------------------------------------------------------------------
  describe("request context routing", () => {
    it("addBreadcrumb adds to request context when inside runWithContext", () => {
      const client = init({ apiKey: "bw_live_x" });
      const clientSpy = vi.spyOn(client, "addBreadcrumb").mockImplementation(() => {});

      const ctx = createScopedContext();
      runWithContext(ctx, () => {
        addBreadcrumb({ category: "req", message: "scoped" });
        const current = getRequestContext();
        expect(current?.breadcrumbs.length).toBe(1);
        expect(current?.breadcrumbs[0]!.message).toBe("scoped");
      });

      // The global client.addBreadcrumb should NOT have been called.
      expect(clientSpy).not.toHaveBeenCalled();
    });

    it("setUser sets on request context when inside runWithContext", () => {
      const client = init({ apiKey: "bw_live_x" });
      const clientSpy = vi.spyOn(client, "setUser").mockImplementation(() => {});

      const ctx = createScopedContext();
      runWithContext(ctx, () => {
        setUser({ id: "scoped-user" });
        expect(getRequestContext()?.user?.id).toBe("scoped-user");
      });

      expect(clientSpy).not.toHaveBeenCalled();
    });

    it("setTag sets on request context when inside runWithContext", () => {
      const client = init({ apiKey: "bw_live_x" });
      const clientSpy = vi.spyOn(client, "setTag").mockImplementation(() => {});

      const ctx = createScopedContext();
      runWithContext(ctx, () => {
        setTag("region", "us-east");
        expect(getRequestContext()?.tags.region).toBe("us-east");
      });

      expect(clientSpy).not.toHaveBeenCalled();
    });

    it("setExtra sets on request context when inside runWithContext", () => {
      const client = init({ apiKey: "bw_live_x" });
      const clientSpy = vi.spyOn(client, "setExtra").mockImplementation(() => {});

      const ctx = createScopedContext();
      runWithContext(ctx, () => {
        setExtra("requestId", "abc-123");
        expect(getRequestContext()?.extra.requestId).toBe("abc-123");
      });

      expect(clientSpy).not.toHaveBeenCalled();
    });

    it("addBreadcrumb falls back to global client outside runWithContext", () => {
      const client = init({ apiKey: "bw_live_x" });
      const spy = vi.spyOn(client, "addBreadcrumb").mockImplementation(() => {});
      addBreadcrumb({ category: "g", message: "global" });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
