import chalk from "chalk";
import * as fs from "fs/promises";
import * as path from "path";
import { detectProject } from "../utils/detect";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

/**
 * Doctor command - check Bugwatch setup for issues
 */
export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold("\n  Bugwatch Doctor\n"));
  console.log(chalk.dim("  Checking your Bugwatch setup...\n"));

  const results: CheckResult[] = [];
  const project = await detectProject(process.cwd());

  // Check 1: Is this a Next.js project?
  if (project.isNextJs) {
    results.push({
      name: "Next.js Project",
      status: "pass",
      message: `Next.js ${project.nextVersion} detected`,
    });
  } else {
    results.push({
      name: "Next.js Project",
      status: "fail",
      message: "Not a Next.js project",
    });
    printResults(results);
    return;
  }

  // Check 2: Is @bugwatch/nextjs installed?
  const hasBugwatch = await checkPackageInstalled("@bugwatch/nextjs");
  if (hasBugwatch) {
    results.push({
      name: "@bugwatch/nextjs",
      status: "pass",
      message: "Package installed",
    });
  } else {
    results.push({
      name: "@bugwatch/nextjs",
      status: "fail",
      message: 'Not installed. Run "npx @bugwatch/cli init" to set up.',
    });
  }

  // Check 3: Is DSN set in environment?
  const hasDsn = await checkEnvVariable("NEXT_PUBLIC_BUGWATCH_DSN");
  if (hasDsn) {
    results.push({
      name: "Environment Variable",
      status: "pass",
      message: "NEXT_PUBLIC_BUGWATCH_DSN is set",
    });
  } else {
    results.push({
      name: "Environment Variable",
      status: "fail",
      message: "NEXT_PUBLIC_BUGWATCH_DSN not found in .env.local",
    });
  }

  // Check 4: Does instrumentation.ts exist?
  if (project.hasInstrumentation) {
    results.push({
      name: "Instrumentation",
      status: "pass",
      message: "instrumentation.ts exists",
    });
  } else {
    results.push({
      name: "Instrumentation",
      status: "warn",
      message:
        "instrumentation.ts not found. Server-side tracking may not work.",
    });
  }

  // Check 5: Do error boundary files exist?
  const errorFilesResult = await checkErrorFiles(project);
  results.push(errorFilesResult);

  // Print results
  printResults(results);

  // Summary
  const failures = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warn").length;

  console.log();
  if (failures > 0) {
    console.log(
      chalk.red(`  ${failures} issue(s) found. Run "npx @bugwatch/cli init" to fix.\n`)
    );
    process.exit(1);
  } else if (warnings > 0) {
    console.log(
      chalk.yellow(`  ${warnings} warning(s). Your setup should work but may be incomplete.\n`)
    );
  } else {
    console.log(chalk.green("  All checks passed! Bugwatch is properly configured.\n"));
  }
}

/**
 * Check if a package is installed
 */
async function checkPackageInstalled(packageName: string): Promise<boolean> {
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    return (
      packageJson.dependencies?.[packageName] !== undefined ||
      packageJson.devDependencies?.[packageName] !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * Check if an environment variable is set in .env.local
 */
async function checkEnvVariable(varName: string): Promise<boolean> {
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    const content = await fs.readFile(envPath, "utf-8");
    return content.includes(`${varName}=`) && !content.includes(`${varName}=\n`);
  } catch {
    return false;
  }
}

/**
 * Check if error boundary files exist
 */
async function checkErrorFiles(project: {
  routerType: "app" | "pages" | "both";
  appDir: string;
  pagesDir: string;
  hasTypescript: boolean;
}): Promise<CheckResult> {
  const ext = project.hasTypescript ? "tsx" : "jsx";
  const missingFiles: string[] = [];

  // Check App Router files
  if (project.routerType === "app" || project.routerType === "both") {
    if (project.appDir) {
      const errorPath = path.join(project.appDir, `error.${ext}`);
      const globalErrorPath = path.join(project.appDir, `global-error.${ext}`);

      if (!(await fileExists(errorPath))) {
        missingFiles.push("app/error.tsx");
      }
      if (!(await fileExists(globalErrorPath))) {
        missingFiles.push("app/global-error.tsx");
      }
    }
  }

  // Check Pages Router files
  if (project.routerType === "pages" || project.routerType === "both") {
    if (project.pagesDir) {
      const errorPath = path.join(project.pagesDir, `_error.${ext}`);
      if (!(await fileExists(errorPath))) {
        missingFiles.push("pages/_error.tsx");
      }
    }
  }

  if (missingFiles.length === 0) {
    return {
      name: "Error Boundaries",
      status: "pass",
      message: "Error boundary files exist",
    };
  }

  return {
    name: "Error Boundaries",
    status: "warn",
    message: `Missing: ${missingFiles.join(", ")}`,
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
 * Print check results
 */
function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const icon =
      result.status === "pass"
        ? chalk.green("✓")
        : result.status === "fail"
          ? chalk.red("✗")
          : chalk.yellow("⚠");

    const nameColor =
      result.status === "pass"
        ? chalk.white
        : result.status === "fail"
          ? chalk.red
          : chalk.yellow;

    console.log(`  ${icon} ${nameColor(result.name)}`);
    console.log(chalk.dim(`    ${result.message}`));
  }
}
