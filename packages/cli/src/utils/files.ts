import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { ProjectInfo, PackageManager } from "./detect";
import {
  getInstrumentationTemplate,
  getAppErrorTemplate,
  getGlobalErrorTemplate,
  getPagesErrorTemplate,
  getFileExtension,
} from "./templates";

const execAsync = promisify(exec);

/**
 * Install a package using the detected package manager
 */
export async function installPackage(
  packageName: string,
  pm: PackageManager,
  cwd: string
): Promise<void> {
  let command: string;

  switch (pm) {
    case "bun":
      command = `bun add ${packageName}`;
      break;
    case "pnpm":
      command = `pnpm add ${packageName}`;
      break;
    case "yarn":
      command = `yarn add ${packageName}`;
      break;
    case "npm":
    default:
      command = `npm install ${packageName}`;
  }

  await execAsync(command, { cwd });
}

/**
 * Create the instrumentation.ts file
 */
export async function createInstrumentationFile(
  project: ProjectInfo
): Promise<string> {
  const ext = getFileExtension(project, false);
  const filename = `instrumentation.${ext}`;

  // Place in src/ if the project uses src directory
  const filePath = project.hasSrcDir
    ? path.join(project.rootDir, "src", filename)
    : path.join(project.rootDir, filename);

  const content = getInstrumentationTemplate(project);

  await fs.writeFile(filePath, content, "utf-8");

  return filePath;
}

/**
 * Create error boundary files for the appropriate router
 */
export async function createErrorFiles(
  project: ProjectInfo
): Promise<string[]> {
  const createdFiles: string[] = [];

  // App Router error files
  if (project.routerType === "app" || project.routerType === "both") {
    if (project.appDir) {
      const ext = getFileExtension(project, true);

      // Create app/error.tsx
      const errorPath = path.join(project.appDir, `error.${ext}`);
      if (!(await fileExists(errorPath))) {
        await fs.writeFile(errorPath, getAppErrorTemplate(project), "utf-8");
        createdFiles.push(errorPath);
      }

      // Create app/global-error.tsx
      const globalErrorPath = path.join(project.appDir, `global-error.${ext}`);
      if (!(await fileExists(globalErrorPath))) {
        await fs.writeFile(
          globalErrorPath,
          getGlobalErrorTemplate(project),
          "utf-8"
        );
        createdFiles.push(globalErrorPath);
      }
    }
  }

  // Pages Router error file
  if (project.routerType === "pages" || project.routerType === "both") {
    if (project.pagesDir) {
      const ext = getFileExtension(project, true);
      const errorPath = path.join(project.pagesDir, `_error.${ext}`);

      if (!(await fileExists(errorPath))) {
        await fs.writeFile(errorPath, getPagesErrorTemplate(project), "utf-8");
        createdFiles.push(errorPath);
      }
    }
  }

  return createdFiles;
}

/**
 * Update .env.local with the DSN
 */
export async function updateEnvFile(
  dsn: string,
  rootDir: string
): Promise<void> {
  const envPath = path.join(rootDir, ".env.local");
  const envVar = `NEXT_PUBLIC_BUGWATCH_DSN=${dsn}`;

  let content = "";

  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    // File doesn't exist, create it
  }

  // Check if DSN is already set
  if (content.includes("NEXT_PUBLIC_BUGWATCH_DSN=")) {
    // Replace existing value
    content = content.replace(
      /NEXT_PUBLIC_BUGWATCH_DSN=.*/,
      envVar
    );
  } else {
    // Append to file
    if (content && !content.endsWith("\n")) {
      content += "\n";
    }
    content += envVar + "\n";
  }

  await fs.writeFile(envPath, content, "utf-8");
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
 * Ensure a directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory already exists
  }
}

/**
 * Read a file if it exists, return null otherwise
 */
export async function readFileIfExists(
  filePath: string
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
