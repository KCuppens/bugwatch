import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BugwatchClient } from "./client.js";

// Resources
import { buildIssueResourceHandlers } from "./resources/issues.js";
import { buildMonitorResourceHandlers } from "./resources/monitors.js";
import { buildServerResourceHandlers } from "./resources/servers.js";
import { buildAlertResourceHandlers } from "./resources/alerts.js";

// Tools
import {
  issueToolDefinitions,
  handleIssueTool,
} from "./tools/issues.js";
import {
  monitorToolDefinitions,
  handleMonitorTool,
} from "./tools/monitors.js";
import {
  alertToolDefinitions,
  handleAlertTool,
} from "./tools/alerts.js";
import {
  commentToolDefinitions,
  handleCommentTool,
} from "./tools/comments.js";

// Prompts
import {
  triagePromptDefinition,
  buildTriagePrompt,
} from "./prompts/triage.js";
import {
  investigatePromptDefinition,
  buildInvestigatePrompt,
} from "./prompts/investigate.js";
import {
  setupPromptDefinition,
  buildSetupPrompt,
} from "./prompts/setup.js";

async function main() {
  let client: BugwatchClient;
  try {
    client = new BugwatchClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const server = new Server(
    {
      name: "bugwatch-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    }
  );

  // --- Resource handlers ---

  const issueResources = buildIssueResourceHandlers(client);
  const monitorResources = buildMonitorResourceHandlers(client);
  const serverResources = buildServerResourceHandlers(client);
  const alertResources = buildAlertResourceHandlers(client);

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = [
      {
        uri: "bugwatch://projects",
        name: "All Projects",
        description: "List all Bugwatch projects",
        mimeType: "application/json",
      },
    ];

    // Dynamically list per-project resources
    try {
      const projectsResponse = await client.listProjects(1, 100);
      for (const project of projectsResponse.data) {
        resources.push(
          {
            uri: `bugwatch://projects/${project.id}`,
            name: `${project.name}`,
            description: `Project detail: ${project.name} (${project.platform})`,
            mimeType: "application/json",
          },
          {
            uri: `bugwatch://projects/${project.id}/issues`,
            name: `${project.name} - Issues`,
            description: `Unresolved issues for ${project.name}`,
            mimeType: "application/json",
          },
          {
            uri: `bugwatch://projects/${project.id}/monitors`,
            name: `${project.name} - Monitors`,
            description: `Uptime monitors for ${project.name}`,
            mimeType: "application/json",
          },
          {
            uri: `bugwatch://projects/${project.id}/servers`,
            name: `${project.name} - Servers`,
            description: `Server health for ${project.name}`,
            mimeType: "application/json",
          },
          {
            uri: `bugwatch://projects/${project.id}/alerts`,
            name: `${project.name} - Alerts`,
            description: `Alert rules and logs for ${project.name}`,
            mimeType: "application/json",
          }
        );
      }
    } catch {
      // If we can't fetch projects, return the static resource only
    }

    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    // Projects list
    if (uri === "bugwatch://projects") {
      const projects = await client.listProjects(1, 100);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(projects.data, null, 2),
          },
        ],
      };
    }

    // Single project detail
    const projectMatch = uri.match(/^bugwatch:\/\/projects\/([^/]+)$/);
    if (projectMatch) {
      const project = await client.getProject(projectMatch[1]);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(project.data, null, 2),
          },
        ],
      };
    }

    // Delegate to sub-resource handlers
    if (issueResources.matchesUri(uri)) {
      return issueResources.read(uri);
    }
    if (monitorResources.matchesUri(uri)) {
      return monitorResources.read(uri);
    }
    if (serverResources.matchesUri(uri)) {
      return serverResources.read(uri);
    }
    if (alertResources.matchesUri(uri)) {
      return alertResources.read(uri);
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // --- Tool handlers ---

  const allToolDefinitions = [
    ...issueToolDefinitions,
    ...monitorToolDefinitions,
    ...alertToolDefinitions,
    ...commentToolDefinitions,
  ];

  const issueToolNames = new Set(issueToolDefinitions.map((t) => t.name));
  const monitorToolNames = new Set(monitorToolDefinitions.map((t) => t.name));
  const alertToolNames = new Set(alertToolDefinitions.map((t) => t.name));
  const commentToolNames = new Set(commentToolDefinitions.map((t) => t.name));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allToolDefinitions };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args || {}) as Record<string, unknown>;

    if (issueToolNames.has(name)) {
      return handleIssueTool(name, toolArgs, client);
    }
    if (monitorToolNames.has(name)) {
      return handleMonitorTool(name, toolArgs, client);
    }
    if (alertToolNames.has(name)) {
      return handleAlertTool(name, toolArgs, client);
    }
    if (commentToolNames.has(name)) {
      return handleCommentTool(name, toolArgs, client);
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  // --- Prompt handlers ---

  const allPromptDefinitions = [
    triagePromptDefinition,
    investigatePromptDefinition,
    setupPromptDefinition,
  ];

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: allPromptDefinitions };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const promptArgs = (args || {}) as Record<string, string>;

    switch (name) {
      case "triage-new-errors":
        return buildTriagePrompt(promptArgs, client);
      case "investigate-issue":
        return buildInvestigatePrompt(promptArgs, client);
      case "setup-monitoring":
        return buildSetupPrompt(promptArgs, client);
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });

  // --- Start server ---

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
