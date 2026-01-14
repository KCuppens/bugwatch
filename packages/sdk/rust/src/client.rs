//! Bugwatch client for capturing and sending error events.

use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::backtrace::capture_backtrace_skip;
use crate::fingerprint::fingerprint_from_exception;
use crate::transport::{HttpTransport, Transport};
use crate::types::{
    Breadcrumb, BugwatchOptions, ErrorEvent, ExceptionInfo, Level, UserContext,
};

/// The main Bugwatch client for error tracking.
#[derive(Clone)]
pub struct BugwatchClient {
    options: Arc<BugwatchOptions>,
    transport: Arc<dyn Transport>,
    state: Arc<RwLock<ClientState>>,
}

struct ClientState {
    breadcrumbs: Vec<Breadcrumb>,
    user: Option<UserContext>,
    tags: HashMap<String, String>,
    extra: HashMap<String, serde_json::Value>,
}

impl BugwatchClient {
    /// Create a new Bugwatch client.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use bugwatch::{BugwatchClient, BugwatchOptions};
    ///
    /// let client = BugwatchClient::new(
    ///     BugwatchOptions::new("your-api-key")
    ///         .with_environment("production")
    ///         .with_release("1.0.0")
    /// );
    /// ```
    pub fn new(options: BugwatchOptions) -> Self {
        let transport = Box::new(HttpTransport::new(&options));
        Self::with_transport(options, transport)
    }

    /// Create a new client with a custom transport.
    pub fn with_transport(options: BugwatchOptions, transport: Box<dyn Transport>) -> Self {
        let mut tags = HashMap::new();
        tags.insert("runtime".to_string(), "rust".to_string());
        tags.insert("runtime.version".to_string(), rustc_version());
        tags.insert("os.platform".to_string(), std::env::consts::OS.to_string());
        tags.insert("os.arch".to_string(), std::env::consts::ARCH.to_string());

        if let Some(ref env) = options.environment {
            tags.insert("environment".to_string(), env.clone());
        }

        if options.debug {
            tracing::info!("[Bugwatch] Rust SDK initialized");
        }

        Self {
            options: Arc::new(options),
            transport: Arc::from(transport),
            state: Arc::new(RwLock::new(ClientState {
                breadcrumbs: Vec::new(),
                user: None,
                tags,
                extra: HashMap::new(),
            })),
        }
    }

    /// Check if debug mode is enabled.
    pub fn is_debug(&self) -> bool {
        self.options.debug
    }

    /// Capture an error and send it to Bugwatch.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use bugwatch::{BugwatchClient, BugwatchOptions};
    ///
    /// let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));
    ///
    /// let error = std::io::Error::new(std::io::ErrorKind::NotFound, "File not found");
    /// client.capture_error(&error);
    /// ```
    pub fn capture_error<E: std::error::Error>(&self, error: &E) -> String {
        self.capture_error_with_options(error, Level::Error, None, None)
    }

    /// Capture an error with additional options.
    pub fn capture_error_with_options<E: std::error::Error>(
        &self,
        error: &E,
        level: Level,
        tags: Option<HashMap<String, String>>,
        extra: Option<HashMap<String, serde_json::Value>>,
    ) -> String {
        // Apply sample rate
        if !self.should_sample() {
            return String::new();
        }

        // Build stack trace
        let stacktrace = if self.options.attach_stacktrace {
            capture_backtrace_skip(3)
        } else {
            Vec::new()
        };

        // Create exception info
        let exception = ExceptionInfo {
            error_type: std::any::type_name_of_val(error)
                .split("::")
                .last()
                .unwrap_or("Error")
                .to_string(),
            value: error.to_string(),
            stacktrace,
            module: None,
        };

        self.capture_exception_internal(exception, level, tags, extra)
    }

