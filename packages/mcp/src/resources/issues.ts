import { BugwatchClient } from "../client.js";

export function buildIssueResourceHandlers(client: BugwatchClient) {
  return {
    matchesUri(uri: string): boolean {
      return (
        /^bugwatch:\/\/projects\/[^/]+\/issues$/.test(uri) ||
        /^bugwatch:\/\/projects\/[^/]+\/issues\/[^/]+$/.test(uri)
      );
    },

    async read(uri: string) {
      // Match bugwatch://projects/{id}/issues
      const listMatch = uri.match(
        /^bugwatch:\/\/projects\/([^/]+)\/issues$/
      );
      if (listMatch) {
        const projectId = listMatch[1]!;
        const issues = await client.listIssues(projectId, {
          per_page: 25,
          status: "unresolved",
        });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(issues.data, null, 2),
            },
          ],
        };
      }

      // Match bugwatch://projects/{id}/issues/{issueId}
      const detailMatch = uri.match(
        /^bugwatch:\/\/projects\/([^/]+)\/issues\/([^/]+)$/
      );
      if (detailMatch) {
        const [, projectId, issueId] = detailMatch;
        const issue = await client.getIssue(projectId!, issueId!);

        // Format with stack trace for readability
        const detail = issue.data;
        let text = JSON.stringify(detail, null, 2);

        if (detail.latest_event?.stacktrace?.frames) {
          const frames = detail.latest_event.stacktrace.frames;
          const stackText = frames
            .filter((f) => f.in_app)
            .map(
              (f) =>
                `  at ${f.function} (${f.filename}:${f.lineno}${f.colno ? `:${f.colno}` : ""})`
            )
            .join("\n");

          if (stackText) {
            text += `\n\n--- Stack Trace (in-app frames) ---\n${stackText}`;
          }
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text,
            },
          ],
        };
      }

      throw new Error(`Unknown issue resource: ${uri}`);
    },
  };
}
