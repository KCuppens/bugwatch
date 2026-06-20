import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock state ────────────────────────────────────────────────────────────────
let _mockClient: {
  captureException: ReturnType<typeof vi.fn>;
  captureMessage: ReturnType<typeof vi.fn>;
  addBreadcrumb: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setTag: ReturnType<typeof vi.fn>;
  getOptions: ReturnType<typeof vi.fn>;
} | null = null;

function makeMockClient() {
  return {
    captureException: vi.fn(() => "event-id"),
    captureMessage: vi.fn(() => "msg-id"),
    addBreadcrumb: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    setTag: vi.fn(),
    getOptions: vi.fn(() => ({ debug: false })),
  };
}

vi.mock("@bugwatch/core", () => ({
  init: vi.fn(() => {
    _mockClient = makeMockClient();
    return _mockClient;
  }),
  getClient: vi.fn(() => _mockClient),
  getEnvConfig: vi.fn(() => ({})),
}));

import { init, setup, close, expressErrorHandler, expressRequestHandler, wrapAsync, ConsoleIntegration } from "./index";
import * as core from "@bugwatch/core";

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  _mockClient = null;
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
});

afterEach(async () => {
  await close();
  vi.restoreAllMocks();
});

// ── init ──────────────────────────────────────────────────────────────────────
describe("init", () => {
  it("calls coreInit and returns client", () => {
    const client = init({ apiKey: "bw_test" });
    expect(core.init).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "bw_test" }));
    expect(client).toBe(_mockClient);
  });

  it("sets runtime, version, os.platform, os.arch tags", () => {
    const client = init({ apiKey: "bw_test" });
    // runtime is provided via the core init options, not as a tag
    expect(core.init).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: { name: "node", version: process.version } })
    );
    expect(client.setTag).toHaveBeenCalledWith("os.platform", process.platform);
    expect(client.setTag).toHaveBeenCalledWith("os.arch", process.arch);
  });

  it("registers uncaughtException handler by default", () => {
    const before = process.listenerCount("uncaughtException");
    init({ apiKey: "bw_test" });
    expect(process.listenerCount("uncaughtException")).toBeGreaterThan(before);
  });

  it("registers unhandledRejection handler by default", () => {
    const before = process.listenerCount("unhandledRejection");
    init({ apiKey: "bw_test" });
    expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(before);
  });

  it("skips uncaughtException handler when captureUncaughtExceptions is false", () => {
    const before = process.listenerCount("uncaughtException");
    init({ apiKey: "bw_test", captureUncaughtExceptions: false });
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });

  it("skips unhandledRejection handler when captureUnhandledRejections is false", () => {
    const before = process.listenerCount("unhandledRejection");
    init({ apiKey: "bw_test", captureUnhandledRejections: false });
    expect(process.listenerCount("unhandledRejection")).toBe(before);
  });

  it("logs debug message when debug is true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    init({ apiKey: "bw_test", debug: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[Bugwatch]"));
  });
});

// ── setup ─────────────────────────────────────────────────────────────────────
describe("setup", () => {
  it("calls init when no existing client", () => {
    setup({ apiKey: "bw_test" });
    expect(core.init).toHaveBeenCalled();
  });

  it("returns existing client without re-initialising", () => {
    _mockClient = makeMockClient();
    const returned = setup({ apiKey: "bw_test" });
    expect(core.init).not.toHaveBeenCalled();
    expect(returned).toBe(_mockClient);
  });

  it("merges env config with explicit options", () => {
    vi.mocked(core.getEnvConfig).mockReturnValue({ environment: "staging" });
    setup({ apiKey: "bw_test" });
    expect(core.init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "staging",
        apiKey: "bw_test",
      })
    );
  });
});

// ── close ─────────────────────────────────────────────────────────────────────
describe("close", () => {
  it("closes the core client and runs cleanup functions", async () => {
    const client = init({ apiKey: "bw_test" });
    await close();
    expect(client.close).toHaveBeenCalled();
  });

  it("removes uncaughtException listener after close", async () => {
    init({ apiKey: "bw_test" });
    const before = process.listenerCount("uncaughtException");
    await close();
    expect(process.listenerCount("uncaughtException")).toBeLessThan(before);
  });
});

