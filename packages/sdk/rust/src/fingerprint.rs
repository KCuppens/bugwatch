//! Error fingerprinting for grouping similar errors.

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::types::ExceptionInfo;

/// Generate a fingerprint for grouping similar errors.
///
/// # Arguments
///
/// * `error_type` - The type/class of the error
/// * `message` - The error message
/// * `stacktrace` - Optional normalized stacktrace string
///
/// # Returns
///
/// A hex string fingerprint (32 characters)
pub fn generate_fingerprint(
    error_type: &str,
    message: &str,
    stacktrace: Option<&str>,
) -> String {
    // Normalize the message by removing variable parts
    let normalized_message = normalize_message(message);

    // Create fingerprint content
    let mut content = format!("{}:{}", error_type, normalized_message);

    if let Some(st) = stacktrace {
        content.push(':');
        content.push_str(st);
    }

    // Generate hash
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();

    // Return first 32 hex characters
    hex::encode(&result[..16])
}

/// Generate a fingerprint from an ExceptionInfo object.
///
/// # Arguments
///
/// * `exception` - The exception information
///
/// # Returns
///
/// A hex string fingerprint (32 characters)
pub fn fingerprint_from_exception(exception: &ExceptionInfo) -> String {
    // Build stacktrace string from top frames
    let stacktrace_parts: Vec<String> = exception
        .stacktrace
        .iter()
        .filter(|frame| frame.in_app)
        .take(5) // Use top 5 in-app frames
        .map(|frame| format!("{}:{}:{}", frame.filename, frame.function, frame.lineno))
        .collect();

    let stacktrace = if stacktrace_parts.is_empty() {
        None
    } else {
        Some(stacktrace_parts.join("|"))
    };

    generate_fingerprint(
        &exception.error_type,
        &exception.value,
        stacktrace.as_deref(),
    )
}

/// Normalize an error message by removing variable parts.
fn normalize_message(message: &str) -> String {
    lazy_static::lazy_static! {
        // Numbers
        static ref RE_NUMBERS: Regex = Regex::new(r"\d+").unwrap();
        // Hex values
        static ref RE_HEX: Regex = Regex::new(r"0x[0-9a-fA-F]+").unwrap();
        // UUIDs
        static ref RE_UUID: Regex = Regex::new(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
        ).unwrap();
        // File paths (Unix)
        static ref RE_PATH_UNIX: Regex = Regex::new(r"(/[\w\-./]+)+").unwrap();
        // File paths (Windows)
        static ref RE_PATH_WIN: Regex = Regex::new(r"(\\[\w\-.\\ ]+)+").unwrap();
        // Double-quoted strings
        static ref RE_QUOTED_DOUBLE: Regex = Regex::new(r#""[^"]*""#).unwrap();
        // Single-quoted strings
        static ref RE_QUOTED_SINGLE: Regex = Regex::new(r"'[^']*'").unwrap();
        // Memory addresses
        static ref RE_ADDR: Regex = Regex::new(r"at 0x[0-9a-fA-F]+").unwrap();
    }

    let mut normalized = message.to_string();

    // Replace patterns in order (more specific first)
    normalized = RE_UUID.replace_all(&normalized, "<uuid>").to_string();
    normalized = RE_HEX.replace_all(&normalized, "<hex>").to_string();
    normalized = RE_ADDR.replace_all(&normalized, "at <address>").to_string();
    normalized = RE_NUMBERS.replace_all(&normalized, "<number>").to_string();
    normalized = RE_PATH_UNIX.replace_all(&normalized, "<path>").to_string();
    normalized = RE_PATH_WIN.replace_all(&normalized, "<path>").to_string();
    normalized = RE_QUOTED_DOUBLE.replace_all(&normalized, "<string>").to_string();
    normalized = RE_QUOTED_SINGLE.replace_all(&normalized, "<string>").to_string();

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::StackFrame;

    #[test]
    fn test_consistent_fingerprint_for_same_error() {
        let fp1 = generate_fingerprint("TypeError", "Cannot read property 'x' of undefined", None);
        let fp2 = generate_fingerprint("TypeError", "Cannot read property 'x' of undefined", None);
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_different_fingerprint_for_different_type() {
        let fp1 = generate_fingerprint("TypeError", "error message", None);
        let fp2 = generate_fingerprint("ValueError", "error message", None);
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn test_normalizes_numbers() {
        let fp1 = generate_fingerprint("IndexError", "index 5 out of range", None);
        let fp2 = generate_fingerprint("IndexError", "index 10 out of range", None);
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_normalizes_uuids() {
        let fp1 = generate_fingerprint(
            "KeyError",
            "user 550e8400-e29b-41d4-a716-446655440000 not found",
            None,
        );
        let fp2 = generate_fingerprint(
            "KeyError",
            "user 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found",
            None,
        );
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_fingerprint_from_exception() {
        let exception = ExceptionInfo {
            error_type: "ValueError".to_string(),
            value: "invalid value".to_string(),
            stacktrace: vec![StackFrame::new("app.rs", "main", 10)],
            module: None,
        };
        let fp = fingerprint_from_exception(&exception);
        assert_eq!(fp.len(), 32);
    }
}
