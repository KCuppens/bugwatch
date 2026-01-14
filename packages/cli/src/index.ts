import { Command } from "commander";
import { initCommand } from "./commands/init";
import { doctorCommand } from "./commands/doctor";

const program = new Command();

program
  .name("bugwatch")
  .description("CLI tool for setting up Bugwatch error tracking")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Bugwatch in your Next.js project")
  .option("--dsn <dsn>", "Bugwatch DSN (or set BUGWATCH_DSN env var)")
  .option("--skip-prompts", "Use defaults without prompting")
  .option("--dry-run", "Show what would be done without making changes")
  .action(initCommand);

program
  .command("doctor")
  .description("Check your Bugwatch setup for issues")
  .action(doctorCommand);

program.parse();
