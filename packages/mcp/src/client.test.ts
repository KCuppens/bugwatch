import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BugwatchClient } from "./client.js";

// Helper to create a mock fetch response
function mockFetchResponse(data: unknown, status = 200, statusText = "OK") {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe("BugwatchClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear any previous fetch mock
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ─── Constructor ───────────────────────────────────────────────

  describe("constructor", () => {
    it("throws when BUGWATCH_API_KEY is not set", () => {
      delete process.env.BUGWATCH_API_KEY;
      expect(() => new BugwatchClient()).toThrowError(
        "BUGWATCH_API_KEY environment variable is required"
      );
    });

    it("uses default URL when BUGWATCH_URL is not set", async () => {
      process.env.BUGWATCH_API_KEY = "test-key";
      delete process.env.BUGWATCH_URL;

      const mockFetch = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal("fetch", mockFetch);

      const client = new BugwatchClient();
      await client.listProjects();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toMatch(/^https:\/\/api\.bugwatch\.dev/);
    });

    it("strips trailing slashes from URL", async () => {
      process.env.BUGWATCH_API_KEY = "test-key";
      process.env.BUGWATCH_URL = "https://custom.example.com///";

      const mockFetch = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal("fetch", mockFetch);

      const client = new BugwatchClient();
      await client.listProjects();

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toBe(
        "https://custom.example.com/api/v1/projects"
      );
    });
  });

  // ─── URL building / query string ──────────────────────────────

  describe("URL building", () => {
    let client: BugwatchClient;

    beforeEach(() => {
      process.env.BUGWATCH_API_KEY = "test-key";
      process.env.BUGWATCH_URL = "https://api.test.dev";
    });

    it("appends query parameters for listProjects", async () => {
      const mockFetch = mockFetchResponse({
        data: [],
        pagination: { page: 2, per_page: 10, total: 0, total_pages: 0 },
      });
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      await client.listProjects(2, 10);

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain("page=2");
      expect(calledUrl).toContain("per_page=10");
    });

    it("omits undefined query parameters", async () => {
      const mockFetch = mockFetchResponse({
        data: [],
        pagination: { page: 1, per_page: 20, total: 0, total_pages: 0 },
      });
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      await client.listProjects();

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      // No query string at all when no params supplied
      expect(calledUrl).toBe("https://api.test.dev/api/v1/projects");
    });

    it("builds correct path for nested resources", async () => {
      const mockFetch = mockFetchResponse({ data: {} });
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      await client.getIssue("proj-1", "issue-2");

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toBe(
        "https://api.test.dev/api/v1/projects/proj-1/issues/issue-2"
      );
    });
  });

  // ─── API method request construction ──────────────────────────

  describe("API methods", () => {
    let client: BugwatchClient;

    beforeEach(() => {
      process.env.BUGWATCH_API_KEY = "test-key";
      process.env.BUGWATCH_URL = "https://api.test.dev";
    });

    it("listProjects() calls GET /api/v1/projects", async () => {
      const payload = {
        data: [{ id: "p1", name: "My Project" }],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      };
      const mockFetch = mockFetchResponse(payload);
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      const result = await client.listProjects();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://api.test.dev/api/v1/projects");
      // Default method is GET (no explicit method set)
      expect(opts.method).toBeUndefined();
      expect(result).toEqual(payload);
    });

    it("getProject() returns ApiResponse with .data", async () => {
      const payload = {
        data: { id: "p1", name: "My Project", slug: "my-project" },
      };
      const mockFetch = mockFetchResponse(payload);
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      const result = await client.getProject("p1");

      expect(result).toHaveProperty("data");
      expect(result.data.id).toBe("p1");

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toBe("https://api.test.dev/api/v1/projects/p1");
    });

    it("searchIssues() calls POST /api/v1/projects/{id}/issues/_search with correct body", async () => {
      const payload = {
        data: [],
        pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
      };
      const mockFetch = mockFetchResponse(payload);
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      await client.searchIssues("proj-1", "TypeError", {
        status: "unresolved",
        level: "error",
      });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        "https://api.test.dev/api/v1/projects/proj-1/issues/_search"
      );
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.filters.text).toBe("TypeError");
      expect(body.filters.status).toEqual(["unresolved"]);
      expect(body.filters.level).toEqual(["error"]);
      expect(body.per_page).toBe(50);
    });

    it("updateIssue() calls PATCH", async () => {
      const payload = { data: { id: "i1", status: "resolved" } };
      const mockFetch = mockFetchResponse(payload);
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      await client.updateIssue("proj-1", "i1", { status: "resolved" });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        "https://api.test.dev/api/v1/projects/proj-1/issues/i1"
      );
      expect(opts.method).toBe("PATCH");

      const body = JSON.parse(opts.body);
      expect(body.status).toBe("resolved");
    });

    it("createMonitor() calls POST", async () => {
      const monitorData = {
        name: "Health Check",
        url: "https://example.com/health",
        method: "GET",
        interval_seconds: 60,
      };
      const payload = { id: "m1", ...monitorData, project_id: "proj-1" };
      const mockFetch = mockFetchResponse(payload);
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      await client.createMonitor("proj-1", monitorData);

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        "https://api.test.dev/api/v1/projects/proj-1/monitors"
      );
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.name).toBe("Health Check");
      expect(body.url).toBe("https://example.com/health");
    });

    it("listAlerts() returns raw array (not wrapped in ApiResponse)", async () => {
      const payload = [
        { id: "a1", name: "High error rate", condition: "error_rate > 10" },
      ];
      const mockFetch = mockFetchResponse(payload);
      vi.stubGlobal("fetch", mockFetch);

      client = new BugwatchClient();
      const result = await client.listAlerts("proj-1");

      // Returns array directly, not { data: [...] }
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]!.id).toBe("a1");

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toBe(
        "https://api.test.dev/api/v1/projects/proj-1/alerts"
      );
    });
  });

  // ─── Request headers ──────────────────────────────────────────

  describe("request headers", () => {
    it("sends X-API-Key and Content-Type headers", async () => {
      process.env.BUGWATCH_API_KEY = "my-secret-key";
      process.env.BUGWATCH_URL = "https://api.test.dev";

      const mockFetch = mockFetchResponse({ data: [], pagination: {} });
      vi.stubGlobal("fetch", mockFetch);

      const client = new BugwatchClient();
      await client.listProjects();

      const opts = mockFetch.mock.calls[0]![1];
      expect(opts.headers["X-API-Key"]).toBe("my-secret-key");
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });
  });

  // ─── Error handling ────────────────────────────────────────────

  describe("error handling", () => {
    it("throws on non-OK response with status info", async () => {
      process.env.BUGWATCH_API_KEY = "test-key";
      process.env.BUGWATCH_URL = "https://api.test.dev";

      const mockFetch = mockFetchResponse(
        { error: "Not found" },
        404,
        "Not Found"
      );
      vi.stubGlobal("fetch", mockFetch);

      const client = new BugwatchClient();
      await expect(client.getProject("bad-id")).rejects.toThrowError(
        /Bugwatch API error 404 Not Found/
      );
    });
  });
});