// ── expressErrorHandler ───────────────────────────────────────────────────────
describe("expressErrorHandler", () => {
  function makeReq(headers: Record<string, string> = {}) {
    return {
      method: "GET",
      url: "/api/test",
      headers: { "content-type": "application/json", ...headers },
      socket: { remoteAddress: "127.0.0.1" },
      get: (name: string) => ({ "content-type": "application/json", ...headers })[name.toLowerCase()],
    } as any;
  }

  it("calls next with error when no client", () => {
    const handler = expressErrorHandler();
    const next = vi.fn();
    handler(new Error("boom"), makeReq(), { statusCode: 500 } as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it("captures error and calls next", () => {
    _mockClient = makeMockClient();
    const handler = expressErrorHandler();
    const next = vi.fn();
    const err = new Error("api failed");
    handler(err, makeReq(), { statusCode: 500 } as any, next);
    expect(_mockClient.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) })
    );
    expect(next).toHaveBeenCalledWith(err);
  });

  it("filters out Authorization header", () => {
    _mockClient = makeMockClient();
    const handler = expressErrorHandler();
    handler(new Error("e"), makeReq({ authorization: "Bearer secret" }), { statusCode: 500 } as any, vi.fn());
    const requestArg = _mockClient.captureException.mock.calls[0]![1].request;
    expect(requestArg.headers.authorization).toBe("[Filtered]");
    expect(requestArg.headers["content-type"]).toBe("application/json");
  });

  it("passes non-Error values through to captureException as-is", () => {
    _mockClient = makeMockClient();
    const handler = expressErrorHandler();
    handler("plain string" as any, makeReq(), { statusCode: 500 } as any, vi.fn());
    const [err] = _mockClient.captureException.mock.calls[0]!;
    // expressErrorHandler does not normalise — it forwards whatever err it receives
    expect(err).toBe("plain string");
  });

  it("uses x-forwarded-for for client IP", () => {
    _mockClient = makeMockClient();
    const req = {
      ...makeReq(),
      get: (name: string) => (name === "x-forwarded-for" ? "10.0.0.1, 10.0.0.2" : undefined),
    } as any;
    expressErrorHandler()(new Error("e"), req, { statusCode: 500 } as any, vi.fn());
    expect(_mockClient.captureException).toHaveBeenCalled();
  });
});

// ── expressRequestHandler ────────────────────────────────────────────────────
describe("expressRequestHandler", () => {
  it("just calls next when no client", () => {
    const handler = expressRequestHandler();
    const next = vi.fn();
    handler({ method: "GET", url: "/health" } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
  });

  it("adds http breadcrumb then calls next", () => {
    _mockClient = makeMockClient();
    const handler = expressRequestHandler();
    const next = vi.fn();
    handler({ method: "DELETE", url: "/users/1" } as any, {} as any, next);
    expect(_mockClient.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "http",
        message: "DELETE /users/1",
        level: "info",
      })
    );
    expect(next).toHaveBeenCalled();
  });
});

// ── wrapAsync ─────────────────────────────────────────────────────────────────
describe("wrapAsync", () => {
  it("returns the result when the async function succeeds", async () => {
    _mockClient = makeMockClient();
    const wrapped = wrapAsync(async () => "result");
    await expect(wrapped()).resolves.toBe("result");
  });

  it("captures the error and re-throws", async () => {
    _mockClient = makeMockClient();
    const err = new Error("async fail");
    const wrapped = wrapAsync(async () => {
      throw err;
    });
    await expect(wrapped()).rejects.toThrow(err);
    expect(_mockClient.captureException).toHaveBeenCalledWith(err);
  });

  it("normalises non-Error throws before capturing", async () => {
    _mockClient = makeMockClient();
    const wrapped = wrapAsync(async () => {
      throw "bad string";
    });
    await expect(wrapped()).rejects.toBe("bad string");
    expect(_mockClient.captureException).toHaveBeenCalledWith(expect.any(Error));
  });

  it("does not capture when no client", async () => {
    const wrapped = wrapAsync(async () => {
      throw new Error("silent");
    });
    await expect(wrapped()).rejects.toThrow("silent");
  });
});

