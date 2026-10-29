import { BugwatchClient } from "../client.js";

export function buildServerResourceHandlers(client: BugwatchClient) {
  return {
    matchesUri(uri: string): boolean {
      return /^bugwatch:\/\/projects\/[^/]+\/servers$/.test(uri);
    },

    async read(uri: string) {
      const match = uri.match(
        /^bugwatch:\/\/projects\/([^/]+)\/servers$/
      );
      if (!match) {
        throw new Error(`Unknown server resource: ${uri}`);
      }

      const projectId = match[1]!;
      const servers = await client.listServers(projectId);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(servers.data, null, 2),
          },
        ],
      };
    },
  };
}
