import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

vi.mock("ora", () => ({
  default: () => {
    const spinner = { start: () => spinner, succeed: vi.fn(), fail: vi.fn() };
    return spinner;
  },
}));

const uploadSourceMap = vi.fn();
vi.mock("../utils/api", () => ({ uploadSourceMap: (...args: unknown[]) => uploadSourceMap(...args) }));

import {
  bundleNameFromMapFile,
  collectSourceMaps,
  planUploads,
  resolveProjectKey,
  sourcemapsUploadCommand,
} from "./sourcemaps";

describe("bundleNameFromMapFile", () => {
  it("strips the .map suffix", () => {
    expect(bundleNameFromMapFile("/out/index.android.bundle.map")).toBe("index.android.bundle");
    expect(bundleNameFromMapFile("main.jsbundle.map")).toBe("main.jsbundle");
    expect(bundleNameFromMapFile("_expo/static/js/android/index-abc123.hbc.map")).toBe("index-abc123.hbc");
  });
});

describe("resolveProjectKey", () => {
  afterEach(() => {
    delete process.env.BUGWATCH_API_KEY;
  });

  it("prefers the flag over the env var", () => {
    process.env.BUGWATCH_API_KEY = "bw_live_env";
    expect(resolveProjectKey("bw_live_flag")).toBe("bw_live_flag");
    expect(resolveProjectKey()).toBe("bw_live_env");
  });

  it("throws without a key", () => {
    expect(() => resolveProjectKey()).toThrow(/Project API key required/);
  });

  it("rejects agent keys", () => {
    expect(() => resolveProjectKey("bw_agent_abc")).toThrow(/not an agent key/);
  });
});

describe("collect and plan", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "bw-sm-"));
    await fs.mkdir(path.join(dir, "android"), { recursive: true });
    await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(dir, "android", "index.android.bundle.map"), "{}");
    await fs.writeFile(path.join(dir, "main.jsbundle.map"), "{}");
    await fs.writeFile(path.join(dir, "main.jsbundle"), "bundle");
    await fs.writeFile(path.join(dir, "node_modules", "pkg", "x.js.map"), "{}");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("collects *.map files recursively and skips node_modules", async () => {
    const files = await collectSourceMaps(dir);
    expect(files.map((f) => path.relative(dir, f))).toEqual([
      path.join("android", "index.android.bundle.map"),
      "main.jsbundle.map",
    ]);
  });

  it("plans --dir uploads with derived bundle names", async () => {
    const plan = await planUploads(undefined, { dir });
    expect(plan.map((p) => p.bundle)).toEqual(["index.android.bundle", "main.jsbundle"]);
  });

  it("rejects --dir combined with --bundle or a path", async () => {
    await expect(planUploads(undefined, { dir, bundle: "x" })).rejects.toThrow(/--bundle cannot be used/);
    await expect(planUploads("a.map", { dir })).rejects.toThrow(/either/);
  });

  it("rejects a --dir without maps", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "bw-sm-empty-"));
    await expect(planUploads(undefined, { dir: empty })).rejects.toThrow(/No \*\.map files/);
    await fs.rm(empty, { recursive: true, force: true });
  });

  it("requires a path and --bundle in single-file mode", async () => {
    await expect(planUploads(undefined, {})).rejects.toThrow(/path to a source map/);
    await expect(planUploads("a.map", {})).rejects.toThrow(/--bundle <name> is required/);
    await expect(planUploads("a.map", { bundle: "index.android.bundle" })).resolves.toEqual([
      { file: "a.map", bundle: "index.android.bundle" },
    ]);
  });

  it("uploads every map in --dir mode with release, dist and key", async () => {
    uploadSourceMap.mockReset();
    uploadSourceMap.mockResolvedValue({ release: "1.0.0", dist: "7", size: 2 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await sourcemapsUploadCommand(undefined, { release: "1.0.0", dist: "7", dir, apiKey: "bw_live_k", url: "https://x.test" });

    expect(uploadSourceMap).toHaveBeenCalledTimes(2);
    const first = uploadSourceMap.mock.calls[0]![0];
    expect(first).toMatchObject({
      apiKey: "bw_live_k",
      baseUrl: "https://x.test",
      release: "1.0.0",
      dist: "7",
      bundle: "index.android.bundle",
    });
    expect(Buffer.from(first.sourcemap).toString()).toBe("{}");
    log.mockRestore();
  });

  it("exits non-zero when any upload fails", async () => {
    uploadSourceMap.mockReset();
    uploadSourceMap.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ release: "1", dist: "", size: 2 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await sourcemapsUploadCommand(undefined, { release: "1", dir, apiKey: "bw_live_k" });

    expect(uploadSourceMap).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(1);
    log.mockRestore();
    exit.mockRestore();
  });
});