// ── ConsoleIntegration ────────────────────────────────────────────────────────
describe("ConsoleIntegration", () => {
  let savedLog: typeof console.log;
  let savedInfo: typeof console.info;
  let savedWarn: typeof console.warn;
  let savedError: typeof console.error;

  beforeEach(() => {
    savedLog = console.log;
    savedInfo = console.info;
    savedWarn = console.warn;
    savedError = console.error;
  });

  afterEach(() => {
    console.log = savedLog;
    console.info = savedInfo;
    console.warn = savedWarn;
    console.error = savedError;
  });

  it("hooks console.log to add debug breadcrumbs", () => {
    const client = makeMockClient();
    vi.spyOn(console, "log").mockImplementation(() => {});
    ConsoleIntegration.setup(client as any);
    console.log("test message");
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "console",
        level: "debug",
        message: "test message",
      })
    );
  });

  it("hooks console.error to add error breadcrumbs", () => {
    const client = makeMockClient();
    vi.spyOn(console, "error").mockImplementation(() => {});
    ConsoleIntegration.setup(client as any);
    console.error("error message");
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "console",
        level: "error",
        message: "error message",
      })
    );
  });

  it("hooks console.warn to add warning breadcrumbs", () => {
    const client = makeMockClient();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ConsoleIntegration.setup(client as any);
    console.warn("watch out");
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
      })
    );
  });

  it("does not recurse when breadcrumb throws", () => {
    const client = makeMockClient();
    client.addBreadcrumb.mockImplementation(() => {
      throw new Error("bcrumb fail");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    ConsoleIntegration.setup(client as any);
    expect(() => console.log("safe")).not.toThrow();
  });
});

// ── uncaughtException handler ─────────────────────────────────────────────────
describe("uncaughtException handler", () => {
  it("captures the error as fatal", async () => {
    vi.useFakeTimers();
    const client = init({ apiKey: "bw_test" });

    const listeners = process.rawListeners("uncaughtException") as Function[];
    const ourHandler = listeners[listeners.length - 1]!;

    ourHandler(new Error("crash!"));

    expect(client.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: "fatal", tags: { mechanism: "uncaughtException" } })
    );

    await vi.runAllTimersAsync();
    expect(process.exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it("normalises non-Error values", async () => {
    vi.useFakeTimers();
    const client = init({ apiKey: "bw_test" });

    const listeners = process.rawListeners("uncaughtException") as Function[];
    const ourHandler = listeners[listeners.length - 1]!;

    ourHandler("plain string crash");

    expect(client.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "plain string crash" }),
      expect.anything()
    );
    vi.useRealTimers();
  });
});

// ── unhandledRejection handler ────────────────────────────────────────────────
describe("unhandledRejection handler", () => {
  it("captures rejection as error level", () => {
    const client = init({ apiKey: "bw_test" });

    const listeners = process.rawListeners("unhandledRejection") as Function[];
    const ourHandler = listeners[listeners.length - 1]!;

    ourHandler(new Error("unhandled promise"));

    expect(client.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: "error", tags: { mechanism: "unhandledRejection" } })
    );
  });

  it("normalises non-Error rejection reason", () => {
    const client = init({ apiKey: "bw_test" });

    const listeners = process.rawListeners("unhandledRejection") as Function[];
    const ourHandler = listeners[listeners.length - 1]!;

    ourHandler(42);

    expect(client.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "42" }), expect.anything());
  });
});

// ── setupConsoleErrorCapture ──────────────────────────────────────────────────
describe("setupConsoleErrorCapture (via init)", () => {
  let origConsoleError: typeof console.error;

  beforeEach(() => {
    origConsoleError = console.error;
  });

  afterEach(() => {
    console.error = origConsoleError;
  });

  it("captures Error objects found in console.error args", () => {
    const client = init({ apiKey: "bw_test" });
    const err = new Error("db connection failed");
    vi.spyOn(origConsoleError as any, "apply").mockImplementation(() => {});
    console.error("context:", err);
    expect(client.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ level: "warning", tags: { mechanism: "console.error" } })
    );
  });

  it("captures error-like text messages", () => {
    const client = init({ apiKey: "bw_test" });
    vi.spyOn(origConsoleError as any, "apply").mockImplementation(() => {});
    console.error("ECONNREFUSED connecting to database");
    expect(client.captureMessage).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"), "warning");
  });

  it("skips messages starting with [Bugwatch]", () => {
    const client = init({ apiKey: "bw_test" });
    vi.spyOn(origConsoleError as any, "apply").mockImplementation(() => {});
    console.error("[Bugwatch] SDK debug info");
    expect(client.captureException).not.toHaveBeenCalled();
    expect(client.captureMessage).not.toHaveBeenCalled();
  });

  it("skips non-error-like plain text", () => {
    const client = init({ apiKey: "bw_test" });
    vi.spyOn(origConsoleError as any, "apply").mockImplementation(() => {});
    console.error("everything is fine");
    expect(client.captureException).not.toHaveBeenCalled();
    expect(client.captureMessage).not.toHaveBeenCalled();
  });
});
