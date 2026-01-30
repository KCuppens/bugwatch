const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Token Management
// ============================================================================

// Singleton promise to prevent concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;

/**
 * Check if a JWT token is expired (with 30 second buffer)
 */
export function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    const payloadPart = parts[1];
    if (!payloadPart) return true;
    const payload = JSON.parse(atob(payloadPart));
    // Add 30 second buffer to avoid edge cases
    return payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true;
  }
}

/**
 * Save tokens to localStorage
 */
export function saveTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("access_token", accessToken);
  localStorage.setItem("refresh_token", refreshToken);
}

/**
 * Clear tokens from localStorage
 */
export function clearTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

/**
 * Get the current access token if valid
 */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("access_token");
  if (!token) return null;
  // Return null if token is expired
  if (isTokenExpired(token)) return null;
  return token;
}

/**
 * Refresh tokens with deduplication - prevents multiple concurrent refresh attempts
 */
export async function refreshTokens(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // If refresh already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem("refresh_token");
      if (!refreshToken) return false;

      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        // Only clear tokens on 401 (invalid/expired refresh token)
        if (response.status === 401) {
          clearTokens();
        }
        return false;
      }

      const data = await response.json();
      saveTokens(data.data.access_token, data.data.refresh_token);
      return true;
    } catch {
      // Network error - don't clear tokens, might be temporary
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function handleResponse<T>(response: Response): Promise<T> {
  // Clone response to read text safely (can only read body once)
  const text = await response.text();

  if (!response.ok) {
    // Try to parse error JSON, fallback to generic error
    let errorData: ApiErrorResponse | null = null;
    if (text) {
      try {
        errorData = JSON.parse(text) as ApiErrorResponse;
      } catch {
        // Response wasn't valid JSON
      }
    }
    throw new ApiError(
      response.status,
      errorData?.error?.code || "unknown_error",
      errorData?.error?.message || `Request failed with status ${response.status}`
    );
  }

  // Handle empty successful responses
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      response.status,
      "parse_error",
      "Failed to parse server response"
    );
  }
}

function getAuthHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = getAccessToken(); // Uses the new function that checks expiry
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetch with automatic 401 retry - attempts token refresh on 401 and retries once
 */
async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
    ...(options.headers || {}),
  };

  let response = await fetch(url, { ...options, headers });

  // If 401 and we have a refresh token, try to refresh and retry
  if (response.status === 401) {
    const hasRefreshToken = typeof window !== "undefined" && localStorage.getItem("refresh_token");
    if (hasRefreshToken) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        // Retry with new token
        const newHeaders = {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
          ...(options.headers || {}),
        };
        response = await fetch(url, { ...options, headers: newHeaders });
      }
    }
  }

  return response;
}

export const api = {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "GET",
    });
    return handleResponse<T>(response);
  },

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "DELETE",
    });
    return handleResponse<T>(response);
  },
};

// Auth API endpoints
export const authApi = {
  async signup(email: string, password: string, name?: string) {
    return api.post<{ data: { user: User; tokens: TokenPair } }>(
      "/api/v1/auth/signup",
      { email, password, name }
    );
  },

  async login(email: string, password: string) {
    return api.post<{ data: { user: User; tokens: TokenPair } }>(
      "/api/v1/auth/login",
      { email, password }
    );
  },

  async logout() {
    return api.post<{ data: { message: string } }>("/api/v1/auth/logout");
  },

  async refresh(refreshToken: string) {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return handleResponse<{ data: TokenPair }>(response);
  },

  async me() {
    return api.get<{ data: User }>("/api/v1/auth/me");
  },
};

// Types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  seats: number;
  subscription_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  credits: number;
  organization: Organization | null;
}

export interface Subscription {
  tier: string;
  seats: number;
  subscription_status: string;
  billing_interval: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_stripe: boolean;
}

export interface UsageRecord {
  metric: string;
  count: number;
  period_start: string;
  period_end: string;
}

// Billing types
export interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amount_due: number | null;
  amount_paid: number | null;
  currency: string | null;
  created: string | null;
  period_start: string | null;
  period_end: string | null;
  invoice_pdf: string | null;
  hosted_invoice_url: string | null;
}

