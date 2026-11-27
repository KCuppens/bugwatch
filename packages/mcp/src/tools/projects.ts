import { BugwatchClient, PaymentRequiredError } from "../client.js";

export const projectToolDefinitions = [
  {
    name: "create_project",
    description:
      "Create a new Bugwatch project and return its ingest API key (bw_live_...). The full key is only returned here and by the dashboard; project listings truncate it. Use the key as the SDK apiKey.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Project name (max 100 characters)",
        },
        platform: {
          type: "string",
          description: 'Platform, e.g. "react-native", "javascript", "node", "python", "rust" (max 50 characters)',
        },
        framework: {
          type: "string",
          description: 'Framework, e.g. "expo", "nextjs", "django" (max 50 characters)',
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_projects",
    description:
      "List Bugwatch projects (id, name, platform; never the ingest key). Use the id with search_issues, get_issue and the other project tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page: { type: "number", description: "Page number (100 projects per page, default 1)" },
      },
    },
  },
];

export async function handleProjectTool(
  toolName: string,
  args: Record<string, unknown>,
  client: BugwatchClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case "create_project": {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        if (!name) {
          return {
            content: [{ type: "text", text: "Error: name is required." }],
            isError: true,
          };
        }
        const result = await client.createProject({
          name,
          platform: args.platform as string | undefined,
          framework: args.framework as string | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: `Project "${name}" created.\n${JSON.stringify(result.data, null, 2)}`,
            },
          ],
        };
      }

      case "list_projects": {
        const page = typeof args.page === "number" ? args.page : undefined;
        const res = await client.listProjects(page, 100);
        const projects = res.data.map((p) => ({ id: p.id, name: p.name, platform: p.platform }));
        return {
          content: [{ type: "text", text: JSON.stringify({ projects, pagination: res.pagination }, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { error: "payment_required", message: error.message, payment: error.x402 },
              null,
              2
            ),
          },
        ],
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error ${toolName === "list_projects" ? "listing projects" : "creating project"}: ${message}` }],
      isError: true,
    };
  }
}
