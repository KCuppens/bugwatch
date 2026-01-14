use regex::Regex;
use sha2::{Digest, Sha256};

use crate::api::events::{ExceptionInfo, StackFrame};

/// Generate a fingerprint for error grouping.
/// Groups identical errors together even with different data values.
pub fn generate_fingerprint(exception: &ExceptionInfo) -> String {
    let mut components: Vec<String> = Vec::new();

    // 1. Exception type
    components.push(exception.exception_type.clone());

    // 2. Top 5 in-app frames (file:function)
    let in_app_frames: Vec<&StackFrame> = exception
        .stacktrace
        .iter()
        .filter(|f| f.in_app)
        .take(5)
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
    let single_quote_re = Regex::new(r"'[^']*'").unwrap();
    result = single_quote_re.replace_all(&result, "'*'").to_string();

    // Replace double-quoted strings
    let double_quote_re = Regex::new(r#""[^"]*""#).unwrap();
    result = double_quote_re.replace_all(&result, "\"*\"").to_string();

    // Replace UUIDs
    let uuid_re = Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap();
    result = uuid_re.replace_all(&result, "*").to_string();

    // Replace IP addresses
    let ip_re = Regex::new(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}").unwrap();
    result = ip_re.replace_all(&result, "*").to_string();

    // Replace numbers (but not in function/file names context)
    let number_re = Regex::new(r"\b\d+\b").unwrap();
    result = number_re.replace_all(&result, "*").to_string();

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
}
