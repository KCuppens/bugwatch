import { BugwatchClient } from "../client.js";

export function buildAlertResourceHandlers(client: BugwatchClient) {
  return {
    matchesUri(uri: string): boolean {
      return /^bugwatch:\/\/projects\/[^/]+\/alerts$/.test(uri);
    },

    async read(uri: string) {
      const match = uri.match(
        /^bugwatch:\/\/projects\/([^/]+)\/alerts$/
      );
      if (!match) {
        throw new Error(`Unknown alert resource: ${uri}`);
      }

      const projectId = match[1];

      const [alerts, logs] = await Promise.all([
        client.listAlerts(projectId),
        client.listAlertLogs(projectId).catch(() => []),
      ]);

      const result = {
        rules: alerts,
        recent_logs: logs,
      };

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };
}
