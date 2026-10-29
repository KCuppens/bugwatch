//! Type definitions for Bugwatch Rust SDK.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Error severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// Debug-level diagnostic information.
    Debug,
    /// Informational message.
    Info,
    /// Warning that does not prevent operation.
    Warning,
    /// Error condition (the default level).
    #[default]
    Error,
    /// Fatal, unrecoverable error.
    Fatal,
}

impl std::fmt::Display for Level {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Debug => write!(f, "debug"),
            Self::Info => write!(f, "info"),
            Self::Warning => write!(f, "warning"),
            Self::Error => write!(f, "error"),
            Self::Fatal => write!(f, "fatal"),
        }
    }
}

/// A single frame in a stack trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFrame {
    /// Source file the frame originates from.
    pub filename: String,
    /// Name of the function or method.
    pub function: String,
    /// 1-based line number within the file.
    pub lineno: u32,
    /// 1-based column number, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colno: Option<u32>,
    /// Source text of the line where the frame points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_line: Option<String>,
    /// Source lines immediately preceding `context_line`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_context: Option<Vec<String>>,
    /// Source lines immediately following `context_line`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_context: Option<Vec<String>>,
    /// Whether the frame belongs to application code (vs. a dependency).
    #[serde(default = "default_true")]
    pub in_app: bool,
    /// Module path the frame belongs to, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

fn default_true() -> bool {
    true
}

impl StackFrame {
    /// Create a stack frame for `function` at `filename:lineno`.
    pub fn new(filename: impl Into<String>, function: impl Into<String>, lineno: u32) -> Self {
        Self {
            filename: filename.into(),
            function: function.into(),
            lineno,
            colno: None,
            context_line: None,
            pre_context: None,
            post_context: None,
            in_app: true,
            module: None,
        }
    }
}

/// Information about an exception.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExceptionInfo {
    /// The exception's type name.
    #[serde(rename = "type")]
    pub error_type: String,
    /// Human-readable description of the exception.
    pub value: String,
    /// Stack frames associated with the exception, innermost last.
    #[serde(default)]
    pub stacktrace: Vec<StackFrame>,
    /// Module the exception was raised in, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

impl ExceptionInfo {
    /// Create exception info from a type name and message value.
    pub fn new(error_type: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            error_type: error_type.into(),
            value: value.into(),
            stacktrace: Vec::new(),
            module: None,
        }
    }

    /// Attach a stack trace, returning the updated value.
    pub fn with_stacktrace(mut self, stacktrace: Vec<StackFrame>) -> Self {
        self.stacktrace = stacktrace;
        self
    }
}

/// A breadcrumb for tracking user actions and events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breadcrumb {
    /// Category the breadcrumb belongs to (e.g. `"http"`, `"navigation"`).
    pub category: String,
    /// Human-readable description of the event.
    pub message: String,
    /// Severity level of the breadcrumb.
    #[serde(default)]
    pub level: Level,
    /// When the breadcrumb occurred.
    pub timestamp: DateTime<Utc>,
    /// Arbitrary structured data attached to the breadcrumb.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<HashMap<String, serde_json::Value>>,
}

impl Breadcrumb {
    /// Create a breadcrumb in `category` with `message`, stamped with the current time.
    pub fn new(category: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            category: category.into(),
            message: message.into(),
            level: Level::Info,
            timestamp: Utc::now(),
            data: None,
        }
    }

    /// Set the breadcrumb's severity level, returning the updated value.
    pub fn with_level(mut self, level: Level) -> Self {
        self.level = level;
        self
    }

    /// Attach structured data, returning the updated value.
    pub fn with_data(mut self, data: HashMap<String, serde_json::Value>) -> Self {
        self.data = Some(data);
        self
    }
}

/// User information for error context.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserContext {
    /// Unique identifier for the user.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// User's email address.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// User's display name or login.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// IP address the user connected from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    /// Arbitrary additional user attributes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<HashMap<String, serde_json::Value>>,
}

impl UserContext {
    /// Create an empty user context.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the user id, returning the updated value.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Set the user email, returning the updated value.
    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.email = Some(email.into());
        self
    }

    /// Set the username, returning the updated value.
    pub fn with_username(mut self, username: impl Into<String>) -> Self {
        self.username = Some(username.into());
        self
    }
}

/// HTTP request information for error context.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RequestContext {
    /// Full request URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// HTTP method (e.g. `"GET"`, `"POST"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// Request headers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    /// Raw query string portion of the URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_string: Option<String>,
    /// Parsed request body or payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// IP address the request originated from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_ip: Option<String>,
}

