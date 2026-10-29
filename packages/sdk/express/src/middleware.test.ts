import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted — use vi.hoisted() for variables referenced in them
const { mockCaptureException, mockAddBreadcrumb, mockFlush, mockRunWithContext, mockCreateScopedContext } = vi.hoisted(
  () => ({
    mockCaptureException: vi.fn(() => "evt-id"),
    mockAddBreadcrumb: vi.fn(),
    mockFlush: vi.fn(() => Promise.resolve()),
    mockRunWithContext: vi.fn((_, fn: () => void) => fn()),
    mockCreateScopedContext: vi.fn(() => ({ user: undefined, tags: {}, extra: {} })),
  })
);

// ── Mock state ────────────────────────────────────────────────────────────────
let _mockClient: {
  captureException: ReturnType<typeof vi.fn>;
  addBreadcrumb: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
} | null = null;

function makeMockClient() {
  return {
    captureException: vi.fn(() => "event-id"),
    addBreadcrumb: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
  };
}

vi.mock("@bugwatch/core", () => ({
  getClient: vi.fn(() => _mockClient),
  captureException: mockCaptureException,
  addBreadcrumb: mockAddBreadcrumb,
  flush: mockFlush,
  runWithContext: mockRunWithContext,
  createScopedContext: mockCreateScopedContext,
  setUser: vi.fn(),
}));

import { requestHandler, errorHandler, wrapHandler, captureError } from "./middleware";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(overrides: Record<string, any> = {}): any {
  const headers: Record<string, string> = { "content-type": "application/json", ...overrides.headers };
  return {
    method: "GET",
    url: "/test?q=1",
    path: "/test",
    originalUrl: "/test?q=1",
    socket: { remoteAddress: "127.0.0.1" },
    protocol: "http",
    get: (name: string) => {
      const all: Record<string, string> = { host: "localhost", ...headers };
      return all[name.toLowerCase()];
    },
    body: undefined,
    bugwatch: undefined,
    ...overrides,
    headers,
  };
}

function makeRes(statusCode = 200): any {
  const res = {
    statusCode,
    end: vi.fn(function (this: any) {
      return this;
    }),
  };
  return res;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  _mockClient = null;
  vi.clearAllMocks();
  mockRunWithContext.mockImplementation((_, fn: () => void) => fn());
});

// ── requestHandler ────────────────────────────────────────────────────────────
describe("requestHandler", () => {
  it("calls next immediately when no client", () => {
    const next = vi.fn();
    requestHandler()(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it("adds http breadcrumb and calls next with client", () => {
    _mockClient = makeMockClient();
    const next = vi.fn();
    requestHandler()(
      makeReq({ method: "POST", path: "/users", originalUrl: "/users", url: "/users" }),
      makeRes(),
      next
    );
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "http",
        message: expect.stringContaining("POST"),
        level: "info",
      })
    );
    expect(next).toHaveBeenCalled();
  });

  it("runs inside a scoped context", () => {
    _mockClient = makeMockClient();
    requestHandler()(makeReq(), makeRes(), vi.fn());
    expect(mockCreateScopedContext).toHaveBeenCalled();
    expect(mockRunWithContext).toHaveBeenCalled();
  });

  it("extracts and sets user context when extractUser provided", () => {
    _mockClient = makeMockClient();
    const scopedCtx = { user: undefined as any, tags: {}, extra: {} };
    mockCreateScopedContext.mockReturnValue(scopedCtx);
    const extractUser = vi.fn(() => ({ id: "u42", email: "a@b.com" }));
    requestHandler({ extractUser })(makeReq(), makeRes(), vi.fn());
    expect(scopedCtx.user).toEqual({ id: "u42", email: "a@b.com" });
  });

  it("skips breadcrumb when addBreadcrumbs is false", () => {
    _mockClient = makeMockClient();
    requestHandler({ addBreadcrumbs: false })(makeReq(), makeRes(), vi.fn());
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it("adds completion breadcrumb when res.end is called", () => {
    _mockClient = makeMockClient();
    const res = makeRes(200);
    const next = vi.fn();
    requestHandler()(makeReq(), res, next);
    res.end();
    // 2 breadcrumbs: request start + completion
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(2);
    expect(mockAddBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status_code: 200 }),
      })
    );
  });
});

