import chalk from "chalk";
import ora from "ora";
import { listAlerts } from "../utils/api";

interface AlertsOptions {
  project?: string;
  json?: boolean;
}

/**
 * Alerts command - list alert logs
 */
export async function alertsCommand(options: AlertsOptions): Promise<void> {
  const spinner = ora("Fetching alerts...").start();

  try {
    const alerts = await listAlerts(options.project);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(alerts, null, 2));
      return;
    }

    if (alerts.length === 0) {
      console.log(chalk.dim("\n  No alerts found.\n"));
      return;
    }

    console.log(chalk.bold("\n  Alert Logs\n"));

    // Table header
    const header = formatRow("Time", "Rule", "Status", "Message");
    console.log(chalk.dim(header));
    console.log(chalk.dim("  " + "─".repeat(100)));

    for (const alert of alerts) {
      const statusColor =
        alert.status === "triggered" || alert.status === "firing"
          ? chalk.red
          : alert.status === "resolved"
            ? chalk.green
            : chalk.yellow;

      console.log(
        formatRow(
          formatDate(alert.created_at),
          truncate(alert.rule_name || "N/A", 24),
          statusColor(alert.status),
          truncate(alert.message || "", 40)
        )
      );
    }

    console.log(chalk.dim(`\n  ${alerts.length} alert(s) shown.\n`));
  } catch (error) {
    spinner.fail("Failed to fetch alerts.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}

function formatRow(
  time: string,
  rule: string,
  status: string,
  message: string
): string {
  return (
    "  " +
    time.padEnd(22) +
    rule.padEnd(26) +
    status.padEnd(14) +
    message
  );
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "\u2026";
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}
