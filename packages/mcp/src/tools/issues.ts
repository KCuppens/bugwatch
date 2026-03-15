import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BugwatchClient } from "../client.js";

export const issueToolDefinitions = [
  {
    name: "search_issues",
    description:
      "Search and filter issues in a Bugwatch project. Returns matching issues with their status, level, and event count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to search issues in",
        },
        query: {
          type: "string",
          description: "Search query string to match against issue titles",
        },
        status: {
          type: "string",
          enum: ["unresolved", "resolved", "ignored"],
          description: "Filter by issue status",
        },
        level: {
          type: "string",
          enum: ["error", "warning", "info", "debug", "fatal"],
          description: "Filter by issue level/severity",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "resolve_issue",
    description: "Mark a Bugwatch issue as resolved",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID to resolve",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
  {
    name: "ignore_issue",
    description: "Mark a Bugwatch issue as ignored",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID to ignore",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
  {
    name: "get_issue_frequency",
    description:
      "Get the event frequency data for an issue over time. Useful for understanding trends and spikes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
];

export async function handleIssueTool(
  toolName: string,
  args: Record<string, unknown>,
  client: BugwatchClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case "search_issues": {
        const projectId = args.projectId as string;
        const query = args.query as string | undefined;
        const status = args.status as string | undefined;
        const level = args.level as string | undefined;

        // Always use the search endpoint which supports text + filters
        const result = await client.searchIssues(
          projectId,
          query || "",
          { status, level }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total: result.pagination?.total ?? result.data.length,
                  issues: result.data.map((issue) => ({
                    id: issue.id,
                    title: issue.title,
                    level: issue.level,
                    status: issue.status,
                    count: issue.count,
                    first_seen: issue.first_seen,
                    last_seen: issue.last_seen,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "resolve_issue": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.updateIssue(projectId, issueId, {
          status: "resolved",
        });
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issueId} has been marked as resolved.\n${JSON.stringify(result.data, null, 2)}`,
            },
          ],
        };
      }

      case "ignore_issue": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.updateIssue(projectId, issueId, {
          status: "ignored",
        });
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issueId} has been marked as ignored.\n${JSON.stringify(result.data, null, 2)}`,
            },
          ],
        };
      }

      case "get_issue_frequency": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.getIssueFrequency(projectId, issueId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
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