export interface InvoiceLineItem {
  id: string;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  period_start: string | null;
  period_end: string | null;
}

export interface InvoiceDetail extends Invoice {
  amount_remaining: number | null;
  due_date: string | null;
  line_items: InvoiceLineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

export interface PaymentMethod {
  id: string;
  type: string;
  card: CardInfo | null;
  created: string | null;
}

export interface CardInfo {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

export interface CouponInfo {
  id: string;
  code: string | null;
  name: string | null;
  valid: boolean;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  duration_in_months: number | null;
}

export interface TaxIdInfo {
  id: string;
  type: string;
  value: string;
  verification_status: string | null;
  country: string | null;
}

export interface ProrationPreview {
  current_amount_cents: number;
  new_amount_cents: number;
  proration_amount_cents: number;
  immediate_charge: boolean;
}

export interface VerifyCheckoutResponse {
  success: boolean;
  subscription: Subscription | null;
  message: string;
  already_processed: boolean;
}

export interface BillingDashboard {
  current_tier: string;
  monthly_cost_cents: number;
  seats_used: number;
  seats_total: number;
  billing_period_start: string | null;
  billing_period_end: string | null;
  is_past_due: boolean;
  cancel_at_period_end: boolean;
}

export interface UsageHistoryRecord {
  metric: string;
  count: number;
  period_start: string;
  period_end: string;
}

export interface OrganizationMember {
  member: {
    id: string;
    organization_id: string;
    user_id: string;
    role: string;
    created_at: string;
  };
  user_email: string;
  user_name: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  api_key: string;
  owner_id: string;
  created_at: string;
  platform: string | null;
  framework: string | null;
  onboarding_completed_at: string | null;
}

export type Platform = "javascript" | "python" | "rust";

export type JavaScriptFramework = "nextjs" | "react" | "node" | "core";
export type PythonFramework = "django" | "flask" | "fastapi" | "celery";
export type RustFramework = "blocking" | "async";
export type Framework = JavaScriptFramework | PythonFramework | RustFramework;

export interface Issue {
  id: string;
  project_id: string;
  fingerprint: string;
  title: string;
  level: string;
  status: string;
  count: number;
  user_count: number;
  first_seen: string;
  last_seen: string;
}

export interface BreadcrumbDetail {
  timestamp: string;
  type: string;
  category: string;
  message?: string;
  level: string;
  data?: Record<string, unknown>;
}

export interface RequestContextDetail {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query_string?: string;
  data?: unknown;
}

export interface UserContextDetail {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
  extra?: Record<string, unknown>;
}

export interface IssueDetail extends Issue {
  exception?: ExceptionDetail;
  recent_events: EventSummary[];
  tags: Record<string, string>;
  breadcrumbs: BreadcrumbDetail[];
  request?: RequestContextDetail;
  user?: UserContextDetail;
  extra?: Record<string, unknown>;
}

export interface ExceptionDetail {
  type: string;
  value: string;
  stacktrace: StackFrameDetail[];
}

export interface StackFrameDetail {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
  vars?: Record<string, unknown>;  // Local variables at this frame
}

export interface EventSummary {
  id: string;
  timestamp: string;
  user_id?: string;
  release?: string;
}

export interface EventDetail {
  id: string;
  issue_id: string;
  event_id: string;
  timestamp: string;
  exception?: ExceptionDetail;
  breadcrumbs: BreadcrumbDetail[];
  request?: RequestContextDetail;
  user?: UserContextDetail;
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
  release?: string;
  environment?: string;
  server_name?: string;
}

export interface FrequencyBucket {
  timestamp: string;
  count: number;
}

export interface FrequencyData {
  buckets: FrequencyBucket[];
  period: string;
  total: number;
}

export interface DistributionItem {
  name: string;
  count: number;
  percentage: number;
}

export interface ImpactData {
  unique_users: number;
  unique_sessions: number;
  total_events: number;
  first_seen: string;
  last_seen: string;
  last_hour_count: number;
  trend_percent: number;
  is_trending: boolean;
  browsers: DistributionItem[];
  operating_systems: DistributionItem[];
}

export interface IssueComment {
  id: string;
  issue_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// AI Fix types
export interface AiFixRequest {
  error_type: string;
  error_message: string;
  stack_trace: StackFrameInput[];
  environment?: string;
  runtime?: string;
}

export interface StackFrameInput {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

export interface AiFix {
  explanation: string;
  fix_code: string;
  recommendations: string[];
  confidence: number;
}

export interface AiFixResponse {
  fix: AiFix;
  credits_used: number;
  credits_remaining: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

// Projects API
export const projectsApi = {
  async list(page = 1, perPage = 20) {
    return api.get<PaginatedResponse<Project>>(
      `/api/v1/projects?page=${page}&per_page=${perPage}`
    );
  },

  async get(id: string) {
    return api.get<{ data: Project }>(`/api/v1/projects/${id}`);
  },

  async create(name: string, platform?: string, framework?: string) {
    return api.post<{ data: Project }>("/api/v1/projects", {
      name,
      platform,
      framework,
    });
  },

  async update(
    id: string,
    data: { name?: string; platform?: string; framework?: string }
  ) {
    return api.patch<{ data: Project }>(`/api/v1/projects/${id}`, data);
  },

  async delete(id: string) {
    return api.delete<{ data: { message: string } }>(`/api/v1/projects/${id}`);
  },

  async rotateApiKey(id: string) {
    return api.post<{ data: Project }>(`/api/v1/projects/${id}/keys`);
  },

  async completeOnboarding(id: string) {
    return api.post<{ data: Project }>(
      `/api/v1/projects/${id}/onboarding/complete`
    );
  },

  async verifyEvents(id: string) {
    return api.get<{ data: { status: string; event_count: number } }>(
      `/api/v1/projects/${id}/verify`
    );
  },
};

// Search types
export interface SearchFilters {
  status?: string[];
  level?: string[];
  count_gt?: number;
  count_lt?: number;
  count_gte?: number;
  count_lte?: number;
  users_gt?: number;
  users_lt?: number;
  first_seen_after?: string;
  first_seen_before?: string;
  last_seen_after?: string;
  last_seen_before?: string;
  text?: string;
}

export interface SearchSort {
  field: string;
  direction?: "asc" | "desc";
}

export interface SearchRequest {
  filters?: SearchFilters;
  sort?: SearchSort;
  page?: number;
  per_page?: number;
}

export interface Facets {
  level: Record<string, number>;
  status: Record<string, number>;
}

export interface SearchResponse {
  data: Issue[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
  facets: Facets;
  query_time_ms?: number;
}

// Issues API
export const issuesApi = {
  async list(projectId: string, params?: { page?: number; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return api.get<PaginatedResponse<Issue>>(
      `/api/v1/projects/${projectId}/issues${query ? `?${query}` : ""}`
    );
  },

  async search(projectId: string, request: SearchRequest) {
    return api.post<SearchResponse>(
      `/api/v1/projects/${projectId}/issues/_search`,
      request
    );
  },

  async get(projectId: string, issueId: string) {
    return api.get<{ data: IssueDetail }>(
      `/api/v1/projects/${projectId}/issues/${issueId}`
    );
  },

  async update(projectId: string, issueId: string, status: string) {
    return api.patch<{ data: Issue }>(
      `/api/v1/projects/${projectId}/issues/${issueId}`,
      { status }
    );
  },

  async delete(projectId: string, issueId: string) {
    return api.delete<{ data: { message: string } }>(
      `/api/v1/projects/${projectId}/issues/${issueId}`
    );
  },

  async getEvent(projectId: string, issueId: string, eventId: string) {
    return api.get<{ data: EventDetail }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/events/${eventId}`
    );
  },

  async getFrequency(projectId: string, issueId: string, period: "24h" | "7d" | "30d" = "24h") {
    return api.get<{ data: FrequencyData }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/frequency?period=${period}`
    );
  },

  async getImpact(projectId: string, issueId: string) {
    return api.get<{ data: ImpactData }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/impact`
    );
  },

  async listComments(projectId: string, issueId: string, page = 1) {
    return api.get<{ data: IssueComment[] }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/comments?page=${page}`
    );
  },

