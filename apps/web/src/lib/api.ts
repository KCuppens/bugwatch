const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

if (process.env.NODE_ENV === "production") {
  if (!API_BASE_URL || API_BASE_URL === "http://localhost:3000") {
    throw new Error("[Bugwatch] NEXT_PUBLIC_API_URL must be set in production.");
  }
  if (!API_BASE_URL.startsWith("https://")) {
    throw new Error(`[Bugwatch] API URL must use HTTPS in production. Got: ${API_BASE_URL}`);
  }
}

export class ApiError extends Error {
  public retryAfterSeconds?: number;

  constructor(
    public status: number,
    public code: string,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiError";
    this.retryAfterSeconds = retryAfterSeconds;
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
 * Clear tokens — no-op for httpOnly cookies (cleared on logout via server).
 * Cleans up any legacy localStorage entries.
 */
export function clearTokens(): void {
  if (typeof window === "undefined") return;
  // Clean up legacy localStorage entries if they exist
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

/**
 * Get the current access token — always returns null.
 * Auth is now handled via httpOnly cookies sent automatically by the browser.
 */
export function getAccessToken(): string | null {
  return null;
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
      // httpOnly refresh cookie is sent automatically via credentials: "include".
      // No body needed — the server reads exclusively from the cookie.
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearTokens();
        }
        return false;
      }

      // Server sets new httpOnly cookies automatically via Set-Cookie headers
      return true;
    } catch (e) {
      // Network error - don't clear tokens, might be temporary
      console.debug("[Auth] Token refresh network error:", e);
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
        const parsed: unknown = JSON.parse(text);
        if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
          errorData = parsed as ApiErrorResponse;
        }
      } catch {
        // Response wasn't valid JSON
      }
    }

    // Extract Retry-After for rate limit responses
    let retryAfterSeconds: number | undefined;
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        retryAfterSeconds = parseInt(retryAfter, 10) || undefined;
      }
    }

    throw new ApiError(
      response.status,
      errorData?.error?.code || "unknown_error",
      response.status === 429 && retryAfterSeconds
        ? `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`
        : errorData?.error?.message || `Request failed with status ${response.status}`,
      retryAfterSeconds
    );
  }

  // Handle empty successful responses (e.g. 204 No Content, DELETE/logout endpoints).
  // Callers for no-body endpoints typically ignore the return value.
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, "parse_error", "Failed to parse server response");
  }
}

const FETCH_MAX_RETRIES = 2;

/**
 * Fetch with automatic 401 retry and exponential-backoff retry for 5xx/network errors.
 * Auth is handled via httpOnly cookies (credentials: "include").
 *
 * Flow: (1) Send request. (2) If 401 on first attempt → refresh token once, retry.
 * (3) If refresh fails → dispatch "bugwatch-auth-expired" so AuthProvider redirects to
 * /login. (4) If 5xx or network error → retry up to FETCH_MAX_RETRIES times with
 * exponential backoff + jitter. 4xx (other than 401-on-first) fail fast.
 */
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  let lastNetworkError: Error | null = null;

  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with ±250ms jitter: ~1s, ~2s
      const delay = 1000 * Math.pow(2, attempt - 1) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
      console.debug(`[API] Retrying request (${attempt}/${FETCH_MAX_RETRIES}): ${url}`);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers, credentials: "include" });
    } catch (e) {
      lastNetworkError = e as Error;
      if (attempt < FETCH_MAX_RETRIES) continue;
      throw lastNetworkError;
    }

    // 401 on first attempt: attempt token refresh once (5xx retries skip this)
    if (response.status === 401 && attempt === 0 && typeof window !== "undefined") {
      const refreshed = await refreshTokens();
      if (refreshed) {
        response = await fetch(url, { ...options, headers, credentials: "include" });
        // If the retry after a successful refresh is still 401, the new token was
        // immediately rejected (e.g. another tab rotated the session first). Treat
        // as session expiry so the page never sees the raw server auth message.
        if (response.status === 401) {
          console.debug("[Auth] Retry still 401 after refresh — dispatching bugwatch-auth-expired for:", url);
          window.dispatchEvent(new Event("bugwatch-auth-expired"));
          throw new ApiError(401, "session_expired", "Session expired. Redirecting to login.");
        }
      } else {
        // Refresh failed — session is fully expired. Throw a sentinel so pages can
        // identify auth expiry without exposing the raw server error message.
        console.debug("[Auth] Session expired — dispatching bugwatch-auth-expired for:", url);
        window.dispatchEvent(new Event("bugwatch-auth-expired"));
        throw new ApiError(401, "session_expired", "Session expired. Redirecting to login.");
      }
    }

    // 5xx: retry with backoff (4xx are client errors — fail fast)
    if (response.status >= 500 && attempt < FETCH_MAX_RETRIES) {
      console.debug(`[API] Server error ${response.status}, will retry (${attempt + 1}/${FETCH_MAX_RETRIES}): ${url}`);
      continue;
    }

    return response;
  }

  throw lastNetworkError || new Error("Request failed after max retries");
}

