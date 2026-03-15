import chalk from "chalk";
import ora from "ora";
import { listMonitors } from "../utils/api";

interface MonitorsOptions {
  project?: string;
  json?: boolean;
}

/**
 * Monitors command - list uptime monitors
 */
export async function monitorsCommand(options: MonitorsOptions): Promise<void> {
  const spinner = ora("Fetching monitors...").start();

  try {
    const monitors = await listMonitors(options.project);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(monitors, null, 2));
      return;
    }

    if (monitors.length === 0) {
      console.log(chalk.dim("\n  No monitors found.\n"));
      return;
    }

    console.log(chalk.bold("\n  Monitors\n"));

    // Table header
    const header = formatRow("Name", "URL", "Status", "Uptime 24h", "Avg Response");
    console.log(chalk.dim(header));
    console.log(chalk.dim("  " + "─".repeat(100)));

    for (const monitor of monitors) {
      const monitorStatus = (monitor as Record<string, unknown>).current_status as string || monitor.status || "unknown";
      const statusColor =
        monitorStatus === "up" || monitorStatus === "healthy"
          ? chalk.green
          : chalk.red;

      const uptime =
        monitor.uptime_24h !== undefined
          ? `${Number(monitor.uptime_24h).toFixed(1)}%`
          : "N/A";

      const avgResponse =
        monitor.avg_response_24h !== undefined
          ? `${monitor.avg_response_24h}ms`
          : "N/A";

      console.log(
        formatRow(
          truncate(monitor.name, 20),
          truncate(monitor.url, 30),
          statusColor(monitorStatus),
          uptime,
          avgResponse
        )
      );
    }

    console.log(chalk.dim(`\n  ${monitors.length} monitor(s) shown.\n`));
  } catch (error) {
    spinner.fail("Failed to fetch monitors.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}

function formatRow(
  name: string,
  url: string,
  status: string,
  uptime: string,
  avgResponse: string
): string {
  return (
    "  " +
    name.padEnd(22) +
    url.padEnd(32) +
    status.padEnd(14) +
    uptime.padEnd(14) +
    avgResponse
  );
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "\u2026";
}
