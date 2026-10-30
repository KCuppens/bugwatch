//! Source Map v3 decoder.
//!
//! Supports regular maps and indexed maps (`sections`). Mappings are decoded
//! into one flat, position-sorted token table so a lookup is a single binary
//! search regardless of whether the generated bundle is multi-line (Metro/JSC,
//! webpack) or one huge line (Hermes composed maps).
//!
//! Only what symbolication needs is kept: generated position, original source
//! index, original position and name index. `sourcesContent` is retained so
//! callers can attach source context lines.

use serde::Deserialize;

/// Marker for "no source" / "no name" in a token.
const NONE: u32 = u32::MAX;

/// Hard cap on decoded tokens (about 24 bytes each) to bound memory.
const MAX_TOKENS: usize = 20_000_000;

/// Indexed maps may nest only to this depth (the spec forbids nesting; this
/// is a recursion guard, not a feature).
const MAX_SECTION_DEPTH: u32 = 4;

#[derive(Debug, PartialEq, Eq)]
pub enum SourceMapError {
    InvalidJson(String),
    UnsupportedVersion(u32),
    UnsupportedSectionUrl,
    InvalidMappings(&'static str),
    TooLarge,
}

impl std::fmt::Display for SourceMapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SourceMapError::InvalidJson(e) => write!(f, "invalid source map JSON: {e}"),
            SourceMapError::UnsupportedVersion(v) => {
                write!(f, "unsupported source map version {v} (expected 3)")
            }
            SourceMapError::UnsupportedSectionUrl => {
                write!(
                    f,
                    "indexed source map sections referencing a url are not supported"
                )
            }
            SourceMapError::InvalidMappings(why) => write!(f, "invalid mappings: {why}"),
            SourceMapError::TooLarge => write!(f, "source map has too many mappings"),
        }
    }
}

impl std::error::Error for SourceMapError {}

#[derive(Deserialize)]
struct RawMap {
    version: Option<u32>,
    #[serde(default)]
    sources: Vec<Option<String>>,
    #[serde(default, rename = "sourcesContent")]
    sources_content: Vec<Option<String>>,
    #[serde(default)]
    names: Vec<Option<String>>,
    #[serde(default)]
    mappings: String,
    #[serde(default, rename = "sourceRoot")]
    source_root: Option<String>,
    #[serde(default)]
    sections: Option<Vec<RawSection>>,
}

#[derive(Deserialize)]
struct RawSection {
    offset: RawOffset,
    map: Option<Box<RawMap>>,
    url: Option<String>,
}

#[derive(Deserialize)]
struct RawOffset {
    line: u32,
    column: u32,
}

#[derive(Clone, Copy, Debug)]
struct Token {
    gen_line: u32,
    gen_col: u32,
    source: u32,
    src_line: u32,
    src_col: u32,
    name: u32,
}

/// A decoded source map ready for position lookups.
#[derive(Debug)]
pub struct SourceMap {
    sources: Vec<String>,
    sources_content: Vec<Option<String>>,
    names: Vec<String>,
    tokens: Vec<Token>,
}

/// The original location a generated position maps to.
#[derive(Debug, PartialEq, Eq)]
pub struct OriginalLocation<'a> {
    pub source: &'a str,
    /// 1-based original line.
    pub line: u32,
    /// 1-based original column.
    pub column: u32,
    /// Original identifier recorded at this position, if any.
    pub name: Option<&'a str>,
    /// Full original source text, when the map embeds `sourcesContent`.
    pub content: Option<&'a str>,
}

impl SourceMap {
    pub fn parse(bytes: &[u8]) -> Result<Self, SourceMapError> {
        let raw: RawMap = serde_json::from_slice(bytes)
            .map_err(|e| SourceMapError::InvalidJson(e.to_string()))?;

        let mut map = SourceMap {
            sources: Vec::new(),
            sources_content: Vec::new(),
            names: Vec::new(),
            tokens: Vec::new(),
        };
        map.append(raw, 0, 0, 0)?;

        if !map
            .tokens
            .windows(2)
            .all(|w| (w[0].gen_line, w[0].gen_col) <= (w[1].gen_line, w[1].gen_col))
        {
            map.tokens.sort_by_key(|t| (t.gen_line, t.gen_col));
        }
        map.tokens.shrink_to_fit();
        Ok(map)
    }