// ── errorHandler ──────────────────────────────────────────────────────────────
describe("errorHandler", () => {
  it("calls next(err) immediately when no client", async () => {
    const next = vi.fn();
    const err = new Error("boom");
    await errorHandler()(err, makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(err);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("captures Error instances and passes to next", async () => {
    _mockClient = makeMockClient();
    const next = vi.fn();
    const err = new Error("server error");
    await errorHandler()(err, makeReq(), makeRes(500), next);
    expect(mockCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) })
    );
    expect(next).toHaveBeenCalledWith(err);
  });

  it("normalises non-Error to Error with name NonErrorException", async () => {
    _mockClient = makeMockClient();
    await errorHandler()("string error" as any, makeReq(), makeRes(500), vi.fn());
    const [capturedErr] = mockCaptureException.mock.calls[0]! as any[];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.name).toBe("NonErrorException");
  });

  it("normalises thrown objects to JSON string", async () => {
    _mockClient = makeMockClient();
    await errorHandler()({ code: 42 } as any, makeReq(), makeRes(500), vi.fn());
    const [capturedErr] = mockCaptureException.mock.calls[0]! as any[];
    expect(capturedErr.message).toContain("42");
  });

  it("filters Authorization header from request context", async () => {
    _mockClient = makeMockClient();
    const req = makeReq({ headers: { authorization: "Bearer secret", "content-type": "application/json" } });
    await errorHandler()(new Error("e"), req, makeRes(), vi.fn());
    const requestCtx = (mockCaptureException.mock.calls[0]! as any[])[1].request;
    expect(requestCtx.headers.authorization).toBeUndefined();
    expect(requestCtx.headers["content-type"]).toBe("application/json");
  });

  it("also filters cookie and x-api-key headers", async () => {
    _mockClient = makeMockClient();
    const req = makeReq({ headers: { cookie: "session=abc", "x-api-key": "key123" } });
    await errorHandler()(new Error("e"), req, makeRes(), vi.fn());
    const requestCtx = (mockCaptureException.mock.calls[0]! as any[])[1].request;
    expect(requestCtx.headers.cookie).toBeUndefined();
    expect(requestCtx.headers["x-api-key"]).toBeUndefined();
  });

  it("flushes when flushOnError is true", async () => {
    _mockClient = makeMockClient();
    await errorHandler({ flushOnError: true })(new Error("e"), makeReq(), makeRes(), vi.fn());
    expect(mockFlush).toHaveBeenCalled();
  });

  it("does not flush when flushOnError is false (default)", async () => {
    _mockClient = makeMockClient();
    await errorHandler()(new Error("e"), makeReq(), makeRes(), vi.fn());
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("includes body data when includeBody is true", async () => {
    _mockClient = makeMockClient();
    const req = makeReq({ body: { username: "alice", password: "secret" } });
    await errorHandler({ includeBody: true })(new Error("e"), req, makeRes(), vi.fn());
    const requestCtx = (mockCaptureException.mock.calls[0]! as any[])[1].request;
    expect(requestCtx.data?.username).toBe("alice");
    expect(requestCtx.data?.password).toBeUndefined();
  });
});

// ── wrapHandler ───────────────────────────────────────────────────────────────
describe("wrapHandler", () => {
  it("calls the handler and resolves normally", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn();
    await wrapHandler(handler)(makeReq(), makeRes(), next);
    expect(handler).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it("passes rejection to next(err)", async () => {
    const err = new Error("async handler failure");
    const handler = vi.fn().mockRejectedValue(err);
    const next = vi.fn();
    await wrapHandler(handler)(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── captureError ──────────────────────────────────────────────────────────────
describe("captureError", () => {
  it("returns empty string when no client", () => {
    const result = captureError(makeReq(), new Error("boom"));
    expect(result).toBe("");
  });

  it("calls captureException and returns event id", () => {
    _mockClient = makeMockClient();
    const err = new Error("manual capture");
    const result = captureError(makeReq(), err);
    expect(mockCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) })
    );
    expect(result).toBe("evt-id");
  });

  it("uses x-forwarded-for IP when present", () => {
    _mockClient = makeMockClient();
    const req = makeReq();
    req.get = (name: string) => (name === "x-forwarded-for" ? "203.0.113.1" : undefined);
    captureError(req, new Error("e"));
    const context = (mockCaptureException.mock.calls[0]! as any[])[1];
    expect(context.user.ip_address).toBe("203.0.113.1");
  });
});
