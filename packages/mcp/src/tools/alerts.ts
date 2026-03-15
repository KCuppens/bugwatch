import { BugwatchClient } from "../client.js";

export const alertToolDefinitions = [
  {
    name: "create_alert_rule",
    description:
      "Create a new alert rule for a project. Alert rules define conditions that trigger notifications.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to create the alert rule in",
        },
        name: {
          type: "string",
          description: "A descriptive name for the alert rule",
        },
        condition: {
          type: "string",
          description:
            'The condition that triggers the alert (e.g., "new_error", "error_spike", "monitor_down")',
        },
        channel_ids: {
          type: "array",
          items: { type: "string" },
          description: "List of notification channel IDs to send alerts to",
        },
      },
      required: ["projectId", "name", "condition", "channel_ids"],
    },
  },
];

export async function handleAlertTool(
  toolName: string,
  args: Record<string, unknown>,
  client: BugwatchClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case "create_alert_rule": {
        const projectId = args.projectId as string;
        const result = await client.createAlertRule(projectId, {
          name: args.name as string,
          condition: args.condition as string,
          channel_ids: args.channel_ids as string[],
        });
        return {
          content: [
            {
              type: "text",
              text: `Alert rule "${args.name}" created successfully.\n${JSON.stringify(result, null, 2)}`,
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
