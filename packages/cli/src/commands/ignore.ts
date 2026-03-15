import chalk from "chalk";
import ora from "ora";
import { updateIssue } from "../utils/api";

interface IgnoreOptions {
  project: string;
}

/**
 * Ignore command - mark an issue as ignored
 */
export async function ignoreCommand(
  issueId: string,
  options: IgnoreOptions
): Promise<void> {
  if (!options.project) {
    console.log(chalk.red("\n  --project <id> is required.\n"));
    process.exit(1);
  }

  const spinner = ora("Ignoring issue...").start();

  try {
    await updateIssue(issueId, options.project, { status: "ignored" });
    spinner.succeed(`Issue ${issueId} marked as ignored.`);
    console.log();
  } catch (error) {
    spinner.fail("Failed to ignore issue.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}
