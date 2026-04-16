import chalk from "chalk";
import ora from "ora";
import { getIssue } from "../utils/api";

interface IssueOptions {
  project?: string;
  json?: boolean;
}

/**
 * Issue command - show issue detail
 */
export async function issueCommand(
  issueId: string,
  options: IssueOptions
): Promise<void> {
  if (!options.project) {
    console.log(chalk.red("\n  --project <id> is required.\n"));
    process.exit(1);
  }

  const spinner = ora("Fetching issue...").start();

  try {
    const issue = await getIssue(issueId, options.project);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(issue, null, 2));
      return;
    }

    console.log(chalk.bold("\n  Issue Detail\n"));

    console.log(`  ${chalk.dim("Title:")}       ${issue.title}`);
    console.log(
      `  ${chalk.dim("ID:")}          ${issue.id}`
    );
    console.log(
      `  ${chalk.dim("Status:")}      ${getStatusDisplay(issue.status)}`
    );
    console.log(
      `  ${chalk.dim("Level:")}       ${getLevelDisplay(issue.level)}`
    );
    console.log(`  ${chalk.dim("Count:")}       ${issue.count}`);
    console.log(
      `  ${chalk.dim("First Seen:")}  ${formatDate(issue.first_seen)}`
    );
    console.log(
      `  ${chalk.dim("Last Seen:")}   ${formatDate(issue.last_seen)}`
    );

    // Show stack trace if available (server returns exception.stacktrace)
    const exception = (issue as unknown as Record<string, unknown>).exception as
      | { type?: string; value?: string; stacktrace?: Array<{ filename: string; function: string; lineno: number; colno?: number }> }
      | undefined;

    if (exception) {
      if (exception.type || exception.value) {
        console.log(chalk.bold("\n  Exception\n"));
        console.log(`  ${chalk.red(exception.type || "Error")}: ${exception.value || ""}`);
      }
      if (exception.stacktrace && exception.stacktrace.length > 0) {
        console.log(chalk.bold("\n  Stack Trace\n"));
        for (const frame of exception.stacktrace) {
          const location = `${frame.filename}:${frame.lineno}${frame.colno ? `:${frame.colno}` : ""}`;
          console.log(chalk.dim(`  at ${frame.function || "<anonymous>"} (${location})`));
        }
      }
    }

    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch issue.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}

function getStatusDisplay(status: string): string {
  switch (status) {
    case "resolved":
      return chalk.green(status);
    case "ignored":
      return chalk.gray(status);
    case "unresolved":
      return chalk.red(status);
    default:
      return status;
  }
}

function getLevelDisplay(level: string): string {
  switch (level) {
    case "error":
      return chalk.red(level);
    case "warning":
      return chalk.yellow(level);
    case "info":
      return chalk.blue(level);
    default:
      return level;
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}
