import { BugwatchClient } from "../client.js";

export function buildMonitorResourceHandlers(client: BugwatchClient) {
  return {
    matchesUri(uri: string): boolean {
      return /^bugwatch:\/\/projects\/[^/]+\/monitors$/.test(uri);
    },

    async read(uri: string) {
      const match = uri.match(
        /^bugwatch:\/\/projects\/([^/]+)\/monitors$/
      );
      if (!match) {
        throw new Error(`Unknown monitor resource: ${uri}`);
      }

      const projectId = match[1];
      const monitors = await client.listMonitors(projectId);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(monitors.data, null, 2),
          },
        ],
      };
    },
  };
}
