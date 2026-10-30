import { describe, it, expect, vi, afterEach } from "vitest";
import { BugwatchClient } from "../client.js";
import { handleProjectTool } from "./projects.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("create_project", () => {
  it("POSTs the project and returns the full api key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () =>
        Promise.resolve({ data: { id: "p1", name: "Tilde", slug: "tilde-1", api_key: "bw_live_full" } }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new BugwatchClient({ apiKey: "k", baseUrl: "https://x.test" });

    const result = await handleProjectTool(
      "create_project",
      { name: " Tilde ", platform: "react-native", framework: "expo" },
      client
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.test/api/v1/projects");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Tilde", platform: "react-native", framework: "expo" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("bw_live_full");
  });

  it("rejects a blank name without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new BugwatchClient({ apiKey: "k", baseUrl: "https://x.test" });

    const result = await handleProjectTool("create_project", { name: "  " }, client);

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
