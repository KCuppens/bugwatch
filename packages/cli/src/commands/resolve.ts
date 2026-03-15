import chalk from "chalk";
import ora from "ora";
import { updateIssue } from "../utils/api";

interface ResolveOptions {
  project: string;
}

/**
 * Resolve command - mark an issue as resolved
 */
export async function resolveCommand(
  issueId: string,
  options: ResolveOptions
): Promise<void> {
  if (!options.project) {
    console.log(chalk.red("\n  --project <id> is required.\n"));
    process.exit(1);
  }

  const spinner = ora("Resolving issue...").start();

  try {
    await updateIssue(issueId, options.project, { status: "resolved" });
    spinner.succeed(`Issue ${issueId} marked as resolved.`);
    console.log();
  } catch (error) {
    spinner.fail("Failed to resolve issue.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}