    /// Capture an exception internally.
    pub(crate) fn capture_exception_internal(
        &self,
        exception: ExceptionInfo,
        level: Level,
        tags: Option<HashMap<String, String>>,
        extra: Option<HashMap<String, serde_json::Value>>,
    ) -> String {
        // Create event
        let event_id = Uuid::new_v4().to_string().replace("-", "");
        let mut event = ErrorEvent::new(&event_id, level);

        // Generate fingerprint
        event.fingerprint = Some(fingerprint_from_exception(&exception));
        event.exception = Some(exception);

        // Add state
        {
            let state = self.state.read();

            // Merge tags
            event.tags = state.tags.clone();
            if let Some(t) = tags {
                event.tags.extend(t);
            }

            // Merge extra
            event.extra = state.extra.clone();
            if let Some(e) = extra {
                event.extra.extend(e);
            }

            // Add breadcrumbs
            event.breadcrumbs = state.breadcrumbs.clone();

            // Add user
            event.user = state.user.clone();
        }

        // Add options
        event.environment = self.options.environment.clone();
        event.release = self.options.release.clone();
        event.server_name = self.options.server_name.clone().or_else(|| {
            hostname::get().ok().map(|h| h.to_string_lossy().to_string())
        });

        // Send event
        if let Err(e) = self.transport.send(&event) {
            if self.options.debug {
                tracing::error!("Failed to send event: {}", e);
            }
        }

        event_id
    }

    /// Capture a message and send it to Bugwatch.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use bugwatch::{BugwatchClient, BugwatchOptions, Level};
    ///
    /// let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));
    /// client.capture_message("Something happened", Level::Warning);
    /// ```
    pub fn capture_message(&self, message: &str, level: Level) -> String {
        self.capture_message_with_options(message, level, None, None)
    }

    /// Capture a message with additional options.
    pub fn capture_message_with_options(
        &self,
        message: &str,
        level: Level,
        tags: Option<HashMap<String, String>>,
        extra: Option<HashMap<String, serde_json::Value>>,
    ) -> String {
        // Apply sample rate
        if !self.should_sample() {
            return String::new();
        }

        // Create event
        let event_id = Uuid::new_v4().to_string().replace("-", "");
        let mut event = ErrorEvent::new(&event_id, level);
        event.message = Some(message.to_string());

        // Add state
        {
            let state = self.state.read();

            // Merge tags
            event.tags = state.tags.clone();
            if let Some(t) = tags {
                event.tags.extend(t);
            }

            // Merge extra
            event.extra = state.extra.clone();
            if let Some(e) = extra {
                event.extra.extend(e);
            }

            // Add breadcrumbs
            event.breadcrumbs = state.breadcrumbs.clone();

            // Add user
            event.user = state.user.clone();
        }

        // Add options
        event.environment = self.options.environment.clone();
        event.release = self.options.release.clone();
        event.server_name = self.options.server_name.clone();

        // Send event
        if let Err(e) = self.transport.send(&event) {
            if self.options.debug {
                tracing::error!("Failed to send event: {}", e);
            }
        }

        event_id
    }

    /// Add a breadcrumb to the trail.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use bugwatch::{BugwatchClient, BugwatchOptions, Breadcrumb, Level};
    ///
    /// let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));
    /// client.add_breadcrumb(Breadcrumb::new("http", "GET /api/users").with_level(Level::Info));
    /// ```
    pub fn add_breadcrumb(&self, breadcrumb: Breadcrumb) {
        let mut state = self.state.write();
        state.breadcrumbs.push(breadcrumb);

        // Limit breadcrumbs
        let max = self.options.max_breadcrumbs;
        if state.breadcrumbs.len() > max {
            let drain_count = state.breadcrumbs.len() - max;
            state.breadcrumbs.drain(..drain_count);
        }
    }

    /// Set the current user context.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use bugwatch::{BugwatchClient, BugwatchOptions, UserContext};
    ///
    /// let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));
    /// client.set_user(Some(
    ///     UserContext::new()
    ///         .with_id("user-123")
    ///         .with_email("user@example.com")
    /// ));
    /// ```
    pub fn set_user(&self, user: Option<UserContext>) {
        let mut state = self.state.write();
        state.user = user;
    }

    /// Set a tag for all future events.
    pub fn set_tag(&self, key: impl Into<String>, value: impl Into<String>) {
        let mut state = self.state.write();
        state.tags.insert(key.into(), value.into());
    }

    /// Set extra context for all future events.
    pub fn set_extra(&self, key: impl Into<String>, value: impl Into<serde_json::Value>) {
        let mut state = self.state.write();
        state.extra.insert(key.into(), value.into());
    }

    /// Clear all breadcrumbs.
    pub fn clear_breadcrumbs(&self) {
        let mut state = self.state.write();
        state.breadcrumbs.clear();
    }

    /// Check if this event should be sampled.
    fn should_sample(&self) -> bool {
        if self.options.sample_rate >= 1.0 {
            return true;
        }
        if self.options.sample_rate <= 0.0 {
            return false;
        }
        rand::random::<f64>() <= self.options.sample_rate
    }

