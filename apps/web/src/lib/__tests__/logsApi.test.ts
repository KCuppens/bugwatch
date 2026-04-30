/**
 * Tests for logsApi, logSavedSearchesApi, and logAlertRulesApi.
 *
 * All tests mock `fetch` globally so no real HTTP requests are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logsApi, logSavedSearchesApi, logAlertRulesApi } from "../api";

// Helper: build a minimal Response
function makeResponse(body: unknown, status = 200): Response {
  const text = body !== undefined && body !== null ? JSON.stringify(body) : "";
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Capture the URL that fetch was called with
function captureUrl(): { url: string | null; init: RequestInit | null } {
  const ref: { url: string | null; init: RequestInit | null } = { url: null, init: null };
  vi.mocked(fetch).mockImplementation((input, init?) => {
    ref.url = typeof input === "string" ? input : (input as Request).url;
    ref.init = init ?? null;
    return Promise.resolve(makeResponse({ data: [], pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 } }));
  });
  return ref;
}

describe("logsApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("list", () => {
    it("builds correct URL with no params", async () => {
      const ref = captureUrl();
      await logsApi.list("proj-1", {});
      expect(ref.url).toContain("/api/v1/projects/proj-1/logs");
    });

    it("builds correct URL with level filter", async () => {
      const ref = captureUrl();
      await logsApi.list("proj-1", { level: "error", page: 1, per_page: 50 });
      expect(ref.url).toContain("level=error");
      expect(ref.url).toContain("page=1");
      expect(ref.url).toContain("per_page=50");
    });

    it("builds correct URL with search filter", async () => {
      const ref = captureUrl();
      await logsApi.list("proj-1", { search: "NullPointerException" });
      expect(ref.url).toContain("search=NullPointerException");
    });

    it("builds correct URL with attribute filter", async () => {
      const ref = captureUrl();
      await logsApi.list("proj-1", { "attribute.region": "us-east-1" });
      expect(ref.url).toContain("attribute.region=us-east-1");
    });

    it("omits undefined params from URL", async () => {
      const ref = captureUrl();
      await logsApi.list("proj-1", { level: undefined, search: undefined, page: 2 });
      expect(ref.url).not.toContain("level=");
      expect(ref.url).not.toContain("search=");
      expect(ref.url).toContain("page=2");
    });

    it("encodes special characters in search", async () => {
      const ref = captureUrl();
      await logsApi.list("proj-1", { search: "hello world & more" });
      // URLSearchParams encodes spaces as + or %20
      expect(ref.url).toMatch(/search=hello/);
    });
  });

  describe("getStats", () => {
    it("builds correct URL with all params", async () => {
      vi.mocked(fetch).mockResolvedValue(makeResponse({ buckets: [], total: 0 }));
      const start = "2024-01-01T00:00:00Z";
      const end = "2024-01-01T01:00:00Z";
      let capturedUrl = "";
      vi.mocked(fetch).mockImplementation((input) => {
        capturedUrl = typeof input === "string" ? input : (input as Request).url;
        return Promise.resolve(makeResponse({ buckets: [], total: 0 }));
      });
      await logsApi.getStats("proj-1", start, end, "5m");
      expect(capturedUrl).toContain("/api/v1/projects/proj-1/logs/stats");
      expect(capturedUrl).toContain("interval=5m");
    });
  });

  describe("getFacets", () => {
    it("builds URL without key param when key is omitted", async () => {
      let capturedUrl = "";
      vi.mocked(fetch).mockImplementation((input) => {
        capturedUrl = typeof input === "string" ? input : (input as Request).url;
        return Promise.resolve(makeResponse({ keys: [], values: [] }));
      });
      await logsApi.getFacets("proj-1");
      expect(capturedUrl).toContain("/api/v1/projects/proj-1/logs/facets");
      expect(capturedUrl).not.toContain("key=");
    });

    it("builds URL with key param when provided", async () => {
      let capturedUrl = "";
      vi.mocked(fetch).mockImplementation((input) => {
        capturedUrl = typeof input === "string" ? input : (input as Request).url;
        return Promise.resolve(makeResponse({ keys: [], values: [] }));
      });
      await logsApi.getFacets("proj-1", "region");
      expect(capturedUrl).toContain("key=region");
    });
  });
});

describe("logSavedSearchesApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list builds correct URL", async () => {
    let capturedUrl = "";
    vi.mocked(fetch).mockImplementation((input) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      return Promise.resolve(makeResponse({ data: [] }));
    });
    await logSavedSearchesApi.list("proj-1");
    expect(capturedUrl).toContain("/api/v1/projects/proj-1/log-saved-searches");
  });

  it("create sends POST with name and filters", async () => {
    const captured: { init: RequestInit | null } = { init: null };
    vi.mocked(fetch).mockImplementation((_, init?) => {
      captured.init = init ?? null;
      return Promise.resolve(makeResponse({ data: { id: "1", name: "test", filters: {}, created_at: "" } }));
    });
    await logSavedSearchesApi.create("proj-1", "My Search", { level: "error" });
    const opts = captured.init as RequestInit;
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as { name: string; filters: { level: string } };
    expect(body.name).toBe("My Search");
    expect(body.filters).toEqual({ level: "error" });
  });

  it("delete sends DELETE to correct URL", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    vi.mocked(fetch).mockImplementation((input, init?) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      capturedMethod = (init?.method ?? "GET").toUpperCase();
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    await logSavedSearchesApi.delete("proj-1", "search-123");
    expect(capturedUrl).toContain("/api/v1/projects/proj-1/log-saved-searches/search-123");
    expect(capturedMethod).toBe("DELETE");
  });
});

describe("logAlertRulesApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list builds correct URL", async () => {
    let capturedUrl = "";
    vi.mocked(fetch).mockImplementation((input) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      return Promise.resolve(makeResponse({ data: [] }));
    });
    await logAlertRulesApi.list("proj-1");
    expect(capturedUrl).toContain("/api/v1/projects/proj-1/log-alert-rules");
  });

  it("update sends PATCH with partial rule data", async () => {
    const captured: { url: string; init: RequestInit | null } = { url: "", init: null };
    vi.mocked(fetch).mockImplementation((input, init?) => {
      captured.url = typeof input === "string" ? input : (input as Request).url;
      captured.init = init ?? null;
      return Promise.resolve(
        makeResponse({
          data: {
            id: "rule-1",
            name: "test",
            threshold: 10,
            window_seconds: 300,
            notification_type: "email",
            notification_target: "a@b.com",
            is_active: false,
            created_at: "",
          },
        })
      );
    });
    await logAlertRulesApi.update("proj-1", "rule-1", { is_active: false });
    expect(captured.url).toContain("/api/v1/projects/proj-1/log-alert-rules/rule-1");
    const opts = captured.init as RequestInit;
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body as string) as { is_active: boolean };
    expect(body.is_active).toBe(false);
  });

  it("delete sends DELETE to correct URL", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    vi.mocked(fetch).mockImplementation((input, init?) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      capturedMethod = (init?.method ?? "GET").toUpperCase();
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    await logAlertRulesApi.delete("proj-1", "rule-99");
    expect(capturedUrl).toContain("/api/v1/projects/proj-1/log-alert-rules/rule-99");
    expect(capturedMethod).toBe("DELETE");
  });
});
