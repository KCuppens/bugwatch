import { BugwatchClient } from "../client.js";

export const investigatePromptDefinition = {
  name: "investigate-issue",
  description:
    "Fetches detailed information about a specific issue including its stack trace, and asks the agent to perform root cause analysis.",
  arguments: [
    {
      name: "projectId",
      description: "The project ID containing the issue",
      required: true,
    },
    {
      name: "issueId",
      description: "The issue ID to investigate",
      required: true,
    },
  ],
};

export async function buildInvestigatePrompt(
  args: Record<string, string>,
  client: BugwatchClient
): Promise<{ messages: Array<{ role: "user"; content: { type: "text"; text: string } }> }> {
  const { projectId, issueId } = args;

  if (!projectId || !issueId) {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Error: Both projectId and issueId are required for investigation.",
          },
        },
      ],
    };
  }

  let issueData = "";
  let frequencyData = "";
  let commentsData = "";

  try {
    const [issue, frequency, comments] = await Promise.all([
      client.getIssue(projectId, issueId),
      client.getIssueFrequency(projectId, issueId).catch(() => ({
        data: [],
      })),
      client.listComments(projectId, issueId).catch(() => ({
        data: [],
      })),
    ]);

    issueData = JSON.stringify(issue.data, null, 2);
    frequencyData = JSON.stringify(frequency.data, null, 2);
    commentsData = JSON.stringify(comments.data, null, 2);

    // Format stack trace for readability
    let stackTrace = "No stack trace available";
    if (issue.data.latest_event?.stacktrace?.frames) {
      const frames = issue.data.latest_event.stacktrace.frames;
      stackTrace = frames
        .map(
          (f) =>
            `${f.in_app ? ">> " : "   "}${f.function} (${f.filename}:${f.lineno}${f.colno ? `:${f.colno}` : ""})${f.context_line ? `\n      ${f.context_line.trim()}` : ""}`
        )
        .join("\n");
    }

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are a senior software engineer investigating a Bugwatch error. Perform a thorough root cause analysis.

## Issue Details
${issueData}

## Stack Trace
${stackTrace}

## Event Frequency Over Time
${frequencyData}

## Existing Comments
${commentsData}

Please provide:
1. **Root Cause Analysis** - What is most likely causing this error?
2. **Impact Assessment** - How severe is this issue? Who/what is affected?
3. **Reproduction Steps** - How might someone reproduce this issue?
4. **Recommended Fix** - What code changes would fix the root cause?
5. **Prevention** - How can similar issues be prevented in the future?

If the stack trace contains in-app frames (marked with >>), focus your analysis on those.`,
          },
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Error fetching issue details: ${message}. Please verify the projectId (${projectId}) and issueId (${issueId}) are correct.`,
          },
        },
      ],
    };
  }
}
