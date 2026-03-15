export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiResponse<T> {
  data: T;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  platform: string;
  dsn: string;
  created_at: string;
  updated_at: string;
  organization_id: string;
  event_count?: number;
  issue_count?: number;
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  level: "error" | "warning" | "info" | "debug" | "fatal";
  status: "unresolved" | "resolved" | "ignored";
  first_seen: string;
  last_seen: string;
  count: number;
  user_count: number;
  environment?: string;
}

export interface StackFrame {
  filename: string;
  function: string;
  lineno: number;
  colno?: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

export interface EventDetail {
  id: string;
  issue_id: string;
  project_id: string;
  title: string;
  level: string;
  message?: string;
  timestamp: string;
  environment?: string;
  release?: string;
  platform?: string;
  sdk?: {
    name: string;
    version: string;
  };
  stacktrace?: {
    frames: StackFrame[];
  };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: {
    id?: string;
    email?: string;
    username?: string;
    ip_address?: string;
  };
  contexts?: Record<string, unknown>;
}

export interface IssueDetail extends Issue {
  latest_event?: EventDetail;
  tags?: Record<string, string[]>;
}

export interface Monitor {
  id: string;
  project_id: string;
  name: string;
  url: string;
  method: string;
  interval_seconds: number;
  status: "up" | "down" | "pending" | "paused";
  last_check_at?: string;
  last_status_code?: number;
  last_response_time_ms?: number;
  uptime_percentage?: number;
  created_at: string;
  updated_at: string;
}

export interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  condition: string;
  enabled: boolean;
  channel_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface AlertLog {
  id: string;
  alert_rule_id: string;
  project_id: string;
  message: string;
  triggered_at: string;
  resolved_at?: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface Server {
  id: string;
  project_id: string;
  hostname: string;
  os?: string;
  runtime?: string;
  cpu_usage?: number;
  memory_usage?: number;
  disk_usage?: number;
  last_seen: string;
  status: "online" | "offline" | "warning";
}

export interface IssueFrequency {
  timestamp: string;
  count: number;
}

export interface IssueFilters {
  status?: string;
  level?: string;
  environment?: string;
  page?: number;
  per_page?: number;
}

export interface CreateMonitorData {
  name: string;
  url: string;
  method?: string;
  interval_seconds?: number;
}

export interface CreateAlertRuleData {
  name: string;
  condition: string;
  channel_ids: string[];
}
