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
  uploadSourceMap,
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
      { encoding: "utf-8", mode: 0o600 }
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

    await expect(listProjects()).rejects.toThrow(/Request failed \(401\)/);
  });

  it("throws an error when the API returns 500", async () => {
    const fetchSpy = mockFetchResponse("Internal Server Error", 500, "Internal Server Error");
    vi.stubGlobal("fetch", fetchSpy);

    await expect(listIssues("proj1")).rejects.toThrow(/Request failed \(500\)/);
  });
});

describe("uploadSourceMap", () => {
  const params = {
    apiKey: "bw_live_projectkey",
    release: "1.2.3",
    dist: "42",
    bundle: "index.android.bundle",
    sourcemap: new TextEncoder().encode('{"version":3}'),
  };

  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    delete process.env.BUGWATCH_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs multipart form data to /api/v1/sourcemaps with the project key", async () => {
    const meta = { id: "sm1", release: "1.2.3", dist: "42", bundle: "index.android.bundle", size: 13 };
    const fetchSpy = mockFetchResponse({ data: meta });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await uploadSourceMap({ ...params, baseUrl: "https://bw.example.com" });

    expect(result).toEqual(meta);
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://bw.example.com/api/v1/sourcemaps");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-API-Key"]).toBe("bw_live_projectkey");
    expect(opts.headers["Content-Type"]).toBeUndefined();
    const form = opts.body as FormData;
    expect(form.get("release")).toBe("1.2.3");
    expect(form.get("dist")).toBe("42");
    expect(form.get("bundle")).toBe("index.android.bundle");
    const file = form.get("sourcemap") as File;
    expect(await file.text()).toBe('{"version":3}');
  });

  it("omits dist when empty", async () => {
    const fetchSpy = mockFetchResponse({ data: {} });
    vi.stubGlobal("fetch", fetchSpy);

    await uploadSourceMap({ ...params, dist: "", baseUrl: "https://bw.example.com" });

    const form = fetchSpy.mock.calls[0]![1].body as FormData;
    expect(form.has("dist")).toBe(false);
  });

  it("surfaces the server error message and does not retry 4xx", async () => {
    const fetchSpy = mockFetchResponse({ error: { code: "validation", message: "not a valid source map" } }, 422, "Unprocessable");
    vi.stubGlobal("fetch", fetchSpy);

    await expect(uploadSourceMap({ ...params, baseUrl: "https://bw.example.com" })).rejects.toThrow(
      "not a valid source map"
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("retries 5xx responses", async () => {
    const fail = { ok: false, status: 503, statusText: "Unavailable", text: () => Promise.resolve("") };
    const ok = { ok: true, status: 200, statusText: "OK", json: () => Promise.resolve({ data: { id: "sm1" } }) };
    const fetchSpy = vi.fn().mockResolvedValueOnce(fail).mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await uploadSourceMap({ ...params, baseUrl: "https://bw.example.com" });
    expect(result).toEqual({ id: "sm1" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects non-http base URLs", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(uploadSourceMap({ ...params, baseUrl: "file:///etc/passwd" })).rejects.toThrow(/only http and https/);
  });
});
