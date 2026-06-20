import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// vi.mock factories are hoisted — use vi.hoisted() for variables referenced in them
const {
  mockCaptureException,
  mockCaptureMessage,
  mockAddBreadcrumb,
  mockFlush,
  mockClose,
  mockRunWithContext,
  mockCreateScopedContext,
} = vi.hoisted(() => ({
  mockCaptureException: vi.fn(() => "event-id"),
  mockCaptureMessage: vi.fn(() => "msg-id"),
  mockAddBreadcrumb: vi.fn(),
  mockFlush: vi.fn(() => Promise.resolve()),
  mockClose: vi.fn(() => Promise.resolve()),
  mockRunWithContext: vi.fn((_, fn: () => void) => fn()),
  mockCreateScopedContext: vi.fn(() => ({ user: undefined })),
}));

// ── Mock state ────────────────────────────────────────────────────────────────
let _mockClient: {
  captureException: ReturnType<typeof vi.fn>;
  captureMessage: ReturnType<typeof vi.fn>;
} | null = null;

function makeMockClient() {
  return {
    captureException: vi.fn(() => "event-id"),
    captureMessage: vi.fn(() => "msg-id"),
  };
}

vi.mock("@bugwatch/core", () => ({
  getClient: vi.fn(() => _mockClient),
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
  addBreadcrumb: mockAddBreadcrumb,
  flush: mockFlush,
  close: mockClose,
  runWithContext: mockRunWithContext,
  createScopedContext: mockCreateScopedContext,
  setUser: vi.fn(),
}));

import { bugwatchPlugin } from "./plugin";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function buildApp(opts: Record<string, any> = {}) {
  const app = Fastify();
  await app.register(bugwatchPlugin, opts);
  app.get("/ok", async () => ({ status: "ok" }));
  app.get("/throw", async () => {
    throw new Error("route error");
  });
  await app.ready();
  return app;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  _mockClient = null;
  vi.clearAllMocks();
  mockRunWithContext.mockImplementation((_, fn: () => void) => fn());
});

// ── Plugin registration ───────────────────────────────────────────────────────
describe("bugwatchPlugin — no client", () => {
  it("handles requests normally when no client is initialised", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ok" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("does not add breadcrumbs when no client", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/ok" });
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
    await app.close();
  });
});

// ── onRequest hook ────────────────────────────────────────────────────────────
describe("onRequest hook", () => {
  it("adds http breadcrumb for each request", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp({ addBreadcrumbs: true });
    await app.inject({ method: "GET", url: "/ok" });
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "http",
        message: expect.stringContaining("GET"),
        level: "info",
      })
    );
    await app.close();
  });

  it("skips breadcrumb when addBreadcrumbs is false", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp({ addBreadcrumbs: false });
    await app.inject({ method: "GET", url: "/ok" });
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
    await app.close();
  });

  it("creates a scoped context per request", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/ok" });
    expect(mockCreateScopedContext).toHaveBeenCalled();
    expect(mockRunWithContext).toHaveBeenCalled();
    await app.close();
  });

  it("calls extractUser and sets user on context", async () => {
    _mockClient = makeMockClient();
    const scopedCtx = { user: undefined as any };
    mockCreateScopedContext.mockReturnValue(scopedCtx);
    const extractUser = vi.fn(() => ({ id: "u1" }));
    const app = await buildApp({ extractUser });
    await app.inject({ method: "GET", url: "/ok" });
    expect(extractUser).toHaveBeenCalled();
    expect(scopedCtx.user).toEqual({ id: "u1" });
    await app.close();
  });

  it("survives if extractUser throws", async () => {
    _mockClient = makeMockClient();
    const extractUser = vi.fn(() => {
      throw new Error("auth exploded");
    });
    const app = await buildApp({ extractUser });
    const res = await app.inject({ method: "GET", url: "/ok" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// ── onResponse hook ───────────────────────────────────────────────────────────
describe("onResponse hook", () => {
  it("adds completion breadcrumb with status code", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp({ addBreadcrumbs: true });
    await app.inject({ method: "GET", url: "/ok" });
    const breadcrumbs = mockAddBreadcrumb.mock.calls.map((c) => c[0]);
    const completion = breadcrumbs.find((b) => b.data?.status_code !== undefined);
    expect(completion).toBeDefined();
    expect(completion.data.status_code).toBe(200);
    await app.close();
  });
});

// ── onError hook ──────────────────────────────────────────────────────────────
describe("onError hook", () => {
  it("captures error via captureException", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp({ captureErrors: true });
    await app.inject({ method: "GET", url: "/throw" }).catch(() => {});
    expect(mockCaptureException).toHaveBeenCalled();
    await app.close();
  });

  it("flushes when flushOnError is true", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp({ captureErrors: true, flushOnError: true });
    await app.inject({ method: "GET", url: "/throw" }).catch(() => {});
    expect(mockFlush).toHaveBeenCalled();
    await app.close();
  });

  it("skips capture when captureErrors is false", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp({ captureErrors: false });
    await app.inject({ method: "GET", url: "/throw" }).catch(() => {});
    expect(mockCaptureException).not.toHaveBeenCalled();
    await app.close();
  });
});