    /// Capture an error asynchronously.
    #[cfg(feature = "async")]
    pub async fn capture_error_async<E: std::error::Error>(&self, error: &E) -> String {
        self.capture_error_with_options_async(error, Level::Error, None, None)
            .await
    }

    /// Capture an error asynchronously with additional options.
    #[cfg(feature = "async")]
    pub async fn capture_error_with_options_async<E: std::error::Error>(
        &self,
        error: &E,
        level: Level,
        tags: Option<HashMap<String, String>>,
        extra: Option<HashMap<String, serde_json::Value>>,
    ) -> String {
        // For now, we delegate to the sync version
        // In a future version, we could use an async transport
        self.capture_error_with_options(error, level, tags, extra)
    }

    /// Capture a message asynchronously.
    #[cfg(feature = "async")]
    pub async fn capture_message_async(&self, message: &str, level: Level) -> String {
        self.capture_message_with_options_async(message, level, None, None)
            .await
    }

    /// Capture a message asynchronously with additional options.
    #[cfg(feature = "async")]
    pub async fn capture_message_with_options_async(
        &self,
        message: &str,
        level: Level,
        tags: Option<HashMap<String, String>>,
        extra: Option<HashMap<String, serde_json::Value>>,
    ) -> String {
        // For now, we delegate to the sync version
        self.capture_message_with_options(message, level, tags, extra)
    }
}

fn rustc_version() -> String {
    option_env!("RUSTC_VERSION")
        .unwrap_or("unknown")
        .to_string()
}

// Add rand dependency for sampling
mod rand {
    pub fn random<T>() -> T
    where
        T: RandomValue,
    {
        T::random()
    }

    pub trait RandomValue {
        fn random() -> Self;
    }

    impl RandomValue for f64 {
        fn random() -> Self {
            // Simple PRNG using system time as seed
            use std::time::{SystemTime, UNIX_EPOCH};
            let seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            // Simple xorshift
            let mut x = seed as u64;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x as f64) / (u64::MAX as f64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::NoopTransport;

    #[test]
    fn test_capture_error() {
        let options = BugwatchOptions::new("test-key");
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        let error = std::io::Error::new(std::io::ErrorKind::NotFound, "File not found");
        let event_id = client.capture_error(&error);

        assert!(!event_id.is_empty());
        assert_eq!(event_id.len(), 32);
    }

    #[test]
    fn test_capture_message() {
        let options = BugwatchOptions::new("test-key");
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        let event_id = client.capture_message("Test message", Level::Info);

        assert!(!event_id.is_empty());
        assert_eq!(event_id.len(), 32);
    }

    #[test]
    fn test_breadcrumbs() {
        let options = BugwatchOptions::new("test-key").with_debug(false);
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        client.add_breadcrumb(Breadcrumb::new("http", "GET /api"));
        client.add_breadcrumb(Breadcrumb::new("ui", "Button clicked"));

        let state = client.state.read();
        assert_eq!(state.breadcrumbs.len(), 2);
    }

    #[test]
    fn test_max_breadcrumbs() {
        let mut options = BugwatchOptions::new("test-key");
        options.max_breadcrumbs = 5;
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        for i in 0..10 {
            client.add_breadcrumb(Breadcrumb::new("test", format!("breadcrumb {}", i)));
        }

        let state = client.state.read();
        assert_eq!(state.breadcrumbs.len(), 5);
        assert_eq!(state.breadcrumbs[0].message, "breadcrumb 5");
    }

    #[test]
    fn test_user_context() {
        let options = BugwatchOptions::new("test-key");
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        client.set_user(Some(
            UserContext::new()
                .with_id("user-123")
                .with_email("test@example.com"),
        ));

        let state = client.state.read();
        assert!(state.user.is_some());
        assert_eq!(state.user.as_ref().unwrap().id, Some("user-123".to_string()));
    }

    #[test]
    fn test_tags() {
        let options = BugwatchOptions::new("test-key");
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        client.set_tag("version", "1.0.0");

        let state = client.state.read();
        assert_eq!(state.tags.get("version"), Some(&"1.0.0".to_string()));
    }

    #[test]
    fn test_sample_rate_zero() {
        let options = BugwatchOptions::new("test-key").with_sample_rate(0.0);
        let client = BugwatchClient::with_transport(options, Box::new(NoopTransport));

        let event_id = client.capture_message("Test", Level::Info);
        assert!(event_id.is_empty());
    }
}