    fn append(
        &mut self,
        raw: RawMap,
        line_offset: u32,
        col_offset: u32,
        depth: u32,
    ) -> Result<(), SourceMapError> {
        if let Some(v) = raw.version {
            if v != 3 {
                return Err(SourceMapError::UnsupportedVersion(v));
            }
        }

        if let Some(sections) = raw.sections {
            if depth >= MAX_SECTION_DEPTH {
                return Err(SourceMapError::InvalidMappings(
                    "sections nested too deeply",
                ));
            }
            for section in sections {
                if section.url.is_some() {
                    return Err(SourceMapError::UnsupportedSectionUrl);
                }
                let Some(inner) = section.map else {
                    return Err(SourceMapError::InvalidMappings("section without a map"));
                };
                let line = line_offset
                    .checked_add(section.offset.line)
                    .ok_or(SourceMapError::InvalidMappings("section offset overflow"))?;
                // The section's column offset only applies to the generated
                // line the section starts on; the caller handles that in
                // `decode_mappings` via `col_offset` on local line 0.
                let col = col_offset
                    .checked_add(section.offset.column)
                    .ok_or(SourceMapError::InvalidMappings("section offset overflow"))?;
                self.append(*inner, line, col, depth + 1)?;
            }
            return Ok(());
        }

        let source_base = to_u32(self.sources.len())?;
        let name_base = to_u32(self.names.len())?;
        let source_count = to_u32(raw.sources.len())?;
        let name_count = to_u32(raw.names.len())?;

        let root = raw.source_root.as_deref().filter(|r| !r.is_empty());
        let mut contents = raw.sources_content.into_iter();
        for source in raw.sources {
            let source = source.unwrap_or_default();
            self.sources.push(join_source_root(root, &source));
            self.sources_content.push(contents.next().flatten());
        }
        self.names
            .extend(raw.names.into_iter().map(Option::unwrap_or_default));

        decode_mappings(
            &raw.mappings,
            &mut self.tokens,
            Bases {
                source: source_base,
                name: name_base,
                source_count,
                name_count,
                line_offset,
                col_offset,
            },
        )
    }

    /// Look up the original location for a generated position.
    ///
    /// `line` and `column` are 1-based (the SDK contract). Returns `None` when
    /// no mapping starts at or before the position on the same generated line,
    /// or when the nearest mapping is an unmapped segment.
    pub fn lookup(&self, line: u32, column: u32) -> Option<OriginalLocation<'_>> {
        let gen_line = line.checked_sub(1)?;
        let gen_col = column.saturating_sub(1);

        let idx = self
            .tokens
            .partition_point(|t| (t.gen_line, t.gen_col) <= (gen_line, gen_col));
        let token = self.tokens.get(idx.checked_sub(1)?)?;
        if token.gen_line != gen_line || token.source == NONE {
            return None;
        }

        let source_idx = token.source as usize;
        Some(OriginalLocation {
            source: self.sources.get(source_idx)?,
            line: token.src_line + 1,
            column: token.src_col + 1,
            name: (token.name != NONE)
                .then(|| self.names.get(token.name as usize).map(String::as_str))
                .flatten()
                .filter(|n| !n.is_empty()),
            content: self
                .sources_content
                .get(source_idx)
                .and_then(|c| c.as_deref()),
        })
    }

    /// Approximate heap footprint in bytes, used for cache accounting.
    pub fn estimated_size(&self) -> usize {
        self.tokens.capacity() * std::mem::size_of::<Token>()
            + self.sources.iter().map(|s| s.len() + 24).sum::<usize>()
            + self.names.iter().map(|s| s.len() + 24).sum::<usize>()
            + self
                .sources_content
                .iter()
                .map(|c| c.as_ref().map_or(0, String::len) + 24)
                .sum::<usize>()
    }
}

fn to_u32(n: usize) -> Result<u32, SourceMapError> {
    u32::try_from(n).map_err(|_| SourceMapError::TooLarge)
}

fn join_source_root(root: Option<&str>, source: &str) -> String {
    match root {
        Some(root) if !source.is_empty() && !source.starts_with('/') && !source.contains("://") => {
            if root.ends_with('/') {
                format!("{root}{source}")
            } else {
                format!("{root}/{source}")
            }
        }
        _ => source.to_string(),
    }
}

struct Bases {
    source: u32,
    name: u32,
    source_count: u32,
    name_count: u32,
    line_offset: u32,
    col_offset: u32,
}

