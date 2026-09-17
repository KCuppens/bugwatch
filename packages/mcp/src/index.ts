import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BugwatchClient } from "./client.js";
import { createBugwatchServer } from "./server.js";

async function main() {
  let client: BugwatchClient;
  try {
    client = new BugwatchClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const server = createBugwatchServer(client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
