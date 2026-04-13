use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::api::events::{ExceptionInfo, StackFrame};

static RE_SINGLE_QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"'[^']*'").unwrap());
static RE_DOUBLE_QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""[^"]*""#).unwrap());
static RE_UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap()
});
static RE_IP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}").unwrap());
static RE_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b\d+\b").unwrap());
static RE_REACT_MINIFIED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Minified React error #(\d+)").unwrap());
static RE_REACT_ARGS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"args\[\d+\]=([^&\s]*)").unwrap());

/// React production error codes mapped to human-readable messages.
/// See: https://react.dev/errors
static REACT_ERROR_MESSAGES: LazyLock<HashMap<u32, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(
        418,
        "Hydration failed: Server-rendered HTML didn't match client content (text mismatch)",
    );
    m.insert(
        419,
        "Hydration failed: Server-rendered HTML didn't match client content (tag mismatch)",
    );
    m.insert(
        421,
        "Hydration failed: Server HTML contained more content than client expected",
    );
    m.insert(
        422,
        "Hydration failed: Client rendered more content than server HTML",
    );
    m.insert(
        423,
        "Hydration failed: Suspense boundary mismatch between server and client",
    );
    m.insert(
        425,
        "Hydration failed: Text content doesn't match server-rendered HTML",
    );
    m.insert(
        185,
        "Maximum update depth exceeded (likely infinite loop in useEffect or setState)",
    );
    m.insert(
        152,
        "Nothing was returned from render (missing return in component)",
    );
    m.insert(
        130,
        "Element type is invalid (check component export/import)",
    );
    m.insert(31, "Objects are not valid as a React child");
    m.insert(
        321,
        "Cannot update a component from inside the function body of a different component",
    );
    m.insert(
        301,
        "Cannot update during an existing state transition (e.g. within render)",
    );
    m.insert(423, "There was an error during server rendering (Suspense)");
    m.insert(
        310,
        "Invalid hook call (hooks can only be called inside function components)",
    );
    m.insert(
        300,
        "Invalid hook call (hooks can only be called at the top level)",
    );
    m.insert(362, "Calling Hooks conditionally is not allowed");
    m.insert(294, "Rendered more hooks than during the previous render");
    m.insert(295, "Rendered fewer hooks than expected");
    m
});

/// Unminify React production error codes into human-readable messages.
/// This runs server-side to ensure all stored issue titles are readable,
/// regardless of whether the SDK performed client-side unminification.
pub fn unminify_react_error(message: &str) -> String {
    let caps = match RE_REACT_MINIFIED.captures(message) {
        Some(c) => c,
        None => return message.to_string(),
    };

    let code: u32 = match caps[1].parse() {
        Ok(c) => c,
        Err(_) => return message.to_string(),
    };

    let readable = match REACT_ERROR_MESSAGES.get(&code) {
        Some(msg) => *msg,
        None => return format!("React Error #{}: {}", code, message),
    };

    // Extract args from the URL if present (e.g., args[0]=text&args[1]=)
    let args: Vec<String> = RE_REACT_ARGS
        .captures_iter(message)
        .filter_map(|c| {
            let val = c.get(1)?.as_str();
            if val.is_empty() {
                None
            } else {
                Some(urlencoding::decode(val).unwrap_or_default().into_owned())
            }
        })
        .collect();

    if args.is_empty() {
        format!("React Error #{}: {}", code, readable)
    } else {
        format!("React Error #{}: {} [{}]", code, readable, args.join(", "))
    }
}

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

    // 3. Normalized error message (unminify React errors first)
    let unminified = unminify_react_error(&exception.value);
    let normalized_message = normalize_message(&unminified);
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

/// Generate a title for the issue from exception info.
/// Automatically unminifies React production error codes.
pub fn generate_title(exception: &ExceptionInfo) -> String {
    let value = unminify_react_error(&exception.value);

    let short_message = if value.len() > 100 {
        format!("{}...", &value[..97])
    } else {
        value
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
            stacktrace: vec![StackFrame {
                filename: "src/api/users.ts".to_string(),
                function: "getUser".to_string(),
                lineno: 142,
                colno: 23,
                abs_path: None,
                context_line: None,
                pre_context: None,
                post_context: None,
                in_app: true,
            }],
        };

        let exc2 = ExceptionInfo {
            exception_type: "TypeError".to_string(),
            value: "Cannot read property 'name' of undefined".to_string(),
            stacktrace: vec![StackFrame {
                filename: "src/api/users.ts".to_string(),
                function: "getUser".to_string(),
                lineno: 150, // Different line
                colno: 23,
                abs_path: None,
                context_line: None,
                pre_context: None,
                post_context: None,
                in_app: true,
            }],
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
        assert_eq!(
            generate_fingerprint(&exc_from_submit),
            generate_fingerprint(&exc_from_retry)
        );
    }
}
