//! Panic hook for automatic panic capture.

use std::panic::{self, PanicHookInfo};
use std::sync::Arc;

use crate::backtrace::capture_backtrace_skip;
use crate::client::BugwatchClient;
use crate::types::{ExceptionInfo, Level};

/// Install a panic hook that captures panics to Bugwatch.
///
/// This replaces the default panic hook. The original hook behavior
/// (printing to stderr) is preserved after capturing.
///
/// # Example
///
/// ```no_run
/// use bugwatch::{BugwatchClient, BugwatchOptions, install_panic_hook};
/// use std::sync::Arc;
///
/// let client = Arc::new(BugwatchClient::new(BugwatchOptions::new("your-api-key")));
/// install_panic_hook(client);
///
/// // Now panics will be captured to Bugwatch
/// panic!("This will be captured!");
/// ```
pub fn install_panic_hook(client: Arc<BugwatchClient>) {
    let previous_hook = panic::take_hook();
    let debug = client.is_debug();
    let client_clone = client.clone();

    panic::set_hook(Box::new(move |panic_info| {
        // Capture the panic to Bugwatch
        capture_panic(&client_clone, panic_info);

        // Call the previous hook (usually prints to stderr)
        previous_hook(panic_info);
    }));

    if debug {
        tracing::info!("[Bugwatch] Panic hook installed");
    }
}

/// Install a panic hook that captures panics and then aborts the process.
///
/// This is useful for applications that need to ensure panics are always
/// captured before the process exits.
pub fn install_panic_hook_with_abort(client: Arc<BugwatchClient>) {
    let client_clone = client.clone();

    panic::set_hook(Box::new(move |panic_info| {
        // Capture the panic to Bugwatch
        capture_panic(&client_clone, panic_info);

        // Print panic info
        eprintln!("{}", panic_info);

        // Abort the process
        std::process::abort();
    }));
}

/// Capture a panic to Bugwatch.
fn capture_panic(client: &BugwatchClient, panic_info: &PanicHookInfo<'_>) {
    // Extract panic message
    let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "Unknown panic".to_string()
    };

    // Extract location
    let location = panic_info.location().map(|loc| {
        format!("{}:{}:{}", loc.file(), loc.line(), loc.column())
    });

    // Capture backtrace (skip panic handling frames)
    let stacktrace = capture_backtrace_skip(5);

    // Create exception info
    let exception = ExceptionInfo {
        error_type: "panic".to_string(),
        value: message,
        stacktrace,
        module: None,
    };

    // Build tags
    let mut tags = std::collections::HashMap::new();
    tags.insert("mechanism".to_string(), "panic_hook".to_string());
    if let Some(loc) = location {
        tags.insert("panic.location".to_string(), loc);
    }

    // Capture to Bugwatch
    // Note: We use blocking send here since we're in a panic handler
    let _ = client.capture_exception_internal(exception, Level::Fatal, Some(tags), None);
}

/// A guard that captures panics when dropped.
///
/// Useful for capturing panics in async contexts or when you want
/// scoped panic handling.
///
/// # Example
///
/// ```no_run
/// use bugwatch::{BugwatchClient, BugwatchOptions, PanicGuard};
/// use std::sync::Arc;
///
/// let client = Arc::new(BugwatchClient::new(BugwatchOptions::new("your-api-key")));
///
/// {
///     let _guard = PanicGuard::new(client.clone());
///     // If a panic occurs here, it will be captured when the guard is dropped
///     // risky_operation();
/// }
/// ```
pub struct PanicGuard {
    client: Arc<BugwatchClient>,
    panicking: bool,
}

impl PanicGuard {
    /// Create a new panic guard.
    pub fn new(client: Arc<BugwatchClient>) -> Self {
        Self {
            client,
            panicking: false,
        }
    }

    /// Mark that we're about to enter a potentially panicking section.
    pub fn enter(&mut self) {
        self.panicking = std::thread::panicking();
    }
}

impl Drop for PanicGuard {
    fn drop(&mut self) {
        // Check if a panic started during this guard's lifetime
        if std::thread::panicking() && !self.panicking {
            // We're panicking, try to capture
            // Note: We can't get panic info here, so we just log a generic message
            let exception = ExceptionInfo::new("panic", "Panic detected in guarded section");
            let mut tags = std::collections::HashMap::new();
            tags.insert("mechanism".to_string(), "panic_guard".to_string());

            let _ = self.client.capture_exception_internal(
                exception,
                Level::Fatal,
                Some(tags),
                None,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::NoopTransport;
    use crate::types::BugwatchOptions;

    #[test]
    fn test_panic_guard_no_panic() {
        let options = BugwatchOptions::new("test-key");
        let client = Arc::new(BugwatchClient::with_transport(
            options,
            Box::new(NoopTransport),
        ));

        {
            let _guard = PanicGuard::new(client.clone());
            // No panic, guard should drop cleanly
        }
    }
}