fn decode_mappings(
    mappings: &str,
    out: &mut Vec<Token>,
    bases: Bases,
) -> Result<(), SourceMapError> {
    let bytes = mappings.as_bytes();
    let mut i = 0;
    let mut gen_line: u32 = 0;
    let mut gen_col: i64 = 0;
    let mut source: i64 = 0;
    let mut src_line: i64 = 0;
    let mut src_col: i64 = 0;
    let mut name: i64 = 0;

    while i < bytes.len() {
        match bytes[i] {
            b';' => {
                gen_line = gen_line
                    .checked_add(1)
                    .ok_or(SourceMapError::InvalidMappings("too many lines"))?;
                gen_col = 0;
                i += 1;
                continue;
            }
            b',' => {
                i += 1;
                continue;
            }
            _ => {}
        }

        let mut fields = [0i64; 5];
        let mut n = 0;
        while i < bytes.len() && bytes[i] != b',' && bytes[i] != b';' {
            if n == 5 {
                return Err(SourceMapError::InvalidMappings(
                    "segment has too many fields",
                ));
            }
            let (value, next) = read_vlq(bytes, i)?;
            fields[n] = value;
            n += 1;
            i = next;
        }

        gen_col += fields[0];
        if gen_col < 0 || gen_col > i64::from(u32::MAX) {
            return Err(SourceMapError::InvalidMappings(
                "generated column out of range",
            ));
        }

        let out_line = bases
            .line_offset
            .checked_add(gen_line)
            .ok_or(SourceMapError::InvalidMappings("too many lines"))?;
        // Only the first generated line of a section is shifted by the
        // section's column offset.
        let out_col = if gen_line == 0 {
            (gen_col as u32).checked_add(bases.col_offset).ok_or(
                SourceMapError::InvalidMappings("generated column out of range"),
            )?
        } else {
            gen_col as u32
        };

        let token = match n {
            1 => Token {
                gen_line: out_line,
                gen_col: out_col,
                source: NONE,
                src_line: 0,
                src_col: 0,
                name: NONE,
            },
            4 | 5 => {
                source += fields[1];
                src_line += fields[2];
                src_col += fields[3];
                if source < 0 || source >= i64::from(bases.source_count) {
                    return Err(SourceMapError::InvalidMappings("source index out of range"));
                }
                if src_line < 0 || src_line > i64::from(u32::MAX - 1) {
                    return Err(SourceMapError::InvalidMappings("source line out of range"));
                }
                if src_col < 0 || src_col > i64::from(u32::MAX - 1) {
                    return Err(SourceMapError::InvalidMappings(
                        "source column out of range",
                    ));
                }
                let mut name_idx = NONE;
                if n == 5 {
                    name += fields[4];
                    if name < 0 || name >= i64::from(bases.name_count) {
                        return Err(SourceMapError::InvalidMappings("name index out of range"));
                    }
                    name_idx = bases.name + name as u32;
                }
                Token {
                    gen_line: out_line,
                    gen_col: out_col,
                    source: bases.source + source as u32,
                    src_line: src_line as u32,
                    src_col: src_col as u32,
                    name: name_idx,
                }
            }
            _ => {
                return Err(SourceMapError::InvalidMappings(
                    "segment must have 1, 4 or 5 fields",
                ))
            }
        };

        if out.len() >= MAX_TOKENS {
            return Err(SourceMapError::TooLarge);
        }
        out.push(token);
    }
    Ok(())
}

/// Decode one base64 VLQ value starting at `start`; returns the value and the
/// index of the next unread byte.
fn read_vlq(bytes: &[u8], start: usize) -> Result<(i64, usize), SourceMapError> {
    let mut result: i64 = 0;
    let mut shift = 0u32;
    let mut i = start;
    loop {
        let byte = *bytes
            .get(i)
            .ok_or(SourceMapError::InvalidMappings("truncated VLQ value"))?;
        let digit =
            base64_digit(byte).ok_or(SourceMapError::InvalidMappings("invalid base64 digit"))?;
        i += 1;
        if shift > 30 {
            return Err(SourceMapError::InvalidMappings("VLQ value overflow"));
        }
        result |= i64::from(digit & 0x1f) << shift;
        shift += 5;
        if digit & 0x20 == 0 {
            break;
        }
    }
    let magnitude = result >> 1;
    Ok((
        if result & 1 == 1 {
            -magnitude
        } else {
            magnitude
        },
        i,
    ))
}

