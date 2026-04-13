//! # Bugwatch Rust SDK
//!
//! Official Rust SDK for [Bugwatch](https://bugwatch.dev) - AI-Powered Error Tracking.
//!
//! ## Quick Start
//!
//! ```no_run
//! use bugwatch::{BugwatchClient, BugwatchOptions, Level};
//! use std::sync::Arc;
//!
//! // Create a client
//! let client = Arc::new(BugwatchClient::new(
//!     BugwatchOptions::new("your-api-key")
//!         .with_environment("production")
//!         .with_release("1.0.0")
//! ));
//!
//! // Capture an error
//! if let Err(e) = some_operation() {
//!     client.capture_error(&e);
//! }
//!
//! // Capture a message
//! client.capture_message("Something happened", Level::Warning);
//! # fn some_operation() -> Result<(), std::io::Error> { Ok(()) }
//! ```
//!
//! ## Panic Hook
//!
//! Install a panic hook to automatically capture panics:
//!
//! ```no_run
//! use bugwatch::{BugwatchClient, BugwatchOptions, install_panic_hook};
//! use std::sync::Arc;
//!
//! let client = Arc::new(BugwatchClient::new(BugwatchOptions::new("your-api-key")));
//! install_panic_hook(client);
//!
//! // Now panics will be captured to Bugwatch
//! ```
//!
//! ## Features
//!
//! - `async` - Enable async support with tokio (enabled by default)
//! - `blocking` - Enable blocking/sync support (enabled by default)
//! - `full` - Enable all features
//!
//! ## Breadcrumbs
//!
//! Track user actions leading up to an error:
//!
//! ```no_run
//! use bugwatch::{BugwatchClient, BugwatchOptions, Breadcrumb, Level};
//!
//! let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));
//!
//! client.add_breadcrumb(
//!     Breadcrumb::new("http", "GET /api/users")
//!         .with_level(Level::Info)
//! );
//! ```
//!
//! ## User Context
//!
//! Associate errors with users:
//!
//! ```no_run
//! use bugwatch::{BugwatchClient, BugwatchOptions, UserContext};
//!
//! let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));
//!
//! client.set_user(Some(
//!     UserContext::new()
//!         .with_id("user-123")
//!         .with_email("user@example.com")
//! ));
//! ```

#![warn(missing_docs)]
#![warn(rust_2018_idioms)]

pub mod backtrace;
pub mod client;
pub mod env;
pub mod fingerprint;
pub mod panic_hook;
pub mod transport;
pub mod types;

#[cfg(any(feature = "actix", feature = "axum"))]
pub mod integrations;

// Re-export main types
pub use client::BugwatchClient;
pub use env::{get_env_options, EnvError};
pub use fingerprint::{fingerprint_from_exception, generate_fingerprint};
pub use panic_hook::{install_panic_hook, install_panic_hook_with_abort, PanicGuard};
pub use transport::{ConsoleTransport, HttpTransport, NoopTransport, Transport, TransportError};
pub use types::{
    Breadcrumb, BugwatchOptions, ErrorEvent, ExceptionInfo, Level, RequestContext, RuntimeInfo,
    SdkInfo, StackFrame, UserContext,
};

// Global client for convenience (optional)
use lazy_static::lazy_static;
use parking_lot::RwLock;
use std::sync::Arc;

lazy_static! {
    static ref GLOBAL_CLIENT: RwLock<Option<Arc<BugwatchClient>>> = RwLock::new(None);
}

/// Initialize the global Bugwatch client.
///
/// # Example
///
/// ```no_run
/// use bugwatch::{init, capture_message, Level};
///
/// init(bugwatch::BugwatchOptions::new("your-api-key"));
///
/// capture_message("Hello from Bugwatch!", Level::Info);
/// ```
pub fn init(options: BugwatchOptions) -> Arc<BugwatchClient> {
    // Take write lock first to prevent TOCTOU race where two threads both
    // create clients simultaneously
    let mut guard = GLOBAL_CLIENT.write();
    if let Some(ref existing) = *guard {
        return existing.clone();
    }
    let client = Arc::new(BugwatchClient::new(options));
    *guard = Some(client.clone());
    client
}

