import { BugwatchClient, PaymentRequiredError } from "../client.js";

export const commentToolDefinitions = [
  {
    name: "add_comment",
    description:
      "Add a comment to a Bugwatch issue. Useful for documenting findings, root cause analysis, or next steps.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID to comment on",
        },
        content: {
          type: "string",
          description: "The comment text (supports markdown)",
        },
      },
      required: ["projectId", "issueId", "content"],
    },
  },
];

export async function handleCommentTool(
  toolName: string,
  args: Record<string, unknown>,
  client: BugwatchClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case "add_comment": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const commentContent = args.content as string;
        const result = await client.addComment(projectId, issueId, commentContent);
        return {
          content: [
            {
              type: "text",
              text: `Comment added to issue ${issueId}.\n${JSON.stringify(result.data, null, 2)}`,
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
    if (error instanceof PaymentRequiredError) {
      let paymentText: string;
      try {
        paymentText = JSON.stringify(
          { error: "payment_required", message: error.message, payment: error.x402 },
          null,
          2
        );
      } catch {
        paymentText = JSON.stringify({ error: "payment_required", message: error.message });
      }
      return {
        isError: true,
        content: [{ type: "text" as const, text: paymentText }],
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
