import chalk from "chalk";
import ora from "ora";
import {
  getStatus,
  countIssues,
  listMonitors,
  listAlerts,
  type Monitor,
  type Alert,
} from "../utils/api";

interface StatusOptions {
  project?: string;
  json?: boolean;
}

/**
 * Status command - show project health overview
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  const spinner = ora("Fetching status...").start();

  try {
    const [projects, monitors, alerts] = await Promise.all([
      getStatus(options.project),
      listMonitors(options.project).catch(() => [] as Monitor[]),
      listAlerts(options.project).catch(() => [] as Alert[]),
    ]);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify({ projects, monitors, alerts }, null, 2));
      return;
    }

    console.log(chalk.bold("\n  Project Status\n"));

    for (const project of projects) {
      // Fetch unresolved issue count per project (uses per_page=1 to just get pagination.total)
      let unresolvedCount = 0;
      try {
        unresolvedCount = await countIssues(project.id, "unresolved");
      } catch {
        // Ignore - will show 0
      }

      const statusIcon =
        unresolvedCount > 0 ? chalk.red("!") : chalk.green("~");

      console.log(`  ${statusIcon} ${chalk.bold(project.name)}`);
      console.log(
        `    ${chalk.dim("Unresolved issues:")} ${unresolvedCount > 0 ? chalk.red(String(unresolvedCount)) : chalk.green("0")}`
      );
    }

    // Monitors summary
    if (monitors.length > 0) {
      const getMonitorStatus = (m: Monitor) =>
        (m as Record<string, unknown>).current_status as string || m.status || "unknown";

      const up = monitors.filter(
        (m) => getMonitorStatus(m) === "up" || getMonitorStatus(m) === "healthy"
      ).length;
      const down = monitors.length - up;

      console.log(chalk.bold("\n  Monitors\n"));
      console.log(
        `  ${chalk.green(`${up} up`)}${down > 0 ? chalk.red(` / ${down} down`) : ""} out of ${monitors.length}`
      );

      if (down > 0) {
        const downMonitors = monitors.filter(
          (m) => getMonitorStatus(m) !== "up" && getMonitorStatus(m) !== "healthy"
        );
        for (const monitor of downMonitors) {
          console.log(`    ${chalk.red("!")} ${monitor.name} (${monitor.url})`);
        }
      }
    }

    // Recent alerts
    if (alerts.length > 0) {
      const recentAlerts = alerts.slice(0, 5);
      console.log(chalk.bold("\n  Recent Alerts\n"));
      for (const alert of recentAlerts) {
        const time = formatDate(alert.created_at);
        console.log(
          `  ${chalk.yellow("!")} ${chalk.dim(time)} ${alert.rule_name || "Alert"} - ${alert.message || alert.status}`
        );
      }
    }

    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch status.");
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}