/// Runtime environment information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    /// Runtime name (e.g. `"rust"`).
    pub name: String,
    /// Runtime version string.
    pub version: String,
}

/// SDK information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdkInfo {
    /// SDK package name.
    pub name: String,
    /// SDK version string.
    pub version: String,
}

/// Complete error event to send to Bugwatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    /// Unique identifier for this event.
    pub event_id: String,
    /// When the event occurred.
    pub timestamp: DateTime<Utc>,
    /// Severity level of the event.
    pub level: Level,
    /// Exception details, when the event represents an error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception: Option<ExceptionInfo>,
    /// Free-form message, when the event represents a log message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Platform identifier (defaults to `"rust"`).
    #[serde(default = "default_platform")]
    pub platform: String,
    /// Information about the SDK that produced the event.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk: Option<SdkInfo>,
    /// Information about the runtime environment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<RuntimeInfo>,
    /// HTTP request context, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<RequestContext>,
    /// User context, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<UserContext>,
    /// Indexable key/value tags.
    #[serde(default)]
    pub tags: HashMap<String, String>,
    /// Arbitrary non-indexed extra data.
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
    /// Breadcrumb trail leading up to the event.
    #[serde(default)]
    pub breadcrumbs: Vec<Breadcrumb>,
    /// Grouping fingerprint override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    /// Deployment environment (e.g. `"production"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    /// Release/version the event was captured on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    /// Name of the host/server that produced the event.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
}

fn default_platform() -> String {
    "rust".to_string()
}

impl ErrorEvent {
    /// Create a new event with the given id and level, populated with SDK and
    /// runtime metadata and the current timestamp.
    pub fn new(event_id: impl Into<String>, level: Level) -> Self {
        Self {
            event_id: event_id.into(),
            timestamp: Utc::now(),
            level,
            exception: None,
            message: None,
            platform: "rust".to_string(),
            sdk: Some(SdkInfo {
                name: "bugwatch-rust".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            }),
            runtime: Some(RuntimeInfo {
                name: "rust".to_string(),
                version: rustc_version(),
            }),
            request: None,
            user: None,
            tags: HashMap::new(),
            extra: HashMap::new(),
            breadcrumbs: Vec::new(),
            fingerprint: None,
            environment: None,
            release: None,
            server_name: None,
        }
    }
}

fn rustc_version() -> String {
    // Get rustc version at runtime
    option_env!("RUSTC_VERSION")
        .unwrap_or("unknown")
        .to_string()
}

/// Configuration options for the Bugwatch client.
#[derive(Debug, Clone)]
pub struct BugwatchOptions {
    /// API key used to authenticate with the Bugwatch ingest endpoint.
    pub api_key: String,
    /// Base URL of the Bugwatch API.
    pub endpoint: String,
    /// Deployment environment tag (e.g. `"production"`).
    pub environment: Option<String>,
    /// Release/version identifier attached to events.
    pub release: Option<String>,
    /// Server/host name attached to events.
    pub server_name: Option<String>,
    /// When `true`, the SDK logs its own diagnostics.
    pub debug: bool,
    /// Maximum number of breadcrumbs retained per event.
    pub max_breadcrumbs: usize,
    /// Fraction of events to send, in the range `0.0..=1.0`.
    pub sample_rate: f64,
    /// Whether to attach a stack trace to captured events.
    pub attach_stacktrace: bool,
}

impl BugwatchOptions {
    /// Create options with the given API key and sensible defaults.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            endpoint: "https://api.bugwatch.dev".to_string(),
            environment: None,
            release: None,
            server_name: None,
            debug: false,
            max_breadcrumbs: 100,
            sample_rate: 1.0,
            attach_stacktrace: true,
        }
    }

    /// Override the API endpoint, returning the updated options.
    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    /// Set the deployment environment, returning the updated options.
    pub fn with_environment(mut self, environment: impl Into<String>) -> Self {
        self.environment = Some(environment.into());
        self
    }

    /// Set the release identifier, returning the updated options.
    pub fn with_release(mut self, release: impl Into<String>) -> Self {
        self.release = Some(release.into());
        self
    }

    /// Toggle SDK debug logging, returning the updated options.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Set the sampling rate (clamped to `0.0..=1.0`), returning the updated options.
    pub fn with_sample_rate(mut self, sample_rate: f64) -> Self {
        self.sample_rate = sample_rate.clamp(0.0, 1.0);
        self
    }
}

impl Default for BugwatchOptions {
    fn default() -> Self {
        Self::new("")
    }
}