  async createComment(projectId: string, issueId: string, content: string) {
    return api.post<{ data: IssueComment }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/comments`,
      { content }
    );
  },

  async updateComment(projectId: string, issueId: string, commentId: string, content: string) {
    return api.patch<{ data: IssueComment }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`,
      { content }
    );
  },

  async deleteComment(projectId: string, issueId: string, commentId: string) {
    return api.delete<{ data: { message: string } }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`
    );
  },
};

// AI Fix API
export const aiFixApi = {
  async generateFix(projectId: string, issueId: string, request: AiFixRequest) {
    return api.post<AiFixResponse>(
      `/api/v1/projects/${projectId}/issues/${issueId}/ai-fix`,
      request
    );
  },

  async generateFixStandalone(request: AiFixRequest) {
    return api.post<AiFixResponse>("/api/v1/ai/generate-fix", request);
  },
};

// Cross-Project Types
export interface IssueWithProject extends Issue {
  project_name: string;
  project_slug: string;
  project_platform: string | null;
}

export interface ProjectStatsWithInfo {
  project_id: string;
  project_name: string;
  project_slug: string;
  project_platform: string | null;
  unresolved_count: number;
  total_events: number;
  total_users: number;
  critical_count: number;
}

export interface AggregateTotals {
  unresolved: number;
  events: number;
  users: number;
  critical: number;
}

export interface AcrossProjectsResponse {
  data: IssueWithProject[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface ProjectStatsResponse {
  data: ProjectStatsWithInfo[];
  totals: AggregateTotals;
}

// Cross-Project Issues API
export const overviewApi = {
  async getIssuesAcrossProjects(params?: { status?: string; page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const query = searchParams.toString();
    return api.get<AcrossProjectsResponse>(
      `/api/v1/issues/across-projects${query ? `?${query}` : ""}`
    );
  },

  async getStatsByProject() {
    return api.get<ProjectStatsResponse>("/api/v1/issues/stats/by-project");
  },
};

// Monitor types
export interface Monitor {
  id: string;
  project_id: string;
  name: string;
  url: string;
  method: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status: number | null;
  headers: string;
  body: string | null;
  is_active: boolean;
  created_at: string;
  last_checked_at: string | null;
  current_status: string;
}

export interface MonitorResponse extends Monitor {
  uptime_24h: number | null;
  avg_response_24h: number | null;
  last_error: string | null;
}

export interface MonitorCheck {
  id: string;
  monitor_id: string;
  status: string;
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  checked_at: string;
}

export interface MonitorIncident {
  id: string;
  monitor_id: string;
  started_at: string;
  resolved_at: string | null;
  cause: string | null;
  created_at: string;
}

export interface MonitorDetailResponse extends MonitorResponse {
  recent_checks: MonitorCheck[];
  recent_incidents: MonitorIncident[];
}

export interface CreateMonitorRequest {
  name: string;
  url: string;
  method?: string;
  interval_seconds?: number;
  timeout_ms?: number;
  expected_status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface UpdateMonitorRequest {
  name?: string;
  url?: string;
  method?: string;
  interval_seconds?: number;
  timeout_ms?: number;
  expected_status?: number;
  headers?: Record<string, string>;
  body?: string;
  is_active?: boolean;
}

// Alert types
export interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  condition: AlertCondition;
  channel_ids: string[];
  is_active: boolean;
  created_at: string;
}

export type AlertCondition =
  | { type: "new_issue"; level?: string }
  | { type: "issue_frequency"; threshold: number; window_minutes: number }
  | { type: "monitor_down"; monitor_id?: string }
  | { type: "monitor_recovery"; monitor_id?: string };

export interface NotificationChannel {
  id: string;
  project_id: string;
  name: string;
  channel_type: "email" | "webhook" | "slack";
  config: ChannelConfig;
  is_active: boolean;
  created_at: string;
}

export interface SlackMessageTemplate {
  blocks: { block_type: string; enabled: boolean }[];
  actions: { action_type: string; label: string; style: string }[];
}

export type ChannelConfig =
  | { recipients: string[] }
  | { url: string; secret?: string }
  | { webhook_url: string; channel?: string; message_template?: SlackMessageTemplate };

export interface AlertLog {
  id: string;
  alert_rule_id: string;
  channel_id: string | null;
  trigger_type: string;
  trigger_id: string | null;
  status: string;
  message: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface CreateAlertRuleRequest {
  name: string;
  condition: AlertCondition;
  channel_ids: string[];
}

export interface CreateChannelRequest {
  name: string;
  channel_type: "email" | "webhook" | "slack";
  config: ChannelConfig;
}

// Alerts API
export const alertsApi = {
  async listRules(projectId: string) {
    return api.get<AlertRule[]>(`/api/v1/projects/${projectId}/alerts`);
  },

  async createRule(projectId: string, data: CreateAlertRuleRequest) {
    return api.post<AlertRule>(`/api/v1/projects/${projectId}/alerts`, data);
  },

  async updateRule(projectId: string, ruleId: string, data: Partial<CreateAlertRuleRequest> & { is_active?: boolean }) {
    return api.patch<AlertRule>(`/api/v1/projects/${projectId}/alerts/${ruleId}`, data);
  },

  async deleteRule(projectId: string, ruleId: string) {
    return api.delete<{ message: string }>(`/api/v1/projects/${projectId}/alerts/${ruleId}`);
  },

  async listChannels(projectId: string) {
    return api.get<NotificationChannel[]>(`/api/v1/projects/${projectId}/channels`);
  },

  async createChannel(projectId: string, data: CreateChannelRequest) {
    return api.post<NotificationChannel>(`/api/v1/projects/${projectId}/channels`, data);
  },

  async updateChannel(projectId: string, channelId: string, data: Partial<CreateChannelRequest> & { is_active?: boolean }) {
    return api.patch<NotificationChannel>(`/api/v1/projects/${projectId}/channels/${channelId}`, data);
  },

  async deleteChannel(projectId: string, channelId: string) {
    return api.delete<{ message: string }>(`/api/v1/projects/${projectId}/channels/${channelId}`);
  },

  async testChannel(projectId: string, channelId: string) {
    return api.post<{ message: string }>(`/api/v1/projects/${projectId}/channels/${channelId}/test`);
  },

  async listLogs(projectId: string, limit = 50) {
    return api.get<AlertLog[]>(`/api/v1/projects/${projectId}/alerts/logs?limit=${limit}`);
  },
};

// Monitors API
export const monitorsApi = {
  async list(projectId: string, page = 1, perPage = 20) {
    return api.get<PaginatedResponse<MonitorResponse>>(
      `/api/v1/projects/${projectId}/monitors?page=${page}&per_page=${perPage}`
    );
  },

  async get(projectId: string, monitorId: string) {
    return api.get<MonitorDetailResponse>(
      `/api/v1/projects/${projectId}/monitors/${monitorId}`
    );
  },

  async create(projectId: string, data: CreateMonitorRequest) {
    return api.post<MonitorResponse>(
      `/api/v1/projects/${projectId}/monitors`,
      data
    );
  },

  async update(projectId: string, monitorId: string, data: UpdateMonitorRequest) {
    return api.patch<MonitorResponse>(
      `/api/v1/projects/${projectId}/monitors/${monitorId}`,
      data
    );
  },

  async delete(projectId: string, monitorId: string) {
    return api.delete<{ message: string }>(
      `/api/v1/projects/${projectId}/monitors/${monitorId}`
    );
  },

  async listChecks(projectId: string, monitorId: string, limit = 100) {
    return api.get<MonitorCheck[]>(
      `/api/v1/projects/${projectId}/monitors/${monitorId}/checks?limit=${limit}`
    );
  },
};

// Billing API
// Note: Billing endpoints return data directly (no { data: ... } wrapper)
export const billingApi = {
  // Organization
  async getOrganization() {
    return api.get<{ organization: Organization; members_count: number; is_owner: boolean }>(
      '/api/v1/organization'
    );
  },

  async createOrganization(name: string) {
    return api.post<Organization>('/api/v1/organization', { name });
  },

  async updateOrganization(name: string) {
    return api.patch<Organization>('/api/v1/organization', { name });
  },

  // Members
  async listMembers() {
    return api.get<OrganizationMember[]>('/api/v1/organization/members');
  },

  async addMember(email: string, role: string = 'member') {
    return api.post<OrganizationMember>('/api/v1/organization/members', { email, role });
  },

  async removeMember(userId: string) {
    return api.delete<{ message: string }>(`/api/v1/organization/members/${userId}`);
  },

  async updateMemberRole(userId: string, role: string) {
    return api.patch<OrganizationMember>(`/api/v1/organization/members/${userId}`, { role });
  },

  // Subscription
  async getSubscription() {
    return api.get<Subscription>('/api/v1/billing/subscription');
  },

  async createCheckout(tier: string, seats: number, annual: boolean, successUrl: string, cancelUrl: string) {
    return api.post<{ checkout_url: string }>('/api/v1/billing/checkout', {
      tier,
      seats,
      annual,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  },

  async verifyCheckout(sessionId: string) {
    return api.post<VerifyCheckoutResponse>('/api/v1/billing/verify-checkout', {
      session_id: sessionId,
    });
  },

  async createPortal(returnUrl: string) {
    return api.post<{ portal_url: string }>('/api/v1/billing/portal', {
      return_url: returnUrl,
    });
  },

  async cancelSubscription(immediately: boolean = false) {
    return api.post<{ message: string }>('/api/v1/billing/cancel', { immediately });
  },

  // Credits
  async getCredits() {
    return api.get<{ credits: number }>('/api/v1/billing/credits');
  },

  async purchaseCredits(credits: number) {
    return api.post<{ checkout_url: string }>('/api/v1/billing/credits', { credits });
  },

  // Usage
  async getUsage() {
    return api.get<{ usage: UsageRecord[]; period_start: string; period_end: string }>(
      '/api/v1/billing/usage'
    );
  },

  // Plan changes
  async changePlan(tier: string, seats: number, annual: boolean, couponCode?: string) {
    return api.post<{ subscription: Subscription; message: string }>('/api/v1/billing/change-plan', {
      tier,
      seats,
      annual,
      coupon_code: couponCode,
    });
  },

  async previewPlanChange(tier: string, seats: number, annual: boolean) {
    return api.post<ProrationPreview>('/api/v1/billing/preview-change', {
      tier,
      seats,
      annual,
    });
  },

  async updateSeats(seats: number) {
    return api.post<{ subscription: Subscription; message: string }>('/api/v1/billing/seats', { seats });
  },

  // Invoices
  async listInvoices() {
    return api.get<{ invoices: Invoice[] }>('/api/v1/billing/invoices');
  },

  async getInvoice(invoiceId: string) {
    return api.get<InvoiceDetail>(`/api/v1/billing/invoices/${invoiceId}`);
  },

  // Payment methods
  async listPaymentMethods() {
    return api.get<{ payment_methods: PaymentMethod[]; default_payment_method: string | null }>('/api/v1/billing/payment-methods');
  },

  async createSetupIntent() {
    return api.post<{ client_secret: string }>('/api/v1/billing/setup-intent');
  },

  async setDefaultPaymentMethod(paymentMethodId: string) {
    return api.post<{ success: boolean }>('/api/v1/billing/payment-methods/default', {
      payment_method_id: paymentMethodId,
    });
  },

  async deletePaymentMethod(paymentMethodId: string) {
    return api.delete<{ success: boolean }>(`/api/v1/billing/payment-methods/${paymentMethodId}`);
  },

  // Coupons
  async validateCoupon(code: string) {
    return api.post<CouponInfo>('/api/v1/billing/validate-coupon', { code });
  },

  // Tax IDs
  async getTaxIds() {
    return api.get<{ tax_ids: TaxIdInfo[] }>('/api/v1/billing/tax-ids');
  },

  async addTaxId(type: string, value: string) {
    return api.post<TaxIdInfo>('/api/v1/billing/tax-ids', { type, value });
  },

  // Dashboard
  async getBillingDashboard() {
    return api.get<BillingDashboard>('/api/v1/billing/dashboard');
  },

  async getUsageHistory() {
    return api.get<{ history: UsageHistoryRecord[] }>('/api/v1/billing/usage/history');
  },
};
