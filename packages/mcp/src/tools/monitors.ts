import { BugwatchClient } from "../client.js";

export const monitorToolDefinitions = [
  {
    name: "create_monitor",
    description:
      "Create a new uptime monitor for a URL. The monitor will periodically check the URL and report its status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to create the monitor in",
        },
        name: {
          type: "string",
          description: "A descriptive name for the monitor",
        },
        url: {
          type: "string",
          description: "The URL to monitor (must be a valid HTTP/HTTPS URL)",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "HEAD"],
          description: "HTTP method to use for checks (default: GET)",
        },
        interval_seconds: {
          type: "number",
          description:
            "Check interval in seconds (default: 60). Minimum 30 seconds.",
        },
      },
      required: ["projectId", "name", "url"],
    },
  },
];

export async function handleMonitorTool(
  toolName: string,
  args: Record<string, unknown>,
  client: BugwatchClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case "create_monitor": {
        const projectId = args.projectId as string;
        const result = await client.createMonitor(projectId, {
          name: args.name as string,
          url: args.url as string,
          method: (args.method as string) || "GET",
          interval_seconds: (args.interval_seconds as number) || 60,
        });
        return {
          content: [
            {
              type: "text",
              text: `Monitor "${args.name}" created successfully.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
