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

  // Verify the key works before saving config
  // Temporarily set env vars so listProjects uses them
  process.env.BUGWATCH_API_KEY = apiKey;
  if (url) process.env.BUGWATCH_URL = url;

  const spinner = ora("Verifying API key...").start();
  try {
    const projects = await listProjects();
    // Verification succeeded — now save config
    await saveConfig({ apiKey, url });
    spinner.succeed(
      `Authenticated! Found ${projects.length} project(s).`
    );
    console.log(
      chalk.green("\n  Config saved to ~/.bugwatch/config.json\n")
    );
  } catch (error) {
    spinner.fail("Failed to verify API key.");
    // Clean up env vars
    delete process.env.BUGWATCH_API_KEY;
    delete process.env.BUGWATCH_URL;
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  ${message}\n`));
    process.exit(1);
  }
}
