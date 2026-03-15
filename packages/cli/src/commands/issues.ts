import chalk from "chalk";
import ora from "ora";
import { listIssues } from "../utils/api";

interface IssuesOptions {
  project?: string;
  status?: string;
  limit?: string;
  json?: boolean;
}

/**
 * Issues command - list/search issues
 */
export async function issuesCommand(options: IssuesOptions): Promise<void> {
  const spinner = ora("Fetching issues...").start();

  try {
    const issues = await listIssues(options.project, {
      status: options.status,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
      return;
    }

    if (issues.length === 0) {
      console.log(chalk.dim("\n  No issues found.\n"));
      return;
    }

    console.log(chalk.bold("\n  Issues\n"));

    // Table header
    const header = formatRow("ID", "Title", "Status", "Level", "Count", "Last Seen");
    console.log(chalk.dim(header));
    console.log(chalk.dim("  " + "─".repeat(110)));

    // Table rows
    for (const issue of issues) {
      const statusColor = getStatusColor(issue.status);
      const levelColor = getLevelColor(issue.level);

      console.log(
        formatRow(
          truncate(issue.id, 10),
          truncate(issue.title, 40),
          statusColor(issue.status),
          levelColor(issue.level),
          String(issue.count),
          formatDate(issue.last_seen)
        )
      );
    }

    console.log(chalk.dim(`\n  ${issues.length} issue(s) shown.\n`));
  } catch (error) {
    spinner.fail("Failed to fetch issues.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}

function formatRow(
  id: string,
  title: string,
  status: string,
  level: string,
  count: string,
  lastSeen: string
): string {
  return (
    "  " +
    id.padEnd(12) +
    title.padEnd(42) +
    status.padEnd(14) +
    level.padEnd(12) +
    count.padEnd(8) +
    lastSeen
  );
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "\u2026";
}

function getStatusColor(status: string): (s: string) => string {
  switch (status) {
    case "resolved":
      return chalk.green;
    case "ignored":
      return chalk.gray;
    case "unresolved":
      return chalk.red;
    default:
      return chalk.white;
  }
}

function getLevelColor(level: string): (s: string) => string {
  switch (level) {
    case "error":
      return chalk.red;
    case "warning":
      return chalk.yellow;
    case "info":
      return chalk.blue;
    default:
      return chalk.white;
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
