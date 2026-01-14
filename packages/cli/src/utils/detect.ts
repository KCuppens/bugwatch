import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";

/**
 * Information about the detected project
 */
export interface ProjectInfo {
  /** Whether this is a Next.js project */
  isNextJs: boolean;
  /** Next.js version */
  nextVersion: string;
  /** Router type (app, pages, or both) */
  routerType: "app" | "pages" | "both";
  /** Whether instrumentation.ts already exists */
  hasInstrumentation: boolean;
  /** Whether the project uses a src directory */
  hasSrcDir: boolean;
  /** Whether the project uses TypeScript */
  hasTypescript: boolean;
  /** Path to the app directory (if exists) */
  appDir: string;
  /** Path to the pages directory (if exists) */
  pagesDir: string;
  /** Project root directory */
  rootDir: string;
}

/**
 * Detect project information
 */
export async function detectProject(rootDir: string): Promise<ProjectInfo> {
  const packageJsonPath = path.join(rootDir, "package.json");

  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return createEmptyProjectInfo(rootDir);
  }

  const nextVersion =
    packageJson.dependencies?.next || packageJson.devDependencies?.next || "";
  const isNextJs = Boolean(nextVersion);

  // Check for TypeScript
  const hasTypescript = await fileExists(path.join(rootDir, "tsconfig.json"));

  // Check for src directory
  const hasSrcDir = await directoryExists(path.join(rootDir, "src"));

  // Detect router type
  const baseDir = hasSrcDir ? path.join(rootDir, "src") : rootDir;
  const hasAppDir = await directoryExists(path.join(baseDir, "app"));
  const hasPagesDir = await directoryExists(path.join(baseDir, "pages"));

  let routerType: "app" | "pages" | "both" = "app";
  if (hasAppDir && hasPagesDir) routerType = "both";
  else if (hasPagesDir && !hasAppDir) routerType = "pages";

  // Check for existing instrumentation.ts
  const hasInstrumentation =
    (await fileExists(path.join(rootDir, "instrumentation.ts"))) ||
    (await fileExists(path.join(rootDir, "instrumentation.js"))) ||
    (await fileExists(path.join(rootDir, "src", "instrumentation.ts"))) ||
    (await fileExists(path.join(rootDir, "src", "instrumentation.js")));

  return {
    isNextJs,
    nextVersion: semver.coerce(nextVersion)?.version || nextVersion,
    routerType,
    hasInstrumentation,
    hasSrcDir,
    hasTypescript,
    appDir: hasAppDir ? path.join(baseDir, "app") : "",
    pagesDir: hasPagesDir ? path.join(baseDir, "pages") : "",
    rootDir,
  };
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create an empty project info object
 */
function createEmptyProjectInfo(rootDir: string): ProjectInfo {
  return {
    isNextJs: false,
    nextVersion: "",
    routerType: "app",
    hasInstrumentation: false,
    hasSrcDir: false,
    hasTypescript: false,
    appDir: "",
    pagesDir: "",
    rootDir,
  };
}

/**
 * Detect the package manager being used
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export async function detectPackageManager(
  rootDir: string
): Promise<PackageManager> {
  // Check for lock files in order of preference
  if (await fileExists(path.join(rootDir, "bun.lockb"))) {
    return "bun";
  }
  if (await fileExists(path.join(rootDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fileExists(path.join(rootDir, "yarn.lock"))) {
    return "yarn";
  }
  // Default to npm
  return "npm";
}

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(
  pm: PackageManager,
  packageName: string
): string {
  switch (pm) {
    case "bun":
      return `bun add ${packageName}`;
    case "pnpm":
      return `pnpm add ${packageName}`;
    case "yarn":
      return `yarn add ${packageName}`;
    case "npm":
    default:
      return `npm install ${packageName}`;
  }
}