export const api = {
  async get<T>(endpoint: string, options?: { signal?: AbortSignal }): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "GET",
      signal: options?.signal,
    });
    return handleResponse<T>(response);
  },

  async post<T>(endpoint: string, data?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(endpoint: string, data?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(endpoint: string, options?: { signal?: AbortSignal }): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
      method: "DELETE",
      signal: options?.signal,
    });
    return handleResponse<T>(response);
  },
};

// ============================================================================
// Client-Side Rate Limiting
// ============================================================================

// Simple in-memory rate limiter. Resets on page reload — not a substitute for
// server-side rate limiting; prevents UI bugs and accidental rapid repeated calls.
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxCalls: number, windowMs: number): void {
  const now = Date.now();
  const entry = rateLimitState.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitState.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (entry.count >= maxCalls) {
    const waitSec = Math.ceil((entry.resetAt - now) / 1000);
    throw new ApiError(429, "rate_limit_exceeded", `Too many attempts. Please wait ${waitSec} seconds and try again.`);
  }

  entry.count++;
}

// Auth API endpoints
export const authApi = {
  async signup(email: string, password: string, name?: string) {
    checkRateLimit("auth:signup", 3, 60_000); // 3 per minute
    return api.post<{ data: { user: User } }>("/api/v1/auth/signup", { email, password, name });
  },

  async login(email: string, password: string) {
    checkRateLimit("auth:login", 5, 60_000); // 5 per minute
    return api.post<{ data: { user: User } }>("/api/v1/auth/login", { email, password });
  },

  async logout() {
    return api.post<{ data: { message: string } }>("/api/v1/auth/logout");
  },

  async refresh() {
    // Delegate to refreshTokens() for deduplication — prevents concurrent refresh races
    const success = await refreshTokens();
    if (!success) throw new ApiError(401, "session_expired", "Session expired.");
    return { data: { expires_in: 0 } } as { data: { expires_in: number } };
  },

  async me() {
    return api.get<{ data: User }>("/api/v1/auth/me");
  },

  async updateProfile(data: { name?: string }) {
    return api.patch<{ data: { message: string } }>("/api/v1/auth/me", data);
  },

  async changePassword(currentPassword: string, newPassword: string) {
    checkRateLimit("auth:changePassword", 3, 900_000); // 3 per 15 minutes
    return api.post<{ data: { message: string } }>("/api/v1/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  async forgotPassword(email: string) {
    checkRateLimit("auth:forgotPassword", 3, 3_600_000); // 3 per hour
    return api.post<{ data: { message: string } }>("/api/v1/auth/forgot-password", { email });
  },

  async resetPassword(token: string, newPassword: string) {
    checkRateLimit("auth:resetPassword", 5, 3_600_000); // 5 per hour
    return api.post<{ data: { message: string } }>("/api/v1/auth/reset-password", {
      token,
      new_password: newPassword,
    });
  },
};

// Types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  tier: "free" | "pro" | "team" | "enterprise";
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

export type Platform = "javascript" | "python" | "rust" | "go" | "java" | "ruby" | "php";

export type JavaScriptFramework = "nextjs" | "react" | "node" | "express" | "fastify" | "core";
export type PythonFramework = "django" | "flask" | "fastapi" | "celery";
export type RustFramework = "blocking" | "async";
export type GoFramework = "net_http" | "gin" | "echo";
export type JavaFramework = "spring";
export type RubyFramework = "rack" | "rails" | "sidekiq";
export type PhpFramework = "laravel" | "symfony";
export type Framework =
  | JavaScriptFramework
  | PythonFramework
  | RustFramework
  | GoFramework
  | JavaFramework
  | RubyFramework
  | PhpFramework;

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
  environment: string;
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
  vars?: Record<string, unknown>; // Local variables at this frame
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
    return api.get<PaginatedResponse<Project>>(`/api/v1/projects?page=${page}&per_page=${perPage}`);
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

  async update(id: string, data: { name?: string; platform?: string; framework?: string }) {
    return api.patch<{ data: Project }>(`/api/v1/projects/${id}`, data);
  },

  async delete(id: string) {
    return api.delete<{ data: { message: string } }>(`/api/v1/projects/${id}`);
  },

  async rotateApiKey(id: string) {
    return api.post<{ data: Project }>(`/api/v1/projects/${id}/keys`);
  },

  async completeOnboarding(id: string) {
    return api.post<{ data: Project }>(`/api/v1/projects/${id}/onboarding/complete`);
  },

  async verifyEvents(id: string) {
    return api.get<{ data: { status: string; event_count: number } }>(`/api/v1/projects/${id}/verify`);
  },
};