fn base64_digit(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    fn vlq(value: i64) -> String {
        let mut v = if value < 0 {
            ((-value) << 1) | 1
        } else {
            value << 1
        };
        let mut out = String::new();
        loop {
            let mut digit = (v & 0x1f) as u8;
            v >>= 5;
            if v > 0 {
                digit |= 0x20;
            }
            out.push(B64[digit as usize] as char);
            if v == 0 {
                break;
            }
        }
        out
    }

    fn segment(fields: &[i64]) -> String {
        fields.iter().map(|f| vlq(*f)).collect()
    }

    fn parse(value: serde_json::Value) -> Result<SourceMap, SourceMapError> {
        SourceMap::parse(value.to_string().as_bytes())
    }

    #[test]
    fn vlq_round_trips_through_decoder() {
        for value in [
            0, 1, -1, 15, 16, -16, 31, 32, 1000, -1000, 123_456, -123_456,
        ] {
            let encoded = vlq(value);
            let (decoded, next) = read_vlq(encoded.as_bytes(), 0).unwrap();
            assert_eq!(decoded, value, "encoded as {encoded}");
            assert_eq!(next, encoded.len());
        }
    }

    #[test]
    fn vlq_known_spec_values() {
        assert_eq!(read_vlq(b"A", 0).unwrap().0, 0);
        assert_eq!(read_vlq(b"C", 0).unwrap().0, 1);
        assert_eq!(read_vlq(b"D", 0).unwrap().0, -1);
        assert_eq!(read_vlq(b"gB", 0).unwrap().0, 16);
    }

    #[test]
    fn vlq_rejects_garbage() {
        assert!(read_vlq(b"!", 0).is_err());
        assert!(read_vlq(b"g", 0).is_err(), "truncated continuation");
        assert!(read_vlq(b"gggggggggg", 0).is_err(), "overflow");
    }

    #[test]
    fn lookup_maps_multi_line_bundle() {
        // line 1: col 0 -> a.js 0:0, col 10 -> a.js 2:4 (name "foo")
        // line 2: col 0 -> b.js 5:1
        let mappings = format!(
            "{},{};{}",
            segment(&[0, 0, 0, 0]),
            segment(&[10, 0, 2, 4, 0]),
            segment(&[0, 1, 3, -4]),
        );
        let map = parse(json!({
            "version": 3,
            "sources": ["a.js", "b.js"],
            "names": ["foo"],
            "mappings": mappings,
        }))
        .unwrap();

        let loc = map.lookup(1, 1).unwrap();
        assert_eq!(
            (loc.source, loc.line, loc.column, loc.name),
            ("a.js", 1, 1, None)
        );

        // Column between tokens resolves to the preceding token.
        let loc = map.lookup(1, 15).unwrap();
        assert_eq!(
            (loc.source, loc.line, loc.column, loc.name),
            ("a.js", 3, 5, Some("foo"))
        );

        let loc = map.lookup(2, 1).unwrap();
        assert_eq!((loc.source, loc.line, loc.column), ("b.js", 6, 1));

        // Line without mappings and out-of-range lines miss.
        assert!(map.lookup(3, 1).is_none());
        assert!(map.lookup(0, 1).is_none());
    }

    #[test]
    fn lookup_does_not_leak_across_lines() {
        let map = parse(json!({
            "version": 3,
            "sources": ["a.js"],
            "names": [],
            "mappings": format!("{};;", segment(&[5, 0, 0, 0])),
        }))
        .unwrap();
        assert!(map.lookup(1, 6).is_some());
        assert!(map.lookup(1, 5).is_none(), "before first token on the line");
        assert!(map.lookup(2, 100).is_none(), "next line has no tokens");
    }

    #[test]
    fn lookup_handles_single_line_hermes_style_bundle() {
        // One generated line, many columns.
        let mappings = format!(
            "{},{},{}",
            segment(&[100, 0, 9, 2]),
            segment(&[900, 0, 4, 0]),
            segment(&[5000, 0, -3, 7]),
        );
        let map = parse(json!({
            "version": 3,
            "sources": ["App.js"],
            "names": [],
            "mappings": mappings,
        }))
        .unwrap();

        let loc = map.lookup(1, 101).unwrap();
        assert_eq!((loc.line, loc.column), (10, 3));
        let loc = map.lookup(1, 1500).unwrap();
        assert_eq!((loc.line, loc.column), (14, 3));
        let loc = map.lookup(1, 6001).unwrap();
        assert_eq!((loc.line, loc.column), (11, 10));
        assert!(map.lookup(1, 50).is_none());
    }

    #[test]
    fn unmapped_segment_terminates_previous_mapping() {
        let mappings = format!("{},{}", segment(&[0, 0, 0, 0]), segment(&[10]));
        let map = parse(json!({
            "version": 3,
            "sources": ["a.js"],
            "names": [],
            "mappings": mappings,
        }))
        .unwrap();
        assert!(map.lookup(1, 5).is_some());
        assert!(map.lookup(1, 11).is_none());
    }

    #[test]
    fn source_root_and_content_are_applied() {
        let map = parse(json!({
            "version": 3,
            "sourceRoot": "src",
            "sources": ["a.js", "/abs/b.js"],
            "sourcesContent": ["one\ntwo", null],
            "names": [],
            "mappings": format!("{},{}", segment(&[0, 0, 1, 0]), segment(&[4, 1, 0, 0])),
        }))
        .unwrap();

        let a = map.lookup(1, 1).unwrap();
        assert_eq!(a.source, "src/a.js");
        assert_eq!(a.content, Some("one\ntwo"));
        let b = map.lookup(1, 5).unwrap();
        assert_eq!(b.source, "/abs/b.js");
        assert_eq!(b.content, None);
    }

    #[test]
    fn indexed_map_sections_are_offset_and_merged() {
        let first = json!({
            "version": 3,
            "sources": ["a.js"],
            "names": ["alpha"],
            "mappings": segment(&[0, 0, 0, 0, 0]),
        });
        let second = json!({
            "version": 3,
            "sources": ["b.js"],
            "names": ["beta"],
            "mappings": format!("{};{}", segment(&[2, 0, 7, 1, 0]), segment(&[3, 0, 1, 0, 0])),
        });
        let map = parse(json!({
            "version": 3,
            "sections": [
                {"offset": {"line": 0, "column": 0}, "map": first},
                {"offset": {"line": 4, "column": 10}, "map": second},
            ],
        }))
        .unwrap();

        let loc = map.lookup(1, 1).unwrap();
        assert_eq!((loc.source, loc.name), ("a.js", Some("alpha")));

        // Section 2 starts on generated line 5 (index 4), column offset 10
        // applies to that first line only.
        assert!(map.lookup(5, 10).is_none());
        let loc = map.lookup(5, 13).unwrap();
        assert_eq!(
            (loc.source, loc.line, loc.column, loc.name),
            ("b.js", 8, 2, Some("beta"))
        );
        let loc = map.lookup(6, 4).unwrap();
        assert_eq!(
            (loc.source, loc.line, loc.column, loc.name),
            ("b.js", 9, 2, Some("beta"))
        );
    }

    #[test]
    fn rejects_invalid_maps() {
        assert!(matches!(
            SourceMap::parse(b"not json"),
            Err(SourceMapError::InvalidJson(_))
        ));
        assert_eq!(
            parse(json!({"version": 2, "sources": [], "mappings": ""})).unwrap_err(),
            SourceMapError::UnsupportedVersion(2)
        );
        assert!(matches!(
            parse(
                json!({"version": 3, "sources": ["a"], "names": [], "mappings": "AAAA,AAAAA,AAAAAA"})
            ),
            Err(SourceMapError::InvalidMappings(_))
        ));
        // Source index out of range.
        assert!(matches!(
            parse(
                json!({"version": 3, "sources": ["a"], "names": [], "mappings": segment(&[0, 1, 0, 0])})
            ),
            Err(SourceMapError::InvalidMappings(_))
        ));
        // Name index out of range.
        assert!(matches!(
            parse(
                json!({"version": 3, "sources": ["a"], "names": [], "mappings": segment(&[0, 0, 0, 0, 0])})
            ),
            Err(SourceMapError::InvalidMappings(_))
        ));
        // Negative generated column.
        assert!(matches!(
            parse(
                json!({"version": 3, "sources": ["a"], "names": [], "mappings": segment(&[-1, 0, 0, 0])})
            ),
            Err(SourceMapError::InvalidMappings(_))
        ));
        // Two-field segment is not valid.
        assert!(matches!(
            parse(
                json!({"version": 3, "sources": ["a"], "names": [], "mappings": segment(&[0, 0])})
            ),
            Err(SourceMapError::InvalidMappings(_))
        ));
        assert_eq!(
            parse(json!({"version": 3, "sections": [{"offset": {"line": 0, "column": 0}, "url": "x.map"}]}))
                .unwrap_err(),
            SourceMapError::UnsupportedSectionUrl
        );
    }

    #[test]
    fn empty_map_parses_and_never_matches() {
        let map = parse(json!({"version": 3, "sources": [], "names": [], "mappings": ""})).unwrap();
        assert!(map.lookup(1, 1).is_none());
    }

    #[test]
    fn out_of_order_tokens_are_sorted() {
        // Second segment has a negative column delta, producing an unsorted pair.
        let map = parse(json!({
            "version": 3,
            "sources": ["a.js"],
            "names": [],
            "mappings": format!("{},{}", segment(&[20, 0, 5, 0]), segment(&[-10, 0, 1, 0])),
        }))
        .unwrap();
        assert_eq!(map.lookup(1, 11).unwrap().line, 7);
        assert_eq!(map.lookup(1, 21).unwrap().line, 6);
    }
}
