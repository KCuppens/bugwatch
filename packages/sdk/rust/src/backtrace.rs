//! Backtrace parsing utilities.

use backtrace::Backtrace;

use crate::types::StackFrame;

/// Parse a backtrace into a list of stack frames.
pub fn parse_backtrace(bt: &Backtrace) -> Vec<StackFrame> {
    let mut frames = Vec::new();

    for frame in bt.frames() {
        for symbol in frame.symbols() {
            let filename = symbol
                .filename()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "<unknown>".to_string());

            let function = symbol
                .name()
                .map(|n| n.to_string())
                .unwrap_or_else(|| "<unknown>".to_string());

            let lineno = symbol.lineno().unwrap_or(0);
            let colno = symbol.colno();

            // Determine if this is app code
            let in_app = is_in_app(&filename, &function);

            let module = extract_module(&function);
            frames.push(StackFrame {
                filename,
                function,
                lineno,
                colno,
                context_line: None,
                pre_context: None,
                post_context: None,
                in_app,
                module,
            });
        }
    }

    frames
}

/// Capture the current backtrace and parse it.
pub fn capture_backtrace() -> Vec<StackFrame> {
    let bt = Backtrace::new();
    parse_backtrace(&bt)
}

/// Capture a backtrace, skipping the first N frames.
pub fn capture_backtrace_skip(skip: usize) -> Vec<StackFrame> {
    let bt = Backtrace::new();
    let mut frames = parse_backtrace(&bt);

    // Skip internal bugwatch frames
    if frames.len() > skip {
        frames = frames.into_iter().skip(skip).collect();
    }

    frames
}

/// Determine if a frame is from application code.
fn is_in_app(filename: &str, function: &str) -> bool {
    // Skip standard library
    if filename.contains("/rustc/") {
        return false;
    }

    // Skip cargo registry (external crates)
    if filename.contains(".cargo/registry/") || filename.contains(".cargo\\registry\\") {
        return false;
    }

    // Skip bugwatch SDK itself
    if function.starts_with("bugwatch::") {
        return false;
    }

    // Skip common runtime functions
    let skip_prefixes = [
        "std::",
        "core::",
        "alloc::",
        "backtrace::",
        "panic_unwind::",
        "tokio::",
        "<alloc::",
        "<core::",
        "<std::",
    ];

    for prefix in &skip_prefixes {
        if function.starts_with(prefix) {
            return false;
        }
    }

    true
}

/// Extract module name from function name.
fn extract_module(function: &str) -> Option<String> {
    // Function names are typically module::submodule::function
    if let Some(last_sep) = function.rfind("::") {
        let module = &function[..last_sep];
        if !module.is_empty() {
            return Some(module.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_in_app_filters_std() {
        assert!(!is_in_app("/some/path", "std::thread::spawn"));
        assert!(!is_in_app("/some/path", "core::result::Result"));
    }

    #[test]
    fn test_is_in_app_allows_app_code() {
        assert!(is_in_app("/my/project/src/main.rs", "myapp::main"));
        assert!(is_in_app("src/lib.rs", "mycrate::handler"));
    }

    #[test]
    fn test_extract_module() {
        assert_eq!(
            extract_module("myapp::handlers::user::create"),
            Some("myapp::handlers::user".to_string())
        );
        assert_eq!(extract_module("main"), None);
    }

    #[test]
    fn test_capture_backtrace() {
        let frames = capture_backtrace();
        // Should have at least one frame
        assert!(!frames.is_empty());
    }
}
