import chalk from "chalk";
import ora from "ora";
import { saveConfig, listProjects } from "../utils/api";

interface LoginOptions {
  apiKey?: string;
  url?: string;
}

/**
 * Login command - configure API key
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  console.log(chalk.bold("\n  Bugwatch Login\n"));

  let apiKey = options.apiKey;
  const url = options.url;

  if (!apiKey) {
    // Dynamic import for enquirer (ESM compat)
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();

    const response = (await enquirer.prompt({
      type: "password",
      name: "apiKey",
      message: "Enter your Bugwatch API key",
    })) as { apiKey: string };

    apiKey = response.apiKey;
  }

  if (!apiKey) {
    console.log(chalk.red("  No API key provided.\n"));
    process.exit(1);
  }

  if (!apiKey.startsWith("bw_agent_")) {
    console.log(
      chalk.red(
        '  Invalid API key format. Keys should start with "bw_agent_".\n'
      )
    );
    process.exit(1);
  }

  // Save config first so the verification call can use it
  await saveConfig({ apiKey, url });

  // Verify the key works
  const spinner = ora("Verifying API key...").start();
  try {
    const projects = await listProjects();
    spinner.succeed(
      `Authenticated! Found ${projects.length} project(s).`
    );
    console.log(
      chalk.green("\n  Config saved to ~/.bugwatch/config.json\n")
    );
  } catch (error) {
    spinner.fail("Failed to verify API key.");
    // Remove the saved config since it's invalid
    await saveConfig({ apiKey: "", url });
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}
