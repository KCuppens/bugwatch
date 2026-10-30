import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { uploadSourceMap } from "../utils/api";

/** Mirrors the server's MAX_SOURCE_MAP_BYTES. */
export const MAX_SOURCE_MAP_BYTES = 50 * 1024 * 1024;

export interface SourcemapsUploadOptions {
  release: string;
  dist?: string;
  bundle?: string;
  dir?: string;
  apiKey?: string;
  url?: string;
}

export interface PlannedUpload {
  file: string;
  bundle: string;
}

/**
 * `index.android.bundle.map` -> `index.android.bundle`, `main.jsbundle.map` -> `main.jsbundle`.
 */
export function bundleNameFromMapFile(file: string): string {
  const base = path.basename(file);
  return base.endsWith(".map") ? base.slice(0, -".map".length) : base;
}

/**
 * Find every `*.map` file below `dir`, skipping node_modules and symlinks. Sorted for stable output.
 */
export async function collectSourceMaps(dir: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") pending.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".map")) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

/**
 * Upload requires a project SDK key. Agent keys (bw_agent_...) are rejected by the server, so fail early.
 */
export function resolveProjectKey(flag?: string): string {
  const key = flag || process.env.BUGWATCH_API_KEY;
  if (!key) {
    throw new Error("Project API key required. Provide via --api-key or the BUGWATCH_API_KEY env var.");
  }
  if (key.startsWith("bw_agent_")) {
    throw new Error(
      "Source map upload needs the project API key (bw_live_...), not an agent key. " +
        "Provide it via --api-key or the BUGWATCH_API_KEY env var."
    );
  }
  return key;
}

export async function planUploads(
  mapPath: string | undefined,
  options: Pick<SourcemapsUploadOptions, "bundle" | "dir">
): Promise<PlannedUpload[]> {
  if (options.dir) {
    if (mapPath) throw new Error("Pass either a source map path or --dir, not both.");
    if (options.bundle) {
      throw new Error("--bundle cannot be used with --dir; bundle names are derived from the *.map file names.");
    }
    const files = await collectSourceMaps(options.dir);
    if (files.length === 0) throw new Error(`No *.map files found in ${options.dir}`);
    return files.map((file) => ({ file, bundle: bundleNameFromMapFile(file) }));
  }

  if (!mapPath) throw new Error("Provide the path to a source map file, or use --dir <directory>.");
  if (!options.bundle) throw new Error("--bundle <name> is required (e.g. index.android.bundle or main.jsbundle).");
  return [{ file: mapPath, bundle: options.bundle }];
}

async function readSourceMap(file: string): Promise<Uint8Array> {
  const { size } = await fs.stat(file);
  if (size > MAX_SOURCE_MAP_BYTES) {
    throw new Error(`${file} is ${size} bytes; the limit is ${MAX_SOURCE_MAP_BYTES} bytes`);
  }
  return fs.readFile(file);
}

/**
 * `bugwatch sourcemaps upload` - upload source maps for server-side symbolication.
 */
export async function sourcemapsUploadCommand(
  mapPath: string | undefined,
  options: SourcemapsUploadOptions
): Promise<void> {
  let uploads: PlannedUpload[];
  let apiKey: string;
  try {
    apiKey = resolveProjectKey(options.apiKey);
    uploads = await planUploads(mapPath, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }

  const failures: string[] = [];
  const dist = options.dist ?? "";

  for (const { file, bundle } of uploads) {
    const spinner = ora(`Uploading ${file} as ${bundle}...`).start();
    try {
      const sourcemap = await readSourceMap(file);
      const meta = await uploadSourceMap({
        apiKey,
        baseUrl: options.url,
        release: options.release,
        dist,
        bundle,
        sourcemap,
      });
      spinner.succeed(
        `${bundle} (release ${meta.release}${meta.dist ? `, dist ${meta.dist}` : ""}, ${meta.size} bytes)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(`${file}: ${message}`);
      failures.push(file);
    }
  }

  if (failures.length > 0) {
    console.log(chalk.red(`\n  ${failures.length} of ${uploads.length} upload(s) failed.\n`));
    process.exit(1);
  }

  console.log(chalk.green(`\n  Uploaded ${uploads.length} source map(s) for release ${options.release}.\n`));
}
