import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises before importing the module under test
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import * as fsPromises from "fs/promises";
import {
  loadConfig,
  saveConfig,
  listProjects,
  listIssues,
  getIssue,
  updateIssue,
  listMonitors,
  countIssues,
} from "./api.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200, statusText = "OK") {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function paginated<T>(data: T[], total?: number) {
  return {
    data,
    pagination: {
      page: 1,
      per_page: 25,
      total: total ?? data.length,
      total_pages: 1,
    },
  };
}

// ─── Test suites ────────────────────────────────────────────────────────────

describe("loadConfig / saveConfig", () => {
  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.writeFile).mockReset();
    vi.mocked(fsPromises.mkdir).mockReset();
  });

  it("saveConfig writes JSON to the config path", async () => {
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    await saveConfig({ apiKey: "bw_test_key", url: "https://example.com" });

    expect(fsPromises.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(".bugwatch"),
      { recursive: true }
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.stringContaining('"apiKey": "bw_test_key"'),
      "utf-8"
    );
  });

  it("loadConfig reads and parses the config file", async () => {
    const configData = { apiKey: "bw_saved_key", url: "https://api.test.dev" };
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      JSON.stringify(configData)
    );

    const result = await loadConfig();
    expect(result).toEqual(configData);
  });

  it("loadConfig returns null when file does not exist", async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(
      new Error("ENOENT: no such file or directory")
    );

    const result = await loadConfig();
    expect(result).toBeNull();
  });
});

describe("API method URL construction", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Ensure loadConfig returns null so it falls through to env-based auth
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    process.env.BUGWATCH_API_KEY = "bw_agent_test123";

    fetchSpy = mockFetchResponse(paginated([]));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    delete process.env.BUGWATCH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("listProjects calls GET /api/v1/projects", async () => {
    await listProjects();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/projects");
    expect(opts.method).toBe("GET");
  });

  it('listIssues("proj1") calls GET /api/v1/projects/proj1/issues', async () => {
    await listIssues("proj1");

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/projects/proj1/issues");
    expect(opts.method).toBe("GET");
  });

  it("listIssues(undefined) calls GET /api/v1/issues/across-projects", async () => {
    await listIssues(undefined);

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/issues/across-projects");
    expect(opts.method).toBe("GET");
  });

  it('getIssue("issue1", "proj1") calls GET /api/v1/projects/proj1/issues/issue1', async () => {
    fetchSpy = mockFetchResponse({ data: { id: "issue1" } });
    vi.stubGlobal("fetch", fetchSpy);

    await getIssue("issue1", "proj1");

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/projects/proj1/issues/issue1");
    expect(opts.method).toBe("GET");
  });

  it("updateIssue calls PATCH /api/v1/projects/proj1/issues/issue1", async () => {
    fetchSpy = mockFetchResponse({ data: { id: "issue1", status: "resolved" } });
    vi.stubGlobal("fetch", fetchSpy);

    await updateIssue("issue1", "proj1", { status: "resolved" });

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/projects/proj1/issues/issue1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ status: "resolved" });
  });

  it('listMonitors("proj1") calls GET /api/v1/projects/proj1/monitors', async () => {
    await listMonitors("proj1");

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/projects/proj1/monitors");
    expect(opts.method).toBe("GET");
  });

  it("listMonitors(undefined) calls GET /api/v1/monitors/across-projects", async () => {
    fetchSpy = mockFetchResponse({ data: [] });
    vi.stubGlobal("fetch", fetchSpy);

    await listMonitors(undefined);

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/monitors/across-projects");
    expect(opts.method).toBe("GET");
  });

  it('countIssues("proj1", "unresolved") calls with status=unresolved and per_page=1', async () => {
    fetchSpy = mockFetchResponse(paginated([], 42));
    vi.stubGlobal("fetch", fetchSpy);

    await countIssues("proj1", "unresolved");

    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/api/v1/projects/proj1/issues");
    expect(url).toContain("status=unresolved");
    expect(url).toContain("per_page=1");
  });
});

describe("Response unwrapping", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    process.env.BUGWATCH_API_KEY = "bw_agent_test123";
  });

  afterEach(() => {
    delete process.env.BUGWATCH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("listProjects returns the unwrapped data array", async () => {
    const projects = [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ];
    fetchSpy = mockFetchResponse(paginated(projects, 5));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await listProjects();
    expect(result).toEqual(projects);
  });

  it("countIssues returns pagination.total", async () => {
    fetchSpy = mockFetchResponse(paginated([], 42));
    vi.stubGlobal("fetch", fetchSpy);

    const total = await countIssues("proj1");
    expect(total).toBe(42);
  });

  it("getIssue returns the unwrapped data object", async () => {
    const issue = {
      id: "i1",
      title: "NullRef",
      status: "unresolved",
      level: "error",
      count: 3,
      first_seen: "2026-01-01",
      last_seen: "2026-03-15",
    };
    fetchSpy = mockFetchResponse({ data: issue });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getIssue("i1", "proj1");
    expect(result).toEqual(issue);
  });
});

describe("Error handling", () => {
  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    process.env.BUGWATCH_API_KEY = "bw_agent_test123";
  });

  afterEach(() => {
    delete process.env.BUGWATCH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("throws an error when the API returns 401", async () => {
    const fetchSpy = mockFetchResponse("Unauthorized", 401, "Unauthorized");
    vi.stubGlobal("fetch", fetchSpy);

    await expect(listProjects()).rejects.toThrow(/API request failed: 401/);
  });

  it("throws an error when the API returns 500", async () => {
    const fetchSpy = mockFetchResponse("Internal Server Error", 500, "Internal Server Error");
    vi.stubGlobal("fetch", fetchSpy);

    await expect(listIssues("proj1")).rejects.toThrow(/API request failed: 500/);
  });
});
