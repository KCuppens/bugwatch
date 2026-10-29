/// Safely extract a cookie value by name from a Cookie header.
///
/// Splits the header on `;`, trims each segment, then splits each segment on
/// the FIRST `=` only and compares the name EXACTLY. This avoids
/// `strip_prefix("name=")` attacks where values such as
/// `a=name=X; name=Y` would misparse.
///
/// Returns the first match's value (trimmed together with the segment). If the same cookie
/// appears multiple times, the first occurrence wins.
pub fn extract_cookie<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    for segment in header.split(';') {
        let seg = segment.trim();
        if let Some((k, v)) = seg.split_once('=') {
            if k == name {
                return Some(v);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_simple_cookie() {
        assert_eq!(
            extract_cookie("access_token=abc", "access_token"),
            Some("abc")
        );
    }

    #[test]
    fn extracts_cookie_with_whitespace() {
        assert_eq!(
            extract_cookie("foo=1; access_token=xyz; bar=2", "access_token"),
            Some("xyz")
        );
    }

    #[test]
    fn malformed_cookie_value_containing_name_is_not_misparsed() {
        // Previously `split.find_map(strip_prefix("access_token="))` would
        // incorrectly match the first segment here.
        let header = "a=access_token=Y; access_token=X";
        assert_eq!(extract_cookie(header, "access_token"), Some("X"));
    }

    #[test]
    fn returns_none_when_absent() {
        assert_eq!(extract_cookie("foo=1; bar=2", "access_token"), None);
    }

    #[test]
    fn empty_value_is_returned_as_empty() {
        assert_eq!(
            extract_cookie("access_token=; foo=1", "access_token"),
            Some("")
        );
    }

    #[test]
    fn exact_name_match_not_prefix() {
        // Ensure "access_token_x" does not match "access_token"
        let header = "access_token_x=bad; access_token=good";
        assert_eq!(extract_cookie(header, "access_token"), Some("good"));
    }

    #[test]
    fn first_occurrence_wins() {
        assert_eq!(
            extract_cookie("access_token=first; access_token=second", "access_token"),
            Some("first")
        );
    }

    #[test]
    fn empty_segments_are_skipped() {
        assert_eq!(
            extract_cookie(";; access_token=ok ;;", "access_token"),
            Some("ok")
        );
    }
}