/// Initialize the global Bugwatch client from environment variables.
///
/// Reads configuration from the following environment variables:
/// - `BUGWATCH_API_KEY` - API key (required)
/// - `BUGWATCH_ENVIRONMENT` - Environment tag
/// - `BUGWATCH_RELEASE` - Release version
/// - `BUGWATCH_DEBUG` - Enable debug mode ("true")
/// - `BUGWATCH_ENDPOINT` - Custom API endpoint
///
/// # Errors
///
/// Returns `EnvError::MissingApiKey` if `BUGWATCH_API_KEY` is not set.
///
/// # Example
///
/// ```no_run
/// use bugwatch::{init_from_env, capture_message, Level};
///
/// // Requires BUGWATCH_API_KEY environment variable to be set
/// init_from_env().expect("BUGWATCH_API_KEY not set");
///
/// capture_message("Hello from Bugwatch!", Level::Info);
/// ```
pub fn init_from_env() -> Result<Arc<BugwatchClient>, EnvError> {
    let options = get_env_options()?;
    Ok(init(options))
}

/// Get the global Bugwatch client.
pub fn get_client() -> Option<Arc<BugwatchClient>> {
    GLOBAL_CLIENT.read().clone()
}

/// Capture an error using the global client.
pub fn capture_error<E: std::error::Error>(error: &E) -> String {
    if let Some(client) = get_client() {
        client.capture_error(error)
    } else {
        tracing::warn!("[Bugwatch] SDK not initialized. Call init() first.");
        String::new()
    }
}

/// Capture a message using the global client.
pub fn capture_message(message: &str, level: Level) -> String {
    if let Some(client) = get_client() {
        client.capture_message(message, level)
    } else {
        tracing::warn!("[Bugwatch] SDK not initialized. Call init() first.");
        String::new()
    }
}

/// Add a breadcrumb using the global client.
pub fn add_breadcrumb(breadcrumb: Breadcrumb) {
    if let Some(client) = get_client() {
        client.add_breadcrumb(breadcrumb);
    }
}

/// Set user context on the global client.
pub fn set_user(user: Option<UserContext>) {
    if let Some(client) = get_client() {
        client.set_user(user);
    }
}

/// Set a tag on the global client.
pub fn set_tag(key: impl Into<String>, value: impl Into<String>) {
    if let Some(client) = get_client() {
        client.set_tag(key, value);
    }
}

/// Set extra context on the global client.
pub fn set_extra(key: impl Into<String>, value: impl Into<serde_json::Value>) {
    if let Some(client) = get_client() {
        client.set_extra(key, value);
    }
}

/// Flush any pending events using the global client.
///
/// This ensures all queued events are sent before the method returns.
/// Call this before process exit to ensure no events are lost.
///
/// # Errors
///
/// Returns an error if the transport fails to flush, or if the SDK is not initialized.
pub fn flush() -> Result<(), TransportError> {
    if let Some(client) = get_client() {
        client.flush()
    } else {
        tracing::warn!("[Bugwatch] SDK not initialized. Call init() first.");
        Ok(())
    }
}

/// Close the global client and release any resources.
///
/// This flushes any pending events and closes the transport.
/// After calling this method, the client should not be used again.
///
/// # Errors
///
/// Returns an error if the transport fails to close.
pub fn close() -> Result<(), TransportError> {
    if let Some(client) = get_client() {
        let result = client.close();
        *GLOBAL_CLIENT.write() = None;
        result
    } else {
        tracing::warn!("[Bugwatch] SDK not initialized. Call init() first.");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests share GLOBAL_CLIENT and must run sequentially.
    // Combining them prevents parallel test interference.
    #[test]
    fn test_global_client_lifecycle() {
        // Phase 1: capture without init returns empty
        *GLOBAL_CLIENT.write() = None;
        let result = capture_message("test", Level::Info);
        assert!(result.is_empty());

        // Phase 2: init creates a client, get_client returns it
        init(BugwatchOptions::new("test-key"));
        assert!(get_client().is_some());

        // Cleanup for other tests
        *GLOBAL_CLIENT.write() = None;
    }
}
