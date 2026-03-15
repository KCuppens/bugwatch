import { BugwatchClient } from "../client.js";

export const setupPromptDefinition = {
  name: "setup-monitoring",
  description:
    "Reviews your current uptime monitors and alert rules, then suggests improvements for better coverage and reliability.",
  arguments: [
    {
      name: "projectId",
      description: "The project ID to review monitoring setup for",
      required: true,
    },
  ],
};

export async function buildSetupPrompt(
  args: Record<string, string>,
  client: BugwatchClient
): Promise<{ messages: Array<{ role: "user"; content: { type: "text"; text: string } }> }> {
  const { projectId } = args;

  if (!projectId) {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Error: projectId is required for monitoring setup review.",
          },
        },
      ],
    };
  }

  let monitorsData = "";
  let alertsData = "";
  let serversData = "";
  let projectData = "";

  try {
    const [project, monitors, alerts, servers] = await Promise.all([
      client.getProject(projectId).catch(() => ({ data: null })),
      client.listMonitors(projectId).catch(() => ({ data: [] })),
      client.listAlerts(projectId).catch(() => [] as never[]),
      client.listServers(projectId).catch(() => ({ data: [] })),
    ]);

    projectData = JSON.stringify(project.data, null, 2);
    monitorsData = JSON.stringify(monitors.data, null, 2);
    alertsData = JSON.stringify(alerts, null, 2);
    serversData = JSON.stringify(servers.data, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Error fetching monitoring data: ${message}`,
          },
        },
      ],
    };
  }

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a DevOps engineer reviewing the monitoring and alerting setup for a Bugwatch project. Analyze the current configuration and suggest improvements.

## Project
${projectData}

## Current Uptime Monitors
${monitorsData}

## Current Alert Rules
${alertsData}

## Known Servers
${serversData}

Please provide:
1. **Coverage Assessment** - Are there gaps in monitoring? What endpoints or services are missing monitors?
2. **Alert Rule Review** - Are the current alert rules sufficient? Are there missing conditions?
3. **Recommended Monitors** - Suggest specific monitors to add (with URLs, intervals, and methods)
4. **Recommended Alert Rules** - Suggest specific alert rules to add (with conditions and channels)
5. **Best Practices** - Any general improvements for reliability and incident response

Use the create_monitor and create_alert_rule tools to implement any recommendations the user approves.`,
        },
      },
    ],
  };
}
