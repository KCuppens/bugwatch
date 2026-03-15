import { BugwatchClient } from "../client.js";

export const triagePromptDefinition = {
  name: "triage-new-errors",
  description:
    "Fetches all unresolved issues across projects and asks the agent to prioritize them by severity, frequency, and user impact.",
  arguments: [
    {
      name: "projectId",
      description:
        "Optional project ID to scope triage to a single project. If omitted, triages across all projects.",
      required: false,
    },
  ],
};

export async function buildTriagePrompt(
  args: Record<string, string>,
  client: BugwatchClient
): Promise<{ messages: Array<{ role: "user"; content: { type: "text"; text: string } }> }> {
  let issueData = "";

  try {
    if (args.projectId) {
      const issues = await client.listIssues(args.projectId, {
        status: "unresolved",
        per_page: 50,
      });
      issueData = JSON.stringify(issues.data, null, 2);
    } else {
      const projects = await client.listProjects(1, 100);
      const allIssues: Array<{ project: string; issues: unknown[] }> = [];

      for (const project of projects.data) {
        try {
          const issues = await client.listIssues(project.id, {
            status: "unresolved",
            per_page: 25,
          });
          if (issues.data.length > 0) {
            allIssues.push({
              project: project.name,
              issues: issues.data,
            });
          }
        } catch {
          // Skip projects we can't access
        }
      }

      issueData = JSON.stringify(allIssues, null, 2);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issueData = `Error fetching issues: ${message}`;
  }

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a senior software engineer performing error triage for Bugwatch. Below are the current unresolved issues.

Please analyze these issues and provide:
1. **Critical Priority** - Issues that need immediate attention (fatal errors, high frequency, affecting many users)
2. **High Priority** - Important issues that should be fixed soon
3. **Medium Priority** - Issues that should be addressed but aren't urgent
4. **Low Priority** - Minor issues or rare occurrences

For each issue, explain:
- Why you assigned that priority
- Suggested next steps
- Any patterns you notice (e.g., related errors, common root causes)

Unresolved Issues:
${issueData}`,
        },
      },
    ],
  };
}