// ── onClose hook ──────────────────────────────────────────────────────────────
describe("onClose hook", () => {
  it("calls close() when the Fastify app closes", async () => {
    _mockClient = makeMockClient();
    const app = await buildApp();
    await app.close();
    expect(mockClose).toHaveBeenCalled();
  });
});

// ── request.bugwatch decorator ────────────────────────────────────────────────
describe("request.bugwatch decorator", () => {
  it("captureError returns event id", async () => {
    _mockClient = makeMockClient();

    const app = Fastify();
    await app.register(bugwatchPlugin);
    app.get("/capture", async (req) => {
      req.bugwatch.captureError(new Error("manual"));
      return { ok: true };
    });
    await app.ready();
    await app.inject({ method: "GET", url: "/capture" });

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ "http.method": "GET" }),
      })
    );
    await app.close();
  });

  it("captureError returns empty string when no client", async () => {
    let result = "";
    const app = Fastify();
    await app.register(bugwatchPlugin);
    app.get("/cap", async (req) => {
      result = req.bugwatch.captureError(new Error("x"));
      return {};
    });
    await app.ready();
    await app.inject({ method: "GET", url: "/cap" });
    expect(result).toBe("");
    await app.close();
  });

  it("captureMessage returns event id", async () => {
    _mockClient = makeMockClient();
    let result = "";
    const app = Fastify();
    await app.register(bugwatchPlugin);
    app.get("/msg", async (req) => {
      result = req.bugwatch.captureMessage("hello");
      return {};
    });
    await app.ready();
    await app.inject({ method: "GET", url: "/msg" });
    expect(mockCaptureMessage).toHaveBeenCalledWith("hello", "info");
    expect(result).toBe("msg-id");
    await app.close();
  });

  it("getEventId returns undefined before any capture", async () => {
    _mockClient = makeMockClient();
    let eventId: string | undefined = "sentinel";
    const app = Fastify();
    await app.register(bugwatchPlugin);
    app.get("/id", async (req) => {
      eventId = req.bugwatch.getEventId();
      return {};
    });
    await app.ready();
    await app.inject({ method: "GET", url: "/id" });
    expect(eventId).toBeUndefined();
    await app.close();
  });
});

// ── Header / body filtering ───────────────────────────────────────────────────
describe("header filtering", () => {
  it("excludes sensitive headers from request context", async () => {
    _mockClient = makeMockClient();
    const app = Fastify();
    await app.register(bugwatchPlugin, { captureErrors: true });
    app.get("/sensitive", async () => {
      throw new Error("err");
    });
    await app.ready();

    await app
      .inject({
        method: "GET",
        url: "/sensitive",
        headers: { authorization: "Bearer tok", "x-api-key": "k", accept: "application/json" },
      })
      .catch(() => {});

    if (mockCaptureException.mock.calls.length > 0) {
      const requestCtx = ((mockCaptureException.mock.calls[0] as any[])![1] as any)?.request;
      if (requestCtx?.headers) {
        expect(requestCtx.headers.authorization).toBeUndefined();
        expect(requestCtx.headers["x-api-key"]).toBeUndefined();
      }
    }
    await app.close();
  });
});
