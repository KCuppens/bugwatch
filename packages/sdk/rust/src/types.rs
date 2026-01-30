//! Type definitions for Bugwatch Rust SDK.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Error severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Debug,
    Info,
    Warning,
    Error,
    Fatal,
}

impl Default for Level {
    fn default() -> Self {
        Self::Error
    }
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
    pub filename: String,
    pub function: String,
    pub lineno: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colno: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_context: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_context: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub in_app: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

fn default_true() -> bool {
    true
}

impl StackFrame {
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
    #[serde(rename = "type")]
    pub error_type: String,
    pub value: String,
    #[serde(default)]
    pub stacktrace: Vec<StackFrame>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

impl ExceptionInfo {
    pub fn new(error_type: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            error_type: error_type.into(),
            value: value.into(),
            stacktrace: Vec::new(),
            module: None,
        }
    }

    pub fn with_stacktrace(mut self, stacktrace: Vec<StackFrame>) -> Self {
        self.stacktrace = stacktrace;
        self
    }
}

/// A breadcrumb for tracking user actions and events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breadcrumb {
    pub category: String,
    pub message: String,
    #[serde(default)]
    pub level: Level,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<HashMap<String, serde_json::Value>>,
}

impl Breadcrumb {
    pub fn new(category: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            category: category.into(),
            message: message.into(),
            level: Level::Info,
            timestamp: Utc::now(),
            data: None,
        }
    }

    pub fn with_level(mut self, level: Level) -> Self {
        self.level = level;
        self
    }

    pub fn with_data(mut self, data: HashMap<String, serde_json::Value>) -> Self {
        self.data = Some(data);
        self
    }
}

/// User information for error context.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<HashMap<String, serde_json::Value>>,
}

impl UserContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.email = Some(email.into());
        self
    }

    pub fn with_username(mut self, username: impl Into<String>) -> Self {
        self.username = Some(username.into());
        self
    }
}

/// HTTP request information for error context.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RequestContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Runtime environment information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub name: String,
    pub version: String,
}

/// SDK information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdkInfo {
    pub name: String,
    pub version: String,
}

/// Complete error event to send to Bugwatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub level: Level,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception: Option<ExceptionInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default = "default_platform")]
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk: Option<SdkInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<RuntimeInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<RequestContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<UserContext>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub breadcrumbs: Vec<Breadcrumb>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
}

fn default_platform() -> String {
    "rust".to_string()
}

impl ErrorEvent {
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
    pub api_key: String,
    pub endpoint: String,
    pub environment: Option<String>,
    pub release: Option<String>,
    pub server_name: Option<String>,
    pub debug: bool,
    pub max_breadcrumbs: usize,
    pub sample_rate: f64,
    pub attach_stacktrace: bool,
}

impl BugwatchOptions {
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

    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    pub fn with_environment(mut self, environment: impl Into<String>) -> Self {
        self.environment = Some(environment.into());
        self
    }

    pub fn with_release(mut self, release: impl Into<String>) -> Self {
        self.release = Some(release.into());
        self
    }

    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

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
