import { BugwatchClient, PaymentRequiredError } from "../client.js";
import type { EventDetail, Issue, IssueDetail, StackFrame } from "../types.js";

/** Server clamps per_page to 100; use the max page size when aggregating. */
const MAX_PER_PAGE = 100;
/** Hard ceiling on pages walked by an `all` aggregation (100 * 100 = 10k issues). */
const MAX_AGGREGATE_PAGES = 100;
/** Refuse a single bulk resolve larger than this — narrow the filter or batch IDs. */
const MAX_BULK_RESOLVE = 200;
/** How many PATCH calls to run concurrently during a bulk resolve. */
const BULK_CONCURRENCY = 5;

interface SearchSelector {
  query?: string;
  status?: string;
  level?: string;
}

/**
 * Walk every page of search results for a project, aggregating up to
 * MAX_AGGREGATE_PAGES worth of issues. Returns the issues plus a `truncated`
 * flag and the reported total so callers can tell the agent when there is more.
 */
async function collectAllIssues(
  client: BugwatchClient,
  projectId: string,
  selector: SearchSelector
): Promise<{ issues: Issue[]; total: number; truncated: boolean }> {
  const issues: Issue[] = [];
  let page = 1;
  let total = 0;
  let totalPages = 1;

  do {
    const res = await client.searchIssues(projectId, selector.query || "", {
      status: selector.status,
      level: selector.level,
      page,
      perPage: MAX_PER_PAGE,
    });
    issues.push(...res.data);
    total = res.pagination?.total ?? issues.length;
    totalPages = res.pagination?.total_pages ?? 1;
    if (res.data.length === 0) break;
    page++;
  } while (page <= totalPages && page <= MAX_AGGREGATE_PAGES);

  return { issues, total, truncated: totalPages > MAX_AGGREGATE_PAGES };
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
async function runPooled<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

/**
 * Render a single stack frame with its surrounding source context, formatted so
 * an agent can jump straight to `file:line` and read the offending code.
 */
function formatFrame(frame: StackFrame): string {
  const loc = `${frame.filename}:${frame.lineno}${frame.colno ? `:${frame.colno}` : ""}`;
  const lines = [`  at ${frame.function || "<anonymous>"} (${loc})`];

  const hasContext =
    frame.context_line !== undefined ||
    (frame.pre_context?.length ?? 0) > 0 ||
    (frame.post_context?.length ?? 0) > 0;

  if (hasContext) {
    // Reconstruct line numbers around the crash line so the agent can map
    // source context back to exact lines in the repo.
    const pre = frame.pre_context ?? [];
    const post = frame.post_context ?? [];
    const startLine = frame.lineno - pre.length;

    let n = startLine;
    for (const line of pre) {
      lines.push(`    ${String(n).padStart(5)} | ${line}`);
      n++;
    }
    if (frame.context_line !== undefined) {
      lines.push(`  > ${String(n).padStart(5)} | ${frame.context_line}`);
      n++;
    }
    for (const line of post) {
      lines.push(`    ${String(n).padStart(5)} | ${line}`);
      n++;
    }
  }

  return lines.join("\n");
}

/**
 * Build a human-readable diagnostic view of an event: the exception, the
 * in-app stack frames with source context, plus request/user/tag metadata.
 * This is what an agent reads to locate and fix the underlying bug.
 */
function formatEventDiagnostic(event: EventDetail): string {
  const sections: string[] = [];

  const headerParts = [`${event.level?.toUpperCase() || "ERROR"}: ${event.title}`];
  if (event.message && event.message !== event.title) headerParts.push(event.message);
  sections.push(headerParts.join("\n"));

  const meta: string[] = [];
  if (event.platform) meta.push(`platform: ${event.platform}`);
  if (event.environment) meta.push(`environment: ${event.environment}`);
  if (event.release) meta.push(`release: ${event.release}`);
  if (event.sdk) meta.push(`sdk: ${event.sdk.name}@${event.sdk.version}`);
  meta.push(`timestamp: ${event.timestamp}`);
  meta.push(`event_id: ${event.id}`);
  if (meta.length) sections.push(meta.join("\n"));

  const frames = event.stacktrace?.frames ?? [];
  if (frames.length) {
    const inApp = frames.filter((f) => f.in_app);
    const shown = inApp.length ? inApp : frames;
    const label = inApp.length ? "Stack Trace (in-app frames)" : "Stack Trace";
    sections.push(`--- ${label} ---\n${shown.map(formatFrame).join("\n\n")}`);
  }

  if (event.request?.url) {
    const req = [`--- Request ---`, `${event.request.method || "GET"} ${event.request.url}`];
    sections.push(req.join("\n"));
  }

  if (event.user && (event.user.id || event.user.email || event.user.username)) {
    const u = event.user;
    sections.push(`--- User ---\n${[u.id && `id=${u.id}`, u.email && `email=${u.email}`, u.username && `username=${u.username}`].filter(Boolean).join(" ")}`);
  }

  if (event.tags && Object.keys(event.tags).length) {
    sections.push(`--- Tags ---\n${Object.entries(event.tags).map(([k, v]) => `${k}=${v}`).join("\n")}`);
  }

  if (event.extra && Object.keys(event.extra).length) {
    sections.push(`--- Extra ---\n${JSON.stringify(event.extra, null, 2)}`);
  }

  return sections.join("\n\n");
}

/** Compose the full issue diagnostic: issue summary + latest event detail. */
function formatIssueDiagnostic(detail: IssueDetail): string {
  const summary = [
    `Issue ${detail.id}: ${detail.title}`,
    `status=${detail.status} level=${detail.level} events=${detail.count} users=${detail.user_count}`,
    `first_seen=${detail.first_seen} last_seen=${detail.last_seen}`,
  ].join("\n");

  if (!detail.latest_event) {
    return `${summary}\n\n(No event payload available for this issue.)`;
  }

  return `${summary}\n\n${formatEventDiagnostic(detail.latest_event)}`;
}

export const issueToolDefinitions = [
  {
    name: "get_issue",
    description:
      "Get full diagnostic detail for a Bugwatch issue: the exception, the in-app stack trace with source context (file:line and surrounding code), request, user, and tags. Use this to locate and fix the underlying bug before resolving the issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID to fetch full detail for",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
  {
    name: "get_event",
    description:
      "Get full diagnostic detail for a specific event of an issue (stack trace with source context, request, user, tags). Use when you need a different occurrence than the latest event returned by get_issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID the event belongs to",
        },
        eventId: {
          type: "string",
          description: "The event ID to fetch",
        },
      },
      required: ["projectId", "issueId", "eventId"],
    },
  },
  {
    name: "search_issues",
    description:
      "Search and filter issues in a Bugwatch project. Returns a page of matching issues (with pagination metadata), or every match when all=true. Use status=unresolved to list open issues.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to search issues in",
        },
        query: {
          type: "string",
          description: "Search query string to match against issue titles",
        },
        status: {
          type: "string",
          enum: ["unresolved", "resolved", "ignored"],
          description: "Filter by issue status",
        },
        level: {
          type: "string",
          enum: ["error", "warning", "info", "debug", "fatal"],
          description: "Filter by issue level/severity",
        },
        page: {
          type: "number",
          description: "1-based page number (default 1). Ignored when all=true.",
        },
        perPage: {
          type: "number",
          description: "Results per page, 1-100 (default 50). Ignored when all=true.",
        },
        all: {
          type: "boolean",
          description:
            "When true, walk every page and return all matching issues (up to 10,000). Overrides page/perPage.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "resolve_issues",
    description:
      "Bulk-resolve issues in a Bugwatch project. Pass an explicit list of issueIds, OR set all=true to resolve every currently-unresolved issue matching the optional query/level filters. Returns a per-issue summary. Note: resolving does NOT fix the bug — an issue reopens on the next matching event unless the underlying cause is fixed in code. Refuses batches larger than " +
      MAX_BULK_RESOLVE +
      " matched issues; narrow the filter or pass explicit issueIds in smaller batches.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueIds: {
          type: "array",
          items: { type: "string" },
          description: "Explicit list of issue IDs to resolve. Mutually exclusive with all.",
        },
        all: {
          type: "boolean",
          description:
            "Resolve every currently-unresolved issue matching the query/level filters. Mutually exclusive with issueIds.",
        },
        query: {
          type: "string",
          description: "When all=true, only resolve issues whose titles match this query.",
        },
        level: {
          type: "string",
          enum: ["error", "warning", "info", "debug", "fatal"],
          description: "When all=true, only resolve issues of this level/severity.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "resolve_issue",
    description: "Mark a Bugwatch issue as resolved",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID to resolve",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
  {
    name: "ignore_issue",
    description: "Mark a Bugwatch issue as ignored",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID to ignore",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
  {
    name: "get_issue_frequency",
    description: "Get the event frequency data for an issue over time. Useful for understanding trends and spikes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: {
          type: "string",
          description: "The project ID",
        },
        issueId: {
          type: "string",
          description: "The issue ID",
        },
      },
      required: ["projectId", "issueId"],
    },
  },
];

