import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BugwatchClient } from "../client.js";
import { handleIssueTool, issueToolDefinitions } from "./issues.js";

function mockFetchResponse(data: unknown, status = 200, statusText = "OK") {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

const sampleEvent = {
  id: "evt-1",
  issue_id: "issue-1",
  project_id: "proj-1",
  title: "TypeError: cannot read property 'name' of undefined",
  level: "error",
  message: "TypeError: cannot read property 'name' of undefined",
  timestamp: "2026-09-17T10:00:00Z",
  environment: "production",
  release: "v1.2.3",
  platform: "node",
  sdk: { name: "@bugwatch/node", version: "0.4.0" },
  stacktrace: {
    frames: [
      {
        filename: "node_modules/express/lib/router.js",
        function: "handle",
        lineno: 100,
        in_app: false,
      },
      {
        filename: "src/handlers/user.ts",
        function: "getUser",
        lineno: 42,
        colno: 17,
        in_app: true,
        pre_context: ["export function getUser(req) {", "  const id = req.params.id;"],
        context_line: "  return db.users[id].name;",
        post_context: ["}", ""],
      },
    ],
  },
  request: { url: "https://api.example.com/users/7", method: "GET" },
  user: { id: "u-7", email: "user@example.com" },
  tags: { server_name: "web-1" },
};

describe("issue tools", () => {
  const originalEnv = process.env;
  let client: BugwatchClient;

  beforeEach(() => {
    process.env = { ...originalEnv, BUGWATCH_API_KEY: "test-key", BUGWATCH_URL: "https://api.test.dev" };
    vi.restoreAllMocks();
    client = new BugwatchClient();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("exposes get_issue and get_event tool definitions", () => {
    const names = issueToolDefinitions.map((t) => t.name);
    expect(names).toContain("get_issue");
    expect(names).toContain("get_event");
  });

  describe("get_issue", () => {
    it("fetches the issue and renders a diagnostic with in-app frames and source context", async () => {
      const mockFetch = mockFetchResponse({
        data: {
          id: "issue-1",
          project_id: "proj-1",
          title: sampleEvent.title,
          level: "error",
          status: "unresolved",
          first_seen: "2026-09-10T00:00:00Z",
          last_seen: "2026-09-17T10:00:00Z",
          count: 12,
          user_count: 4,
          latest_event: sampleEvent,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool("get_issue", { projectId: "proj-1", issueId: "issue-1" }, client);

      expect(res.isError).toBeFalsy();
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe("https://api.test.dev/api/v1/projects/proj-1/issues/issue-1");

      const text = res.content[0]!.text;
      // Issue summary
      expect(text).toContain("Issue issue-1");
      expect(text).toContain("events=12");
      // In-app frame with location + crash marker + source context
      expect(text).toContain("src/handlers/user.ts:42:17");
      expect(text).toContain("> "); // crash line marker
      expect(text).toContain("return db.users[id].name;");
      // Non-in-app frame is filtered out when in-app frames exist
      expect(text).not.toContain("express/lib/router.js");
      // Metadata
      expect(text).toContain("environment: production");
      expect(text).toContain("release: v1.2.3");
      expect(text).toContain("GET https://api.example.com/users/7");
    });

    it("handles issues without an event payload", async () => {
      const mockFetch = mockFetchResponse({
        data: {
          id: "issue-2",
          project_id: "proj-1",
          title: "Some issue",
          level: "warning",
          status: "unresolved",
          first_seen: "2026-09-10T00:00:00Z",
          last_seen: "2026-09-17T10:00:00Z",
          count: 1,
          user_count: 1,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool("get_issue", { projectId: "proj-1", issueId: "issue-2" }, client);
      expect(res.isError).toBeFalsy();
      expect(res.content[0]!.text).toContain("No event payload");
    });
  });

  describe("get_event", () => {
    it("fetches a specific event and renders its diagnostic", async () => {
      const mockFetch = mockFetchResponse({ data: sampleEvent });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool(
        "get_event",
        { projectId: "proj-1", issueId: "issue-1", eventId: "evt-1" },
        client
      );

      expect(res.isError).toBeFalsy();
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe("https://api.test.dev/api/v1/projects/proj-1/issues/issue-1/events/evt-1");

      const text = res.content[0]!.text;
      expect(text).toContain("src/handlers/user.ts:42:17");
      expect(text).toContain("event_id: evt-1");
    });
  });

  describe("search_issues pagination", () => {
    it("passes page/perPage to a single-page search and returns pagination meta", async () => {
      const mockFetch = mockFetchResponse({
        data: [{ id: "i1", title: "boom", level: "error", status: "unresolved", count: 3, first_seen: "", last_seen: "" }],
        pagination: { page: 2, per_page: 25, total: 40, total_pages: 2 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool(
        "search_issues",
        { projectId: "proj-1", query: "boom", page: 2, perPage: 25 },
        client
      );

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.page).toBe(2);
      expect(body.per_page).toBe(25);

      const parsed = JSON.parse(res.content[0]!.text);
      expect(parsed.total).toBe(40);
      expect(parsed.total_pages).toBe(2);
      expect(parsed.issues).toHaveLength(1);
    });

    it("all=true walks every page and aggregates results", async () => {
      const makeIssues = (n: number, offset: number) =>
        Array.from({ length: n }, (_, i) => ({
          id: `i${offset + i}`,
          title: "t",
          level: "error",
          status: "unresolved",
          count: 1,
          first_seen: "",
          last_seen: "",
        }));

      let call = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        call++;
        const isFirst = call === 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve({
              data: isFirst ? makeIssues(100, 0) : makeIssues(50, 100),
              pagination: { page: call, per_page: 100, total: 150, total_pages: 2 },
            }),
          text: () => Promise.resolve("{}"),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool("search_issues", { projectId: "proj-1", all: true }, client);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Uses max page size when aggregating
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body).per_page).toBe(100);

      const parsed = JSON.parse(res.content[0]!.text);
      expect(parsed.total).toBe(150);
      expect(parsed.returned).toBe(150);
      expect(parsed.truncated).toBe(false);
      expect(parsed.issues).toHaveLength(150);
    });
  });

  describe("resolve_issues (bulk)", () => {
    it("resolves an explicit list of issue IDs and reports a summary", async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string, opts: { method?: string }) => {
        expect(opts.method).toBe("PATCH");
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ data: { id: "x", status: "resolved" } }),
          text: () => Promise.resolve("{}"),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool(
        "resolve_issues",
        { projectId: "proj-1", issueIds: ["a", "b", "c"] },
        client
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const parsed = JSON.parse(res.content[0]!.text);
      expect(parsed.requested).toBe(3);
      expect(parsed.resolved).toBe(3);
      expect(parsed.failed).toBe(0);
      expect(parsed.resolved_ids).toEqual(expect.arrayContaining(["a", "b", "c"]));
    });

    it("all=true selects unresolved issues via search then resolves them", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        const isSearch = url.endsWith("/issues/_search");
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve(
              isSearch
                ? {
                    data: [
                      { id: "u1", title: "t", level: "error", status: "unresolved", count: 1, first_seen: "", last_seen: "" },
                      { id: "u2", title: "t", level: "error", status: "unresolved", count: 1, first_seen: "", last_seen: "" },
                    ],
                    pagination: { page: 1, per_page: 100, total: 2, total_pages: 1 },
                  }
                : { data: { id: "x", status: "resolved" } }
            ),
          text: () => Promise.resolve("{}"),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool("resolve_issues", { projectId: "proj-1", all: true }, client);

      // 1 search + 2 patches
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const searchBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(searchBody.filters.status).toEqual(["unresolved"]);

      const parsed = JSON.parse(res.content[0]!.text);
      expect(parsed.resolved).toBe(2);
    });

    it("rejects when both issueIds and all are provided", async () => {
      const res = await handleIssueTool(
        "resolve_issues",
        { projectId: "proj-1", issueIds: ["a"], all: true },
        client
      );
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("not both");
    });

    it("rejects when neither issueIds nor all is provided", async () => {
      const res = await handleIssueTool("resolve_issues", { projectId: "proj-1" }, client);
      expect(res.isError).toBe(true);
    });

    it("reports partial failures without erroring the whole batch", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        const fail = url.endsWith("/issues/b");
        return Promise.resolve({
          ok: !fail,
          status: fail ? 500 : 200,
          statusText: fail ? "Server Error" : "OK",
          json: () => Promise.resolve({ data: { id: "x", status: "resolved" } }),
          text: () => Promise.resolve('{"error":"boom"}'),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await handleIssueTool(
        "resolve_issues",
        { projectId: "proj-1", issueIds: ["a", "b"] },
        client
      );

      const parsed = JSON.parse(res.content[0]!.text);
      expect(parsed.resolved).toBe(1);
      expect(parsed.failed).toBe(1);
      expect(parsed.failures[0].id).toBe("b");
      expect(res.isError).toBeFalsy();
    });
  });

  it("returns an error result when the API fails", async () => {
    const mockFetch = mockFetchResponse({ error: "not found" }, 404, "Not Found");
    vi.stubGlobal("fetch", mockFetch);

    const res = await handleIssueTool("get_issue", { projectId: "proj-1", issueId: "missing" }, client);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("Error:");
  });
});
