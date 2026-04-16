import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".bugwatch");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT_URL = "https://api.bugwatch.dev";

interface Config {
  apiKey: string;
  url?: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

/**
 * Load config from ~/.bugwatch/config.json
 */
export async function loadConfig(): Promise<Config | null> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(content) as Config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`Warning: Config file at ${CONFIG_PATH} contains invalid JSON. Ignoring.`);
    }
    return null;
  }
}

/**
 * Save config to ~/.bugwatch/config.json
 */
export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Get the API key from env or config file
 */
function getApiKey(config: Config | null): string {
  const envKey = process.env.BUGWATCH_API_KEY;
  if (envKey) return envKey;
  if (config?.apiKey) return config.apiKey;
  throw new Error('No API key found. Set BUGWATCH_API_KEY or run "bugwatch login" to configure.');
}

/**
 * Get the API base URL from env or config file
 */
function getBaseUrl(config: Config | null): string {
  return process.env.BUGWATCH_URL || config?.url || DEFAULT_URL;
}

// Cache config for the lifetime of the CLI process — config is immutable per invocation
let _configCache: Config | null | undefined = undefined;
async function getCachedConfig(): Promise<Config | null> {
  if (_configCache === undefined) _configCache = await loadConfig();
  return _configCache;
}

/**
 * Make an authenticated API request
 */
async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const config = await getCachedConfig();
  const apiKey = getApiKey(config);
  const baseUrl = getBaseUrl(config);

  const url = new URL(path, baseUrl);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  };

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Log structured error for CLI log aggregation before throwing user-facing message
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: options.method ?? "GET",
        path,
        status: response.status,
        body: text,
      })
    );
    // Extract user-friendly message from JSON response body, fall back to generic
    let userMessage: string;
    try {
      const json = JSON.parse(text) as { message?: string; error?: string };
      userMessage = json.message ?? json.error ?? `Request failed (${response.status})`;
    } catch {
      userMessage = `Request failed (${response.status} ${response.statusText})`;
    }
    throw new Error(userMessage);
  }

  return response.json() as Promise<T>;
}

// ─── Response wrappers (match server response shapes) ────────────────

interface ApiResponse<T> {
  data: T;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

// ─── Typed API methods ───────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  slug?: string;
  unresolved_count?: number;
}

export interface Issue {
  id: string;
  title: string;
  status: string;
  level: string;
  count: number;
  first_seen: string;
  last_seen: string;
  project_id?: string;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  status: string;
  current_status?: string;
  uptime_24h?: number;
  avg_response_24h?: number;
  avg_response_time?: number;
}

export interface Alert {
  id: string;
  rule_name?: string;
  status: string;
  message?: string;
  created_at: string;
}

export interface ListOptions {
  status?: string;
  limit?: number;
}

export async function listProjects(): Promise<Project[]> {
  const resp = await request<PaginatedResponse<Project>>("/api/v1/projects");
  return resp.data;
}

export async function listIssues(projectId?: string, options?: ListOptions): Promise<Issue[]> {
  const params: Record<string, string | number | undefined> = {
    status: options?.status,
    per_page: options?.limit,
  };

  if (projectId) {
    const resp = await request<PaginatedResponse<Issue>>(`/api/v1/projects/${projectId}/issues`, { params });
    return resp.data;
  }
  const resp = await request<PaginatedResponse<Issue>>("/api/v1/issues/across-projects", { params });
  return resp.data;
}

export async function countIssues(projectId: string, status?: string): Promise<number> {
  const params: Record<string, string | number | undefined> = {
    status,
    per_page: 1,
  };
  const resp = await request<PaginatedResponse<Issue>>(`/api/v1/projects/${projectId}/issues`, { params });
  return resp.pagination.total;
}

export async function getIssue(issueId: string, projectId: string): Promise<Issue> {
  const resp = await request<ApiResponse<Issue>>(`/api/v1/projects/${projectId}/issues/${issueId}`);
  return resp.data;
}

export async function updateIssue(issueId: string, projectId: string, data: Record<string, unknown>): Promise<Issue> {
  const resp = await request<ApiResponse<Issue>>(`/api/v1/projects/${projectId}/issues/${issueId}`, {
    method: "PATCH",
    body: data,
  });
  return resp.data;
}

export async function getStatus(projectId?: string): Promise<Project[]> {
  if (projectId) {
    const resp = await request<ApiResponse<Project>>(`/api/v1/projects/${projectId}`);
    return [resp.data];
  }
  const resp = await request<PaginatedResponse<Project>>("/api/v1/projects");
  return resp.data;
}

export async function listMonitors(projectId?: string): Promise<Monitor[]> {
  if (projectId) {
    const resp = await request<PaginatedResponse<Monitor>>(`/api/v1/projects/${projectId}/monitors`);
    return resp.data;
  }
  // Cross-project returns { data: Monitor[], summary: {...} }
  const resp = await request<{ data: Monitor[] }>("/api/v1/monitors/across-projects");
  return resp.data;
}

export async function listAlerts(projectId?: string): Promise<Alert[]> {
  if (projectId) {
    // Project-specific alert logs return raw array (no wrapper)
    return request<Alert[]>(`/api/v1/projects/${projectId}/alerts/logs`);
  }
  // Cross-project returns { data: Alert[] }
  const resp = await request<{ data: Alert[] }>("/api/v1/alerts/across-projects");
  return resp.data;
}