export async function handleIssueTool(
  toolName: string,
  args: Record<string, unknown>,
  client: BugwatchClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case "get_issue": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.getIssue(projectId, issueId);
        return {
          content: [{ type: "text", text: formatIssueDiagnostic(result.data) }],
        };
      }

      case "get_event": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const eventId = args.eventId as string;
        const result = await client.getIssueEvent(projectId, issueId, eventId);
        return {
          content: [{ type: "text", text: formatEventDiagnostic(result.data) }],
        };
      }

      case "search_issues": {
        const projectId = args.projectId as string;
        const query = args.query as string | undefined;
        const status = args.status as string | undefined;
        const level = args.level as string | undefined;
        const all = args.all === true;

        const summarize = (issue: Issue) => ({
          id: issue.id,
          title: issue.title,
          level: issue.level,
          status: issue.status,
          count: issue.count,
          first_seen: issue.first_seen,
          last_seen: issue.last_seen,
        });

        if (all) {
          const { issues, total, truncated } = await collectAllIssues(client, projectId, { query, status, level });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    total,
                    returned: issues.length,
                    truncated,
                    issues: issues.map(summarize),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const page = typeof args.page === "number" ? args.page : undefined;
        const perPage = typeof args.perPage === "number" ? args.perPage : undefined;
        const result = await client.searchIssues(projectId, query || "", { status, level, page, perPage });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total: result.pagination?.total ?? result.data.length,
                  page: result.pagination?.page,
                  per_page: result.pagination?.per_page,
                  total_pages: result.pagination?.total_pages,
                  issues: result.data.map(summarize),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "resolve_issues": {
        const projectId = args.projectId as string;
        const explicitIds = Array.isArray(args.issueIds) ? (args.issueIds as string[]) : undefined;
        const all = args.all === true;

        if (explicitIds?.length && all) {
          return {
            isError: true,
            content: [{ type: "text", text: "Provide either issueIds or all=true, not both." }],
          };
        }

        let targetIds: string[];
        if (explicitIds?.length) {
          targetIds = explicitIds;
        } else if (all) {
          const query = args.query as string | undefined;
          const level = args.level as string | undefined;
          // Only unresolved issues are candidates for resolution.
          const { issues, truncated } = await collectAllIssues(client, projectId, {
            query,
            level,
            status: "unresolved",
          });
          if (truncated || issues.length > MAX_BULK_RESOLVE) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `${issues.length}${truncated ? "+" : ""} unresolved issues match — that exceeds the bulk limit of ${MAX_BULK_RESOLVE}. Narrow with query/level, or list explicit issueIds in smaller batches.`,
                },
              ],
            };
          }
          targetIds = issues.map((i) => i.id);
        } else {
          return {
            isError: true,
            content: [{ type: "text", text: "Provide either issueIds (a non-empty array) or all=true." }],
          };
        }

        if (targetIds.length === 0) {
          return { content: [{ type: "text", text: "No matching issues to resolve." }] };
        }
        if (targetIds.length > MAX_BULK_RESOLVE) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `${targetIds.length} issue IDs provided — that exceeds the bulk limit of ${MAX_BULK_RESOLVE}. Resolve them in smaller batches.`,
              },
            ],
          };
        }

        const outcomes = await runPooled(targetIds, BULK_CONCURRENCY, async (issueId) => {
          try {
            await client.updateIssue(projectId, issueId, { status: "resolved" });
            return { id: issueId, ok: true as const };
          } catch (err) {
            const message = err instanceof PaymentRequiredError ? err.message : err instanceof Error ? err.message : String(err);
            return { id: issueId, ok: false as const, error: message };
          }
        });

        const resolved = outcomes.filter((o) => o.ok).map((o) => o.id);
        const failures = outcomes.filter((o) => !o.ok).map((o) => ({ id: o.id, error: (o as { error: string }).error }));

        return {
          isError: failures.length > 0 && resolved.length === 0,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  requested: targetIds.length,
                  resolved: resolved.length,
                  failed: failures.length,
                  resolved_ids: resolved,
                  failures,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "resolve_issue": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.updateIssue(projectId, issueId, {
          status: "resolved",
        });
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issueId} has been marked as resolved.\n${JSON.stringify(result.data, null, 2)}`,
            },
          ],
        };
      }

      case "ignore_issue": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.updateIssue(projectId, issueId, {
          status: "ignored",
        });
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issueId} has been marked as ignored.\n${JSON.stringify(result.data, null, 2)}`,
            },
          ],
        };
      }

      case "get_issue_frequency": {
        const projectId = args.projectId as string;
        const issueId = args.issueId as string;
        const result = await client.getIssueFrequency(projectId, issueId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
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
