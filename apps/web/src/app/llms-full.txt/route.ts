import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

const BASE_URL = "https://bugwatch.dev/docs";

const SECTIONS = [
  {
    title: "Getting Started",
    pages: [
      "getting-started/index.mdx",
      "getting-started/create-project.mdx",
      "getting-started/verify-integration.mdx",
      "getting-started/ai-prompts.mdx",
    ],
  },
  {
    title: "JavaScript SDKs",
    pages: [
      "sdks/index.mdx",
      "sdks/javascript/core.mdx",
      "sdks/javascript/node.mdx",
      "sdks/javascript/nextjs.mdx",
      "sdks/javascript/react.mdx",
      "sdks/javascript/express.mdx",
      "sdks/javascript/fastify.mdx",
    ],
  },
  {
    title: "Python SDK",
    pages: [
      "sdks/python/index.mdx",
      "sdks/python/django.mdx",
      "sdks/python/flask.mdx",
      "sdks/python/fastapi.mdx",
      "sdks/python/celery.mdx",
    ],
  },
  {
    title: "Rust SDK",
    pages: [
      "sdks/rust/index.mdx",
      "sdks/rust/async.mdx",
      "sdks/rust/blocking.mdx",
    ],
  },
  {
    title: "API Reference",
    pages: [
      "api-reference/index.mdx",
      "api-reference/authentication.mdx",
      "api-reference/events.mdx",
      "api-reference/projects.mdx",
      "api-reference/issues.mdx",
      "api-reference/monitors.mdx",
      "api-reference/server-metrics.mdx",
      "api-reference/alerts.mdx",
      "api-reference/billing.mdx",
      "api-reference/webhooks.mdx",
    ],
  },
  {
    title: "Alerting",
    pages: [
      "alerting/index.mdx",
      "alerting/alert-rules.mdx",
      "alerting/notification-channels.mdx",
      "alerting/webhooks.mdx",
    ],
  },
  {
    title: "Server Agent",
    pages: [
      "server-agent/index.mdx",
      "server-agent/installation.mdx",
      "server-agent/configuration.mdx",
      "server-agent/troubleshooting.mdx",
    ],
  },
  {
    title: "Self-Hosting",
    pages: [
      "self-hosting/index.mdx",
      "self-hosting/docker.mdx",
      "self-hosting/manual-setup.mdx",
      "self-hosting/configuration.mdx",
      "self-hosting/upgrading.mdx",
    ],
  },
  {
    title: "Agents",
    pages: [
      "agents/index.mdx",
      "agents/api-keys.mdx",
      "agents/mcp.mdx",
      "agents/cli.mdx",
      "agents/openapi.mdx",
    ],
  },
  {
    title: "Architecture",
    pages: [
      "architecture/index.mdx",
      "architecture/overview.mdx",
      "architecture/event-pipeline.mdx",
      "architecture/data-model.mdx",
    ],
  },
  {
    title: "Migration",
    pages: [
      "migration/index.mdx",
      "migration/from-sentry.mdx",
      "migration/comparison.mdx",
    ],
  },
];

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length).trim();
}

function getTitleFromFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "Untitled";
  const frontmatter = match[1] ?? "";
  const titleMatch = frontmatter.match(/^title:\s*["']?(.*?)["']?\s*$/m);
  return titleMatch?.[1] ?? "Untitled";
}

function filePathToUrl(filePath: string): string {
  let url = filePath.replace(/\.mdx$/, "").replace(/\/index$/, "");
  return `${BASE_URL}/${url}`;
}

export async function GET() {
  const docsDir = path.join(process.cwd(), "content", "docs");
  const parts: string[] = [];

  // Add the docs index page first
  const indexPath = path.join(docsDir, "index.mdx");
  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, "utf-8");
    const indexTitle = getTitleFromFrontmatter(indexContent);
    const indexBody = stripFrontmatter(indexContent);
    parts.push(
      `${"=".repeat(80)}\n### ${indexTitle}\nSource: ${BASE_URL}\n${"=".repeat(80)}\n\n${indexBody}`
    );
  }

  for (const section of SECTIONS) {
    parts.push(`\n\n${"#".repeat(2)} ${section.title}\n`);

    for (const pagePath of section.pages) {
      const fullPath = path.join(docsDir, pagePath);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      const title = getTitleFromFrontmatter(content);
      const body = stripFrontmatter(content);
      const url = filePathToUrl(pagePath);

      parts.push(
        `${"=".repeat(80)}\n### ${title}\nSource: ${url}\n${"=".repeat(80)}\n\n${body}`
      );
    }
  }

  const output = parts.join("\n\n");

  return new NextResponse(output, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
