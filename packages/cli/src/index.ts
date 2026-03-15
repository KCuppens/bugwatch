import { Command } from "commander";
import { initCommand } from "./commands/init";
import { doctorCommand } from "./commands/doctor";
import { loginCommand } from "./commands/login";
import { issuesCommand } from "./commands/issues";
import { issueCommand } from "./commands/issue";
import { resolveCommand } from "./commands/resolve";
import { ignoreCommand } from "./commands/ignore";
import { statusCommand } from "./commands/status";
import { monitorsCommand } from "./commands/monitors";
import { alertsCommand } from "./commands/alerts";

const program = new Command();

program
  .name("bugwatch")
  .description("CLI tool for setting up Bugwatch error tracking")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Bugwatch in your Next.js project")
  .option("--api-key <key>", "Bugwatch API key (or set BUGWATCH_API_KEY env var)")
  .option("--skip-prompts", "Use defaults without prompting")
  .option("--dry-run", "Show what would be done without making changes")
  .action(initCommand);

program
  .command("doctor")
  .description("Check your Bugwatch setup for issues")
  .action(doctorCommand);

program
  .command("login")
  .description("Configure your Bugwatch API key")
  .option("--api-key <key>", "API key (must start with bw_agent_)")
  .option("--url <url>", "API base URL (default: https://api.bugwatch.dev)")
  .action(loginCommand);

program
  .command("issues")
  .description("List issues across projects")
  .option("--project <id>", "Filter by project ID")
  .option("--status <status>", "Filter by status (unresolved, resolved, ignored)")
  .option("--limit <n>", "Maximum number of issues to show", "20")
  .option("--json", "Output raw JSON")
  .action(issuesCommand);

program
  .command("issue")
  .description("Show issue detail and stack trace")
  .argument("<issue-id>", "Issue ID")
  .option("--project <id>", "Project ID (required)")
  .option("--json", "Output raw JSON")
  .action(issueCommand);

program
  .command("resolve")
  .description("Mark an issue as resolved")
  .argument("<issue-id>", "Issue ID")
  .requiredOption("--project <id>", "Project ID")
  .action(resolveCommand);

program
  .command("ignore")
  .description("Mark an issue as ignored")
  .argument("<issue-id>", "Issue ID")
  .requiredOption("--project <id>", "Project ID")
  .action(ignoreCommand);

program
  .command("status")
  .description("Show project health overview")
  .option("--project <id>", "Filter by project ID")
  .option("--json", "Output raw JSON")
  .action(statusCommand);

program
  .command("monitors")
  .description("List uptime monitors")
  .option("--project <id>", "Filter by project ID")
  .option("--json", "Output raw JSON")
  .action(monitorsCommand);

program
  .command("alerts")
  .description("List alert logs")
  .option("--project <id>", "Filter by project ID")
  .option("--json", "Output raw JSON")
  .action(alertsCommand);

program.parse();
