import chalk from "chalk";
import ora from "ora";
import { prompt } from "enquirer";
import {
  detectProject,
  detectPackageManager,
  type ProjectInfo,
} from "../utils/detect";
import {
  installPackage,
  createInstrumentationFile,
  createErrorFiles,
  updateEnvFile,
} from "../utils/files";

export interface InitOptions {
  dsn?: string;
  skipPrompts?: boolean;
  dryRun?: boolean;
}

/**
 * Main init command
 */
export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.bold("\n  Bugwatch Setup Wizard\n"));

  const spinner = ora("Detecting project type...").start();

  // Step 1: Detect project type
  const project = await detectProject(process.cwd());

  if (!project.isNextJs) {
    spinner.fail("This doesn't appear to be a Next.js project");
    console.log(
      chalk.yellow("\nBugwatch CLI currently supports Next.js projects.")
    );
    console.log(
      chalk.dim('Looking for package.json with "next" dependency.\n')
    );
    process.exit(1);
  }

  const routerDisplay =
    project.routerType === "both"
      ? "App + Pages Router"
      : project.routerType === "app"
        ? "App Router"
        : "Pages Router";

  spinner.succeed(
    `Detected Next.js ${project.nextVersion} (${routerDisplay})`
  );

  // Step 2: Detect package manager
  const pm = await detectPackageManager(process.cwd());
  console.log(chalk.dim(`  Using ${pm} as package manager\n`));

  // Step 3: Get DSN
  let dsn = options.dsn || process.env.BUGWATCH_DSN;

  if (!dsn && !options.skipPrompts) {
    try {
      const response = await prompt<{ dsn: string }>({
        type: "input",
        name: "dsn",
        message: "Enter your Bugwatch DSN:",
        hint: "Find this in your Bugwatch dashboard under Project Settings",
        validate: (value: string) => {
          if (!value) return "DSN is required";
          if (!value.includes("@") || !value.startsWith("http")) {
            return "Invalid DSN format. Expected: https://<key>@<host>/<project>";
          }
          return true;
        },
      });
      dsn = response.dsn;
    } catch {
      // User cancelled
      console.log(chalk.yellow("\nSetup cancelled.\n"));
      process.exit(0);
    }
  }

  if (!dsn) {
    console.log(
      chalk.red(
        "\nError: DSN is required. Provide via --dsn flag or BUGWATCH_DSN env var.\n"
      )
    );
    process.exit(1);
  }

  // Step 4: Dry run - show what would be done
  if (options.dryRun) {
    console.log(
      chalk.cyan("\n  Dry run - the following changes would be made:\n")
    );
    showPlannedChanges(project, dsn);
    return;
  }

  // Step 5: Install package
  const installSpinner = ora("Installing @bugwatch/nextjs...").start();
  try {
    await installPackage("@bugwatch/nextjs", pm, process.cwd());
    installSpinner.succeed("Installed @bugwatch/nextjs");
  } catch (error) {
    installSpinner.fail("Failed to install @bugwatch/nextjs");
    console.log(chalk.red(`\n${error}\n`));
    process.exit(1);
  }

  // Step 6: Create instrumentation.ts
  if (!project.hasInstrumentation) {
    const instrSpinner = ora("Creating instrumentation file...").start();
    try {
      const instrPath = await createInstrumentationFile(project);
      instrSpinner.succeed(`Created ${getRelativePath(instrPath)}`);
    } catch (error) {
      instrSpinner.fail("Failed to create instrumentation file");
      console.log(chalk.red(`\n${error}\n`));
    }
  } else {
    console.log(
      chalk.dim("  ⏭  Skipping instrumentation.ts (already exists)")
    );
  }

  // Step 7: Create error boundary files
  const errorSpinner = ora("Creating error boundary files...").start();
  try {
    const errorFiles = await createErrorFiles(project);
    if (errorFiles.length > 0) {
      errorSpinner.succeed(
        `Created ${errorFiles.map(getRelativePath).join(", ")}`
      );
    } else {
      errorSpinner.info("Error boundary files already exist");
    }
  } catch (error) {
    errorSpinner.fail("Failed to create error boundary files");
    console.log(chalk.red(`\n${error}\n`));
  }

  // Step 8: Update .env.local
  const envSpinner = ora("Updating .env.local...").start();
  try {
    await updateEnvFile(dsn, process.cwd());
    envSpinner.succeed("Updated .env.local with NEXT_PUBLIC_BUGWATCH_DSN");
  } catch (error) {
    envSpinner.fail("Failed to update .env.local");
    console.log(chalk.red(`\n${error}\n`));
  }

  // Success message
  console.log(chalk.green("\n  ✓ Bugwatch setup complete!\n"));
  console.log(chalk.dim("  Your app will now automatically capture errors."));
  console.log(chalk.dim("  View them at https://app.bugwatch.dev\n"));

  // Show next steps
  console.log(chalk.bold("  Next steps:\n"));
  console.log(chalk.dim("  1. Start your development server"));
  console.log(chalk.dim("  2. Trigger an error to test the integration"));
  console.log(chalk.dim("  3. Check your Bugwatch dashboard for the error\n"));
}

/**
 * Show planned changes for dry run
 */
function showPlannedChanges(project: ProjectInfo, dsn: string): void {
  console.log(chalk.white("  Files to create/modify:\n"));

  // Instrumentation file
  const instrExt = project.hasTypescript ? "ts" : "js";
  const instrPath = project.hasSrcDir
    ? `src/instrumentation.${instrExt}`
    : `instrumentation.${instrExt}`;

  if (!project.hasInstrumentation) {
    console.log(chalk.green(`  + ${instrPath}`));
  } else {
    console.log(chalk.dim(`  ⏭ ${instrPath} (already exists)`));
  }

  // Error files
  const reactExt = project.hasTypescript ? "tsx" : "jsx";

  if (project.routerType === "app" || project.routerType === "both") {
    const appPrefix = project.hasSrcDir ? "src/app" : "app";
    console.log(chalk.green(`  + ${appPrefix}/error.${reactExt}`));
    console.log(chalk.green(`  + ${appPrefix}/global-error.${reactExt}`));
  }

  if (project.routerType === "pages" || project.routerType === "both") {
    const pagesPrefix = project.hasSrcDir ? "src/pages" : "pages";
    console.log(chalk.green(`  + ${pagesPrefix}/_error.${reactExt}`));
  }

  console.log(chalk.green("  + .env.local (NEXT_PUBLIC_BUGWATCH_DSN)"));

  console.log(chalk.white("\n  Package to install:\n"));
  console.log(chalk.green("  + @bugwatch/nextjs"));

  console.log();
}

/**
 * Get relative path from current directory
 */
function getRelativePath(absolutePath: string): string {
  const cwd = process.cwd();
  if (absolutePath.startsWith(cwd)) {
    return absolutePath.slice(cwd.length + 1).replace(/\\/g, "/");
  }
  return absolutePath;
}
