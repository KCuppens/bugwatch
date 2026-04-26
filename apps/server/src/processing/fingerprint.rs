use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::api::events::ExceptionInfo;

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
                Some(
                    urlencoding::decode(val)
                        .unwrap_or_else(|_| std::borrow::Cow::Borrowed(val))
                        .into_owned(),
                )
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

    // 2. Top in-app frame (the throw site), falling back to the topmost frame if none
    // are marked in-app. Without a frame component, errors with the same type and
    // normalized message (e.g., generic "fetch failed") would all merge into one issue.
    let frame = exception
        .stacktrace
        .iter()
        .find(|f| f.in_app)
        .or_else(|| exception.stacktrace.first());

    if let Some(frame) = frame {
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

    // Return first 32 hex characters (128-bit) — reduces collision risk at scale
    hex::encode(&result[..16])
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

    let short_message = if value.chars().count() > 100 {
        let cut = value
            .char_indices()
            .nth(97)
            .map(|(i, _)| i)
            .unwrap_or(value.len());
        format!("{}...", &value[..cut])
    } else {
        value
    };

    format!("{}: {}", exception.exception_type, short_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::events::StackFrame;

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

    // ── helpers ──────────────────────────────────────────────────────────────

    fn make_exc(exception_type: &str, value: &str, frames: Vec<StackFrame>) -> ExceptionInfo {
        ExceptionInfo {
            exception_type: exception_type.to_string(),
            value: value.to_string(),
            stacktrace: frames,
        }
    }

    fn make_frame(filename: &str, function: &str, in_app: bool) -> StackFrame {
        StackFrame {
            filename: filename.to_string(),
            function: function.to_string(),
            lineno: 1,
            colno: 1,
            abs_path: None,
            context_line: None,
            pre_context: None,
            post_context: None,
            in_app,
        }
    }

    // ── unminify_react_error ──────────────────────────────────────────────────

    #[test]
    fn test_unminify_react_error_known_code() {
        let input = "Minified React error #418; see https://reactjs.org/docs/error-decoder.html";
        let result = unminify_react_error(input);
        assert!(
            result.contains("React Error #418"),
            "expected 'React Error #418' in: {result}"
        );
        assert!(
            result.contains("Hydration failed"),
            "expected 'Hydration failed' in: {result}"
        );
    }

    #[test]
    fn test_unminify_react_error_known_code_with_args() {
        let input = "Minified React error #418?args[0]=div&args[1]=span";
        let result = unminify_react_error(input);
        assert!(
            result.contains("React Error #418"),
            "expected 'React Error #418' in: {result}"
        );
        // Both arg values should appear in the output
        assert!(result.contains("div"), "expected arg 'div' in: {result}");
        assert!(result.contains("span"), "expected arg 'span' in: {result}");
    }

    #[test]
    fn test_unminify_react_error_unknown_code_fallback() {
        let input = "Minified React error #9999";
        let result = unminify_react_error(input);
        assert_eq!(result, "React Error #9999: Minified React error #9999");
    }

    #[test]
    fn test_unminify_react_error_non_react_unchanged() {
        let input = "TypeError: cannot read";
        let result = unminify_react_error(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_unminify_react_error_empty_string() {
        let result = unminify_react_error("");
        assert_eq!(result, "");
    }

    // ── generate_title ────────────────────────────────────────────────────────

    #[test]
    fn test_generate_title_short_message() {
        let exc = make_exc("TypeError", "short message", vec![]);
        let title = generate_title(&exc);
        assert_eq!(title, "TypeError: short message");
    }

    #[test]
    fn test_generate_title_exactly_100_chars_no_truncation() {
        // Build a message that is exactly 100 characters long
        let msg: String = "a".repeat(100);
        let exc = make_exc("TypeError", &msg, vec![]);
        let title = generate_title(&exc);
        assert_eq!(title, format!("TypeError: {}", msg));
        assert!(
            !title.ends_with("..."),
            "title should not be truncated at exactly 100 chars"
        );
    }

    #[test]
    fn test_generate_title_over_100_chars_truncated() {
        let msg: String = "b".repeat(105);
        let exc = make_exc("TypeError", &msg, vec![]);
        let title = generate_title(&exc);
        // Should truncate to first 97 chars + "..."
        let expected = format!("TypeError: {}...", "b".repeat(97));
        assert_eq!(title, expected);
    }

    #[test]
    fn test_generate_title_react_minified_unminified() {
        let exc = make_exc("Error", "Minified React error #418", vec![]);
        let title = generate_title(&exc);
        assert!(
            title.starts_with("Error: React Error #418"),
            "title should start with 'Error: React Error #418', got: {title}"
        );
    }

    #[test]
    fn test_generate_title_unicode_truncation_uses_char_count() {
        // Each '€' is 3 bytes in UTF-8; use 105 of them so byte count >> 100 but char count = 105
        let msg: String = "€".repeat(105);
        let exc = make_exc("TypeError", &msg, vec![]);
        let title = generate_title(&exc);
        // Must truncate at char boundary: first 97 '€' chars + "..."
        let expected = format!("TypeError: {}...", "€".repeat(97));
        assert_eq!(title, expected);
    }

    // ── generate_fingerprint additional cases ─────────────────────────────────

    #[test]
    fn test_fingerprint_no_in_app_falls_back_to_first_frame() {
        // All frames have in_app: false; fingerprint should still use the first frame
        let frames = vec![
            make_frame("src/vendor/lib.js", "internalFn", false),
            make_frame("src/app/index.js", "main", false),
        ];
        let exc = make_exc("RangeError", "out of range", frames.clone());
        let fp = generate_fingerprint(&exc);

        // Build a second exception identical in type, first frame, and message
        let exc2 = make_exc("RangeError", "out of range", frames);
        assert_eq!(fp, generate_fingerprint(&exc2));

        // Changing the first frame should change the fingerprint
        let exc_diff_frame = make_exc(
            "RangeError",
            "out of range",
            vec![make_frame("src/vendor/other.js", "otherFn", false)],
        );
        assert_ne!(fp, generate_fingerprint(&exc_diff_frame));
    }

    #[test]
    fn test_fingerprint_empty_stacktrace_uses_type_and_message_only() {
        let exc1 = make_exc("TypeError", "something went wrong", vec![]);
        let exc2 = make_exc("TypeError", "something went wrong", vec![]);
        // Same type + message, no frames → must produce the same fingerprint
        assert_eq!(generate_fingerprint(&exc1), generate_fingerprint(&exc2));

        // Different type → different fingerprint even with empty stacktrace
        let exc3 = make_exc("RangeError", "something went wrong", vec![]);
        assert_ne!(generate_fingerprint(&exc1), generate_fingerprint(&exc3));
    }

    #[test]
    fn test_fingerprint_different_exception_types_differ() {
        let frame = make_frame("src/app.ts", "doWork", true);
        let exc_type = make_exc("TypeError", "oops", vec![frame.clone()]);
        let exc_range = make_exc("RangeError", "oops", vec![frame]);
        assert_ne!(
            generate_fingerprint(&exc_type),
            generate_fingerprint(&exc_range)
        );
    }

    #[test]
    fn test_fingerprint_same_message_different_types_differ() {
        let exc1 = make_exc("TypeError", "failed", vec![]);
        let exc2 = make_exc("SyntaxError", "failed", vec![]);
        assert_ne!(generate_fingerprint(&exc1), generate_fingerprint(&exc2));
    }

    #[test]
    fn test_fingerprint_is_32_hex_chars() {
        let exc = make_exc(
            "Error",
            "test message",
            vec![make_frame("src/index.ts", "main", true)],
        );
        let fp = generate_fingerprint(&exc);
        assert_eq!(
            fp.len(),
            32,
            "fingerprint should be 32 hex characters, got: {fp}"
        );
        assert!(
            fp.chars().all(|c| c.is_ascii_hexdigit()),
            "fingerprint should only contain hex chars, got: {fp}"
        );
    }
}