// Search types
export interface SearchFilters {
  status?: string[];
  level?: string[];
  environment?: string[];
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
  environment: Record<string, number>;
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
    return api.get<PaginatedResponse<Issue>>(`/api/v1/projects/${projectId}/issues${query ? `?${query}` : ""}`);
  },

  async search(projectId: string, request: SearchRequest, options?: { signal?: AbortSignal }) {
    return api.post<SearchResponse>(`/api/v1/projects/${projectId}/issues/_search`, request, options);
  },

  async get(projectId: string, issueId: string, options?: { signal?: AbortSignal }) {
    return api.get<{ data: IssueDetail }>(`/api/v1/projects/${projectId}/issues/${issueId}`, options);
  },

  async update(projectId: string, issueId: string, status: string) {
    return api.patch<{ data: Issue }>(`/api/v1/projects/${projectId}/issues/${issueId}`, { status });
  },

  async delete(projectId: string, issueId: string) {
    return api.delete<{ data: { message: string } }>(`/api/v1/projects/${projectId}/issues/${issueId}`);
  },

  async getEvent(projectId: string, issueId: string, eventId: string) {
    return api.get<{ data: EventDetail }>(`/api/v1/projects/${projectId}/issues/${issueId}/events/${eventId}`);
  },

  async getFrequency(projectId: string, issueId: string, period: "24h" | "7d" | "30d" = "24h") {
    return api.get<{ data: FrequencyData }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/frequency?period=${period}`
    );
  },

  async getImpact(projectId: string, issueId: string) {
    return api.get<{ data: ImpactData }>(`/api/v1/projects/${projectId}/issues/${issueId}/impact`);
  },

  async listComments(projectId: string, issueId: string, page = 1) {
    return api.get<{ data: IssueComment[] }>(`/api/v1/projects/${projectId}/issues/${issueId}/comments?page=${page}`);
  },

  async createComment(projectId: string, issueId: string, content: string) {
    return api.post<{ data: IssueComment }>(`/api/v1/projects/${projectId}/issues/${issueId}/comments`, { content });
  },

  async updateComment(projectId: string, issueId: string, commentId: string, content: string) {
    return api.patch<{ data: IssueComment }>(`/api/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`, {
      content,
    });
  },

  async deleteComment(projectId: string, issueId: string, commentId: string) {
    return api.delete<{ data: { message: string } }>(
      `/api/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`
    );
  },
};

// Onboarding API
export const onboardingApi = {
  async saveProfile(profile: { role: string; use_case: string; team_size: string }) {
    return api.patch<{ data: { message: string } }>("/api/v1/auth/me/onboarding", profile);
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

// Cross-project alert/monitor types
export interface AlertLogWithProjectInfo {
  id: string;
  alert_rule_id: string;
  rule_name: string;
  project_id: string;
  project_name: string;
  trigger_type: string;
  trigger_id: string | null;
  status: string;
  message: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface MonitorWithProjectInfo {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  url: string;
  current_status: string;
  uptime_24h: number | null;
  avg_response_24h: number | null;
  last_error: string | null;
  last_checked_at: string | null;
}

export interface MonitorsSummary {
  total: number;
  up: number;
  down: number;
}

// Cross-Project Issues API
export const overviewApi = {
  async getIssuesAcrossProjects(params?: { status?: string; page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const query = searchParams.toString();
    return api.get<AcrossProjectsResponse>(`/api/v1/issues/across-projects${query ? `?${query}` : ""}`);
  },

  async getStatsByProject() {
    return api.get<ProjectStatsResponse>("/api/v1/issues/stats/by-project");
  },

  async getAlertLogsAcrossProjects(limit = 10) {
    return api.get<{ data: AlertLogWithProjectInfo[] }>(`/api/v1/alerts/across-projects?limit=${limit}`);
  },

  async getMonitorsAcrossProjects() {
    return api.get<{ data: MonitorWithProjectInfo[]; summary: MonitorsSummary }>(`/api/v1/monitors/across-projects`);
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
  muted_until: string | null;
}

export type AlertCondition =
  | { type: "new_issue"; level?: string }
  | { type: "issue_frequency"; threshold: number; window_minutes: number }
  | { type: "monitor_down"; monitor_id?: string }
  | { type: "monitor_recovery"; monitor_id?: string }
  | { type: "server_cpu_high"; threshold_percent: number; server_id?: string }
  | { type: "server_memory_high"; threshold_percent: number; server_id?: string }
  | { type: "server_disk_high"; threshold_percent: number; mount?: string; server_id?: string }
  | { type: "server_offline"; missing_minutes?: number; server_id?: string };

export interface NotificationChannel {
  id: string;
  project_id: string;
  name: string;
  channel_type: "email" | "webhook" | "slack" | "pagerduty" | "opsgenie";
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
  | { webhook_url: string; channel?: string; message_template?: SlackMessageTemplate }
  | { routing_key: string; severity_mapping?: Record<string, string> }
  | { api_key: string; team?: string; priority_mapping?: Record<string, string> };

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
  channel_type: "email" | "webhook" | "slack" | "pagerduty" | "opsgenie";
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

  async updateChannel(
    projectId: string,
    channelId: string,
    data: Partial<CreateChannelRequest> & { is_active?: boolean }
  ) {
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

  async muteRule(projectId: string, ruleId: string, durationMinutes: number) {
    return api.post<AlertRule>(`/api/v1/projects/${projectId}/alerts/${ruleId}/mute`, {
      duration_minutes: durationMinutes,
    });
  },

  async unmuteRule(projectId: string, ruleId: string) {
    return api.post<AlertRule>(`/api/v1/projects/${projectId}/alerts/${ruleId}/unmute`);
  },

  async testRule(projectId: string, ruleId: string) {
    return api.post<{ message: string }>(`/api/v1/projects/${projectId}/alerts/${ruleId}/test`);
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
    return api.get<MonitorDetailResponse>(`/api/v1/projects/${projectId}/monitors/${monitorId}`);
  },

  async create(projectId: string, data: CreateMonitorRequest) {
    return api.post<MonitorResponse>(`/api/v1/projects/${projectId}/monitors`, data);
  },

  async update(projectId: string, monitorId: string, data: UpdateMonitorRequest) {
    return api.patch<MonitorResponse>(`/api/v1/projects/${projectId}/monitors/${monitorId}`, data);
  },

  async delete(projectId: string, monitorId: string) {
    return api.delete<{ message: string }>(`/api/v1/projects/${projectId}/monitors/${monitorId}`);
  },

  async listChecks(projectId: string, monitorId: string, limit = 100) {
    return api.get<MonitorCheck[]>(`/api/v1/projects/${projectId}/monitors/${monitorId}/checks?limit=${limit}`);
  },
};

// Billing API
// Note: Billing endpoints return data directly (no { data: ... } wrapper)
export const billingApi = {
  // Organization
  async getOrganization() {
    return api.get<{ organization: Organization; members_count: number; is_owner: boolean }>("/api/v1/organization");
  },

  async createOrganization(name: string) {
    return api.post<Organization>("/api/v1/organization", { name });
  },

  async updateOrganization(name: string) {
    return api.patch<Organization>("/api/v1/organization", { name });
  },

  // Members
  async listMembers() {
    return api.get<OrganizationMember[]>("/api/v1/organization/members");
  },

  async addMember(email: string, role: string = "member") {
    return api.post<OrganizationMember>("/api/v1/organization/members", { email, role });
  },

  async removeMember(userId: string) {
    return api.delete<{ message: string }>(`/api/v1/organization/members/${userId}`);
  },

  async updateMemberRole(userId: string, role: string) {
    return api.patch<OrganizationMember>(`/api/v1/organization/members/${userId}`, { role });
  },

  // Subscription
  async getSubscription() {
    return api.get<Subscription>("/api/v1/billing/subscription");
  },

  async createCheckout(tier: string, seats: number, annual: boolean, successUrl: string, cancelUrl: string) {
    return api.post<{ checkout_url: string }>("/api/v1/billing/checkout", {
      tier,
      seats,
      annual,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  },

  async verifyCheckout(sessionId: string) {
    return api.post<VerifyCheckoutResponse>("/api/v1/billing/verify-checkout", {
      session_id: sessionId,
    });
  },

  async createPortal(returnUrl: string) {
    return api.post<{ portal_url: string }>("/api/v1/billing/portal", {
      return_url: returnUrl,
    });
  },

  async cancelSubscription(immediately: boolean = false) {
    return api.post<{ message: string }>("/api/v1/billing/cancel", { immediately });
  },

  // Usage
  async getUsage() {
    return api.get<{ usage: UsageRecord[]; period_start: string; period_end: string }>("/api/v1/billing/usage");
  },

  // Plan changes
  async changePlan(tier: string, seats: number, annual: boolean, couponCode?: string) {
    return api.post<{ subscription: Subscription; message: string }>("/api/v1/billing/change-plan", {
      tier,
      seats,
      annual,
      coupon_code: couponCode,
    });
  },

  async previewPlanChange(tier: string, seats: number, annual: boolean) {
    return api.post<ProrationPreview>("/api/v1/billing/preview-change", {
      tier,
      seats,
      annual,
    });
  },

  async updateSeats(seats: number) {
    return api.post<{ subscription: Subscription; message: string }>("/api/v1/billing/seats", { seats });
  },

  // Invoices
  async listInvoices() {
    return api.get<{ invoices: Invoice[] }>("/api/v1/billing/invoices");
  },

  async getInvoice(invoiceId: string) {
    return api.get<InvoiceDetail>(`/api/v1/billing/invoices/${invoiceId}`);
  },

  // Payment methods
  async listPaymentMethods() {
    return api.get<{ payment_methods: PaymentMethod[]; default_payment_method: string | null }>(
      "/api/v1/billing/payment-methods"
    );
  },

  async createSetupIntent() {
    return api.post<{ client_secret: string }>("/api/v1/billing/setup-intent");
  },

  async setDefaultPaymentMethod(paymentMethodId: string) {
    return api.post<{ success: boolean }>("/api/v1/billing/payment-methods/default", {
      payment_method_id: paymentMethodId,
    });
  },

  async deletePaymentMethod(paymentMethodId: string) {
    return api.delete<{ success: boolean }>(`/api/v1/billing/payment-methods/${paymentMethodId}`);
  },

  // Coupons
  async validateCoupon(code: string) {
    return api.post<CouponInfo>("/api/v1/billing/validate-coupon", { code });
  },

  // Tax IDs
  async getTaxIds() {
    return api.get<{ tax_ids: TaxIdInfo[] }>("/api/v1/billing/tax-ids");
  },

  async addTaxId(type: string, value: string) {
    return api.post<TaxIdInfo>("/api/v1/billing/tax-ids", { type, value });
  },

  // Dashboard
  async getBillingDashboard() {
    return api.get<BillingDashboard>("/api/v1/billing/dashboard");
  },

  async getUsageHistory() {
    return api.get<{ history: UsageHistoryRecord[] }>("/api/v1/billing/usage/history");
  },
};

// ============================================================================
// Server Monitoring Types
// ============================================================================

export interface ServerInfo {
  id: string;
  project_id: string;
  server_id: string;
  hostname: string;
  os: string | null;
  kernel: string | null;
  first_seen: string;
  last_seen: string;
  is_active: boolean;
}

export interface ServerMetricData {
  id: string;
  recorded_at: string;
  cpu_usage_percent: number | null;
  load_avg_1: number | null;
  load_avg_5: number | null;
  load_avg_15: number | null;
  mem_total_bytes: number | null;
  mem_used_bytes: number | null;
  mem_available_bytes: number | null;
  mem_usage_percent: number | null;
  swap_total_bytes: number | null;
  swap_used_bytes: number | null;
  net_rx_bytes_per_sec: number | null;
  net_tx_bytes_per_sec: number | null;
  uptime_seconds: number | null;
  disks: DiskInfoData[] | null;
  processes: ProcessInfoData[] | null;
  docker: DockerInfoData[] | null;
}

export interface DiskInfoData {
  mount: string;
  filesystem: string | null;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  usage_percent: number;
}

export interface ProcessInfoData {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_percent: number;
  user: string | null;
}

export interface DockerInfoData {
  name: string;
  id: string;
  status: string;
  cpu_percent: number | null;
  mem_usage: string | null;
  mem_percent: number | null;
}

export interface ServerStatus {
  has_agent: boolean;
  server_count: number;
}

// Server Monitoring API
export const serversApi = {
  async listServers(projectId: string) {
    return api.get<{ data: ServerInfo[] }>(`/api/v1/projects/${projectId}/servers`);
  },

  async hasAgent(projectId: string) {
    return api.get<ServerStatus>(`/api/v1/projects/${projectId}/servers/status`);
  },

  async getMetrics(projectId: string, serverId: string, period: string = "1h") {
    return api.get<{ data: ServerMetricData[] }>(
      `/api/v1/projects/${projectId}/servers/${serverId}/metrics?period=${period}`
    );
  },

  async getLatest(projectId: string, serverId: string) {
    return api.get<{ data: ServerMetricData | null; server: ServerInfo }>(
      `/api/v1/projects/${projectId}/servers/${serverId}/metrics/latest`
    );
  },
};

// ============================================================================
// Performance Monitoring Types
// ============================================================================

export interface PerformanceSummary {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  throughput: number;
  error_rate: number;
  total_transactions: number;
}

export interface TransactionAggregate {
  transaction_name: string;
  count: number;
  p50: number;
  p95: number;
  error_rate: number;
  avg_duration_ms: number;
}

export interface TimeSeriesPoint {
  timestamp: string;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  throughput: number;
  error_count: number;
}

// Performance Monitoring API
export const performanceApi = {
  async getSummary(projectId: string, start?: string, end?: string) {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return api.get<{ data: PerformanceSummary }>(`/api/v1/projects/${projectId}/performance/summary?${params}`);
  },

  async listTransactions(projectId: string, start?: string, end?: string, limit = 20) {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    params.set("limit", String(limit));
    return api.get<{ data: TransactionAggregate[] }>(
      `/api/v1/projects/${projectId}/performance/transactions?${params}`
    );
  },

  async getCharts(projectId: string, start?: string, end?: string, interval = "1h") {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    params.set("interval", interval);
    return api.get<{ data: TimeSeriesPoint[] }>(`/api/v1/projects/${projectId}/performance/charts?${params}`);
  },
};

// ============================================================================
// Integrations Types & API
// ============================================================================

export interface IntegrationInfo {
  id: string;
  organization_id: string;
  provider: "github" | "jira" | "linear";
  external_username?: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface IssueLinkInfo {
  id: string;
  issue_id: string;
  integration_id: string;
  provider: string;
  external_issue_id: string;
  external_issue_key: string;
  external_issue_url: string;
  external_status?: string;
  sync_enabled: boolean;
  created_at: string;
}

export const integrationsApi = {
  async list() {
    return api.get<{ data: IntegrationInfo[] }>("/api/v1/integrations");
  },
  async getOAuthUrl(provider: string) {
    return api.get<{ data: { url: string } }>(`/api/v1/integrations/oauth/${provider}/authorize`);
  },
  async disconnect(integrationId: string) {
    return api.delete<{ data: { message: string } }>(`/api/v1/integrations/${integrationId}`);
  },
  async listIssueLinks(projectId: string, issueId: string) {
    return api.get<{ data: IssueLinkInfo[] }>(`/api/v1/projects/${projectId}/issues/${issueId}/links`);
  },
  async createIssueLink(
    projectId: string,
    issueId: string,
    data: { provider: string; config: Record<string, string> }
  ) {
    return api.post<{ data: IssueLinkInfo }>(`/api/v1/projects/${projectId}/issues/${issueId}/links`, data);
  },
  async deleteIssueLink(projectId: string, issueId: string, linkId: string) {
    return api.delete<{ data: { message: string } }>(`/api/v1/projects/${projectId}/issues/${issueId}/links/${linkId}`);
  },
};

// ============================================================================
// Session Replay Types & API
// ============================================================================

export interface SessionRecording {
  id: string;
  project_id: string;
  session_id: string;
  user_id?: string;
  started_at: string;
  duration_ms?: number;
  is_complete: boolean;
  segment_count: number;
  total_size_bytes: number;
  environment?: string;
  release?: string;
  user_agent?: string;
  screen_width?: number;
  screen_height?: number;
}

export interface SegmentData {
  segment_index: number;
  data: string; // base64 encoded
  size_bytes: number;
}

export const replayApi = {
  async listRecordings(projectId: string, limit = 20, offset = 0) {
    return api.get<{ data: SessionRecording[]; total: number }>(
      `/api/v1/projects/${projectId}/replay?limit=${limit}&offset=${offset}`
    );
  },

  async getRecording(projectId: string, recordingId: string) {
    return api.get<{ data: SessionRecording }>(`/api/v1/projects/${projectId}/replay/${recordingId}`);
  },

  async getSegments(projectId: string, recordingId: string) {
    return api.get<SegmentData[]>(`/api/v1/projects/${projectId}/replay/${recordingId}/segments`);
  },

  async getIssueReplay(projectId: string, issueId: string) {
    return api.get<{ data: SessionRecording | null }>(`/api/v1/projects/${projectId}/issues/${issueId}/replay`);
  },
};
