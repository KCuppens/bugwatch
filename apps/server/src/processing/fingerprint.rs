use std::sync::LazyLock;
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::api::events::{ExceptionInfo, StackFrame};

static RE_SINGLE_QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"'[^']*'").unwrap());
static RE_DOUBLE_QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""[^"]*""#).unwrap());
static RE_UUID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap());
static RE_IP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}").unwrap());
static RE_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b\d+\b").unwrap());

/// Generate a fingerprint for error grouping.
/// Groups identical errors together even with different data values.
pub fn generate_fingerprint(exception: &ExceptionInfo) -> String {
    let mut components: Vec<String> = Vec::new();

    // 1. Exception type
    components.push(exception.exception_type.clone());

    // 2. Top in-app frame (the throw site)
    // Using only the topmost frame ensures the same error thrown from different
    // call paths (e.g., handleSubmit vs handleRetry) groups into one issue.
    // The combination of type + throw location + normalized message is specific enough.
    let in_app_frames: Vec<&StackFrame> = exception
        .stacktrace
        .iter()
        .filter(|f| f.in_app)
        .take(1)
        .collect();

    for frame in in_app_frames {
        components.push(format!("{}:{}", frame.filename, frame.function));
    }

    // 3. Normalized error message
    let normalized_message = normalize_message(&exception.value);
    components.push(normalized_message);

    // Generate SHA256 hash
    let input = components.join("|");
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();

    // Return first 16 hex characters
    hex::encode(&result[..8])
}

/// Normalize error message by stripping variable data.
///
/// Examples:
/// - "Cannot read property 'id' of undefined" → "Cannot read property '*' of undefined"
/// - "User 12345 not found" → "User * not found"
/// - "Connection to 192.168.1.1:5432 failed" → "Connection to *:* failed"
fn normalize_message(message: &str) -> String {
    let mut result = message.to_string();

    // Replace single-quoted strings
    result = RE_SINGLE_QUOTE.replace_all(&result, "'*'").to_string();

    // Replace double-quoted strings
    result = RE_DOUBLE_QUOTE.replace_all(&result, "\"*\"").to_string();

    // Replace UUIDs
    result = RE_UUID.replace_all(&result, "*").to_string();

    // Replace IP addresses
    result = RE_IP.replace_all(&result, "*").to_string();

    // Replace numbers (but not in function/file names context)
    result = RE_NUMBER.replace_all(&result, "*").to_string();

    result
}

/// Generate a title for the issue from exception info
pub fn generate_title(exception: &ExceptionInfo) -> String {
    let short_message = if exception.value.len() > 100 {
        format!("{}...", &exception.value[..97])
    } else {
        exception.value.clone()
    };

    format!("{}: {}", exception.exception_type, short_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_message() {
        assert_eq!(
            normalize_message("Cannot read property 'id' of undefined"),
            "Cannot read property '*' of undefined"
        );

        assert_eq!(
            normalize_message("User 12345 not found"),
            "User * not found"
        );

        assert_eq!(
            normalize_message("Connection to 192.168.1.1:5432 failed"),
            "Connection to *:* failed"
        );

        assert_eq!(
            normalize_message("Invalid UUID: 550e8400-e29b-41d4-a716-446655440000"),
            "Invalid UUID: *"
        );
    }

    #[test]
    fn test_fingerprint_consistency() {
        let exc1 = ExceptionInfo {
            exception_type: "TypeError".to_string(),
            value: "Cannot read property 'id' of undefined".to_string(),
            stacktrace: vec![
                StackFrame {
                    filename: "src/api/users.ts".to_string(),
                    function: "getUser".to_string(),
                    lineno: 142,
                    colno: 23,
                    abs_path: None,
                    context_line: None,
                    pre_context: None,
                    post_context: None,
                    in_app: true,
                },
            ],
        };

        let exc2 = ExceptionInfo {
            exception_type: "TypeError".to_string(),
            value: "Cannot read property 'name' of undefined".to_string(),
            stacktrace: vec![
                StackFrame {
                    filename: "src/api/users.ts".to_string(),
                    function: "getUser".to_string(),
                    lineno: 150, // Different line
                    colno: 23,
                    abs_path: None,
                    context_line: None,
                    pre_context: None,
                    post_context: None,
                    in_app: true,
                },
            ],
        };

        // Same fingerprint because type, file:function, and normalized message match
        assert_eq!(generate_fingerprint(&exc1), generate_fingerprint(&exc2));
    }

    #[test]
    fn test_same_error_different_callers_groups_together() {
        // Same error thrown from fetchJSON, but called from different paths
        let exc_from_submit = ExceptionInfo {
            exception_type: "HttpError".to_string(),
            value: "HTTP 422: POST https://api.example.com/api/v1/projects/550e8400-e29b-41d4-a716-446655440000/alerts".to_string(),
            stacktrace: vec![
                StackFrame {
                    filename: "src/lib/api.ts".to_string(),
                    function: "fetchJSON".to_string(),
                    lineno: 42, colno: 10,
                    abs_path: None, context_line: None, pre_context: None, post_context: None,
                    in_app: true,
                },
                StackFrame {
                    filename: "src/lib/alerts-api.ts".to_string(),
                    function: "createRule".to_string(),
                    lineno: 88, colno: 5,
                    abs_path: None, context_line: None, pre_context: None, post_context: None,
                    in_app: true,
                },
                StackFrame {
                    filename: "src/pages/alerts.tsx".to_string(),
                    function: "handleSubmit".to_string(),
                    lineno: 200, colno: 3,
                    abs_path: None, context_line: None, pre_context: None, post_context: None,
                    in_app: true,
                },
            ],
        };

        let exc_from_retry = ExceptionInfo {
            exception_type: "HttpError".to_string(),
            value: "HTTP 422: POST https://api.example.com/api/v1/projects/a1b2c3d4-e5f6-7890-abcd-ef1234567890/alerts".to_string(),
            stacktrace: vec![
                StackFrame {
                    filename: "src/lib/api.ts".to_string(),
                    function: "fetchJSON".to_string(),
                    lineno: 42, colno: 10,
                    abs_path: None, context_line: None, pre_context: None, post_context: None,
                    in_app: true,
                },
                StackFrame {
                    filename: "src/lib/alerts-api.ts".to_string(),
                    function: "createRule".to_string(),
                    lineno: 88, colno: 5,
                    abs_path: None, context_line: None, pre_context: None, post_context: None,
                    in_app: true,
                },
                StackFrame {
                    filename: "src/pages/alerts.tsx".to_string(),
                    function: "handleRetry".to_string(),  // Different caller!
                    lineno: 250, colno: 3,
                    abs_path: None, context_line: None, pre_context: None, post_context: None,
                    in_app: true,
                },
            ],
        };

        // Should group together: same type, same throw site (fetchJSON), same normalized message
        // Only the higher-up caller differs (handleSubmit vs handleRetry)
        assert_eq!(generate_fingerprint(&exc_from_submit), generate_fingerprint(&exc_from_retry));
    }
}
