import type {
  Project,
  Issue,
  IssueDetail,
  EventDetail,
  Monitor,
  AlertRule,
  AlertLog,
  Comment,
  Server,
  IssueFrequency,
  IssueFilters,
  CreateMonitorData,
  CreateAlertRuleData,
  PaginatedResponse,
  ApiResponse,
} from "./types.js";

export class PaymentRequiredError extends Error {
  constructor(
    public readonly x402: unknown,
    public readonly resource: string
  ) {
    super(`Payment required for ${resource}`);
    this.name = "PaymentRequiredError";
  }
}

export class BugwatchClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const apiKey = process.env.BUGWATCH_API_KEY;
    if (!apiKey) {
      throw new Error("BUGWATCH_API_KEY environment variable is required. " + "Set it to your Bugwatch API key.");
    }
    this.apiKey = apiKey;
    this.baseUrl = (process.env.BUGWATCH_URL || "https://api.bugwatch.dev").replace(/\/+$/, "");
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Bugwatch API request timed out after 30s: ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 402) {
        let body: Record<string, unknown> | null = null;
        try {
          body = (await response.json()) as Record<string, unknown>;
        } catch {
          // ignore parse failure, fall through to generic error
        }
        if (body && "x402" in body) {
          throw new PaymentRequiredError(body.x402, path);
        }
      }
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(`Bugwatch API error ${response.status} ${response.statusText}: ${errorBody}`);
    }

    const data = await response.json();
    return data as T;
  }

  private buildQuery(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    return qs ? `?${qs}` : "";
  }

  // Projects

  async listProjects(page?: number, perPage?: number): Promise<PaginatedResponse<Project>> {
    const query = this.buildQuery({ page, per_page: perPage });
    return this.request<PaginatedResponse<Project>>(`/api/v1/projects${query}`);
  }

  async getProject(id: string): Promise<ApiResponse<Project>> {
    return this.request<ApiResponse<Project>>(`/api/v1/projects/${id}`);
  }

  // Issues

  async listIssues(projectId: string, filters?: IssueFilters): Promise<PaginatedResponse<Issue>> {
    const query = this.buildQuery((filters || {}) as Record<string, unknown>);
    return this.request<PaginatedResponse<Issue>>(`/api/v1/projects/${projectId}/issues${query}`);
  }

  async searchIssues(
    projectId: string,
    query: string,
    filters?: { status?: string; level?: string }
  ): Promise<PaginatedResponse<Issue>> {
    const body: Record<string, unknown> = {
      filters: {
        text: query || undefined,
        status: filters?.status ? [filters.status] : undefined,
        level: filters?.level ? [filters.level] : undefined,
      },
      per_page: 50,
    };
    return this.request<PaginatedResponse<Issue>>(`/api/v1/projects/${projectId}/issues/_search`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getIssue(projectId: string, issueId: string): Promise<ApiResponse<IssueDetail>> {
    return this.request<ApiResponse<IssueDetail>>(`/api/v1/projects/${projectId}/issues/${issueId}`);
  }

  async updateIssue(projectId: string, issueId: string, data: { status: string }): Promise<ApiResponse<Issue>> {
    return this.request<ApiResponse<Issue>>(`/api/v1/projects/${projectId}/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async getIssueFrequency(projectId: string, issueId: string): Promise<ApiResponse<IssueFrequency[]>> {
    return this.request<ApiResponse<IssueFrequency[]>>(`/api/v1/projects/${projectId}/issues/${issueId}/frequency`);
  }

  async getIssueEvent(projectId: string, issueId: string, eventId: string): Promise<ApiResponse<EventDetail>> {
    return this.request<ApiResponse<EventDetail>>(`/api/v1/projects/${projectId}/issues/${issueId}/events/${eventId}`);
  }

  // Monitors

  async listMonitors(projectId: string): Promise<PaginatedResponse<Monitor>> {
    return this.request<PaginatedResponse<Monitor>>(`/api/v1/projects/${projectId}/monitors`);
  }

  async createMonitor(projectId: string, data: CreateMonitorData): Promise<Monitor> {
    return this.request<Monitor>(`/api/v1/projects/${projectId}/monitors`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Servers

  async listServers(projectId: string): Promise<ApiResponse<Server[]>> {
    return this.request<ApiResponse<Server[]>>(`/api/v1/projects/${projectId}/servers`);
  }

  // Alerts

  async listAlerts(projectId: string): Promise<AlertRule[]> {
    return this.request<AlertRule[]>(`/api/v1/projects/${projectId}/alerts`);
  }

  async createAlertRule(projectId: string, data: CreateAlertRuleData): Promise<AlertRule> {
    return this.request<AlertRule>(`/api/v1/projects/${projectId}/alerts`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listAlertLogs(projectId: string): Promise<AlertLog[]> {
    return this.request<AlertLog[]>(`/api/v1/projects/${projectId}/alerts/logs`);
  }

  // Comments

  async listComments(projectId: string, issueId: string): Promise<ApiResponse<Comment[]>> {
    return this.request<ApiResponse<Comment[]>>(`/api/v1/projects/${projectId}/issues/${issueId}/comments`);
  }

  async addComment(projectId: string, issueId: string, content: string): Promise<ApiResponse<Comment>> {
    return this.request<ApiResponse<Comment>>(`/api/v1/projects/${projectId}/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }
}
