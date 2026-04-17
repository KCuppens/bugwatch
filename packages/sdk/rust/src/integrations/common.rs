//! Common utilities for framework integrations.

use std::collections::HashMap;
use std::net::IpAddr;

/// Headers that should be filtered out for security reasons.
const SENSITIVE_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
    "x-xsrf-token",
    "proxy-authorization",
];

/// Filter sensitive headers from a header map.
///
/// This removes headers like `Authorization`, `Cookie`, etc. that may contain
/// sensitive information that should not be sent to error tracking services.
pub fn filter_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    headers
        .iter()
        .filter(|(key, _)| !is_sensitive_header(key))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// Check if a header name is considered sensitive.
pub fn is_sensitive_header(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    SENSITIVE_HEADERS.contains(&name_lower.as_str())
}

/// Extract client IP address from request headers.
///
/// Checks common proxy headers in order of preference:
/// 1. X-Forwarded-For (first IP in the list)
/// 2. X-Real-IP
/// 3. CF-Connecting-IP (Cloudflare)
/// 4. True-Client-IP (Akamai)
///
/// Returns `None` if no valid IP address is found.
pub fn extract_client_ip(headers: &HashMap<String, String>) -> Option<IpAddr> {
    // X-Forwarded-For: client, proxy1, proxy2
    if let Some(forwarded) = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("X-Forwarded-For"))
    {
        if let Some(first_ip) = forwarded.split(',').next() {
            if let Ok(ip) = first_ip.trim().parse() {
                return Some(ip);
            }
        }
    }

    // X-Real-IP
    if let Some(real_ip) = headers
        .get("x-real-ip")
        .or_else(|| headers.get("X-Real-IP"))
    {
        if let Ok(ip) = real_ip.trim().parse() {
            return Some(ip);
        }
    }

    // CF-Connecting-IP (Cloudflare)
    if let Some(cf_ip) = headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("CF-Connecting-IP"))
    {
        if let Ok(ip) = cf_ip.trim().parse() {
            return Some(ip);
        }
    }

    // True-Client-IP (Akamai)
    if let Some(true_ip) = headers
        .get("true-client-ip")
        .or_else(|| headers.get("True-Client-IP"))
    {
        if let Ok(ip) = true_ip.trim().parse() {
            return Some(ip);
        }
    }

    None
}

/// Build a full URL from components.
pub fn build_url(scheme: &str, host: &str, path: &str, query: Option<&str>) -> String {
    let mut url = format!("{}://{}{}", scheme, host, path);
    if let Some(q) = query {
        if !q.is_empty() {
            url.push('?');
            url.push_str(q);
        }
    }
    url
}

/// Normalize an HTTP method to uppercase.
pub fn normalize_method(method: &str) -> String {
    method.to_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_headers() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("Authorization".to_string(), "Bearer secret".to_string());
        headers.insert("X-Request-Id".to_string(), "abc123".to_string());

        let filtered = filter_headers(&headers);

        assert_eq!(filtered.len(), 2);
        assert!(filtered.contains_key("Content-Type"));
        assert!(filtered.contains_key("X-Request-Id"));
        assert!(!filtered.contains_key("Authorization"));
    }

    #[test]
    fn test_is_sensitive_header() {
        assert!(is_sensitive_header("authorization"));
        assert!(is_sensitive_header("Authorization"));
        assert!(is_sensitive_header("AUTHORIZATION"));
        assert!(is_sensitive_header("cookie"));
        assert!(is_sensitive_header("x-api-key"));
        assert!(!is_sensitive_header("content-type"));
        assert!(!is_sensitive_header("x-request-id"));
    }

    #[test]
    fn test_extract_client_ip() {
        let mut headers = HashMap::new();
        headers.insert(
            "X-Forwarded-For".to_string(),
            "192.168.1.1, 10.0.0.1".to_string(),
        );

        let ip = extract_client_ip(&headers);
        assert_eq!(ip, Some("192.168.1.1".parse().unwrap()));
    }

    #[test]
    fn test_extract_client_ip_real_ip() {
        let mut headers = HashMap::new();
        headers.insert("X-Real-IP".to_string(), "10.0.0.50".to_string());

        let ip = extract_client_ip(&headers);
        assert_eq!(ip, Some("10.0.0.50".parse().unwrap()));
    }

    #[test]
    fn test_build_url() {
        assert_eq!(
            build_url("https", "example.com", "/api/users", Some("page=1")),
            "https://example.com/api/users?page=1"
        );
        assert_eq!(
            build_url("http", "localhost:8080", "/health", None),
            "http://localhost:8080/health"
        );
    }
}
