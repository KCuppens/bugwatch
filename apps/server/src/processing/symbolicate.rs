//! Server-side source map symbolication for JavaScript / React Native events.
//!
//! Runs at ingest, before fingerprinting. Frames whose bundle has an uploaded
//! source map (keyed by project, release, `dist` tag and bundle basename) are
//! rewritten to their original source location; the raw frame is preserved in
//! `StackFrame::minified`. Frames without a matching map are left untouched and
//! symbolication problems never fail ingest.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::OnceCell;

use crate::api::events::{ErrorEvent, MinifiedFrame, StackFrame};
use crate::db::{repositories::SourceMapRepository, DbPool};
use crate::processing::sourcemap::SourceMap;

/// Platforms whose frames are JS bundle frames.
const SYMBOLICATED_PLATFORMS: [&str; 2] = ["react-native", "javascript"];

/// Hard cap on the uncompressed size of an uploaded source map.
pub const MAX_SOURCE_MAP_BYTES: usize = 50 * 1024 * 1024;

/// Distinct bundles looked up per event. Bundle names come from the event, so
/// this bounds the DB lookups (and cache entries) a single event can cause.
const MAX_BUNDLES_PER_EVENT: usize = 4;

const CACHE_BUDGET_BYTES: usize = 256 * 1024 * 1024;
const CACHE_MAX_ENTRIES: usize = 2048;
const POSITIVE_TTL: Duration = Duration::from_secs(10 * 60);
const NEGATIVE_TTL: Duration = Duration::from_secs(60);

const CONTEXT_LINES: usize = 5;
const MAX_CONTEXT_LINE_CHARS: usize = 300;

// ============================================================================
// Storage format
// ============================================================================

/// Compress a source map for storage (zlib).
pub fn compress_map(data: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(data, 6)
}

/// Decompress a stored source map, refusing to inflate past `MAX_SOURCE_MAP_BYTES`.
pub fn decompress_map(data: &[u8]) -> Result<Vec<u8>, String> {
    miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, MAX_SOURCE_MAP_BYTES)
        .map_err(|e| format!("corrupt stored source map: {e:?}"))
}

// ============================================================================
// Path helpers
// ============================================================================

/// Reduce a frame filename / URL to the bundle basename used as the lookup key
/// (`app:///index.android.bundle` -> `index.android.bundle`). Query strings and
/// fragments are dropped. Returns `None` if nothing usable remains.
pub fn bundle_basename(filename: &str) -> Option<String> {
    let without_query = filename.split(['?', '#']).next().unwrap_or("");
    let base = without_query
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim();
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

/// Normalise a map `sources` entry into a project-relative path for display
/// and fingerprinting: strips bundler schemes (`webpack://name/`, `file://`),
/// leading `./`, and anything before a `node_modules/` segment.
pub fn clean_source_path(source: &str) -> String {
    let mut s = source;
    if let Some(rest) = s.strip_prefix("webpack://") {
        // webpack://<namespace>/<path>; the namespace may be empty ("webpack:///").
        s = rest.split_once('/').map(|(_, path)| path).unwrap_or(rest);
    } else if let Some(rest) = s.strip_prefix("file://") {
        s = rest;
    }
    while let Some(rest) = s.strip_prefix("./") {
        s = rest;
    }
    if let Some(idx) = s.find("node_modules/") {
        s = &s[idx..];
    }
    s.to_string()
}

fn is_third_party(path: &str) -> bool {
    path.starts_with("node_modules/") || path.contains("/node_modules/")
}

// ============================================================================
// Frame rewriting (pure)
// ============================================================================

fn is_placeholder_function(name: &str) -> bool {
    matches!(
        name,
        "" | "?" | "<anonymous>" | "anonymous" | "(anonymous)" | "<unknown>" | "global code"
    ) || name.starts_with("?anon")
}

/// Function names that are probably minifier output and safe to replace.
fn is_replaceable_function(name: &str) -> bool {
    is_placeholder_function(name) || name.chars().count() <= 3
}

fn truncate_chars(line: &str) -> String {
    line.chars().take(MAX_CONTEXT_LINE_CHARS).collect()
}

fn context_window(content: &str, line: u32) -> Option<(String, Vec<String>, Vec<String>)> {
    let idx = line.checked_sub(1)? as usize;
    let start = idx.saturating_sub(CONTEXT_LINES);
    let mut pre = Vec::new();
    let mut current = None;
    let mut post = Vec::new();
    for (i, l) in content
        .lines()
        .enumerate()
        .skip(start)
        .take(idx - start + CONTEXT_LINES + 1)
    {
        if i < idx {
            pre.push(truncate_chars(l));
        } else if i == idx {
            current = Some(truncate_chars(l));
        } else {
            post.push(truncate_chars(l));
        }
    }
    current.map(|c| (c, pre, post))
}

/// Rewrite `frames` (innermost first) using the maps in `maps`, keyed by bundle
/// basename. Returns the number of frames symbolicated.
///
/// Function names: a source map records, for a call expression, the name of the
/// identifier at the call position. A frame's position is the call site of the
/// frame *inside* it, so the callee name for frame `i` is the name token found
/// at frame `i + 1`. This is a heuristic; it only replaces placeholder or very
/// short (likely minified) names, and only when both frames resolved. Metro /
/// Hermes function maps (`x_facebook_sources`) are not consulted.
pub fn symbolicate_frames(
    frames: &mut [StackFrame],
    maps: &HashMap<String, Arc<SourceMap>>,
) -> usize {
    let mut resolved = vec![false; frames.len()];
    let mut call_names: Vec<Option<String>> = vec![None; frames.len()];
    let mut count = 0;

    for (i, frame) in frames.iter_mut().enumerate() {
        if frame.minified.is_some() || frame.lineno == 0 {
            continue;
        }
        let Some(map) = bundle_basename(&frame.filename).and_then(|b| maps.get(&b)) else {
            continue;
        };
        let Some(loc) = map.lookup(frame.lineno, frame.colno.max(1)) else {
            continue;
        };

        frame.minified = Some(MinifiedFrame {
            filename: std::mem::take(&mut frame.filename),
            function: frame.function.clone(),
            lineno: frame.lineno,
            colno: frame.colno,
        });
        frame.filename = clean_source_path(loc.source);
        frame.abs_path = Some(loc.source.to_string());
        frame.lineno = loc.line;
        frame.colno = loc.column;
        frame.in_app = frame.in_app && !is_third_party(&frame.filename);

        match loc.content.and_then(|c| context_window(c, loc.line)) {
            Some((line, pre, post)) => {
                frame.context_line = Some(line);
                frame.pre_context = Some(pre);
                frame.post_context = Some(post);
            }
            None => {
                // Context from the minified bundle would be misleading.
                frame.context_line = None;
                frame.pre_context = None;
                frame.post_context = None;
            }
        }

        call_names[i] = loc.name.map(str::to_string);
        resolved[i] = true;
        count += 1;
    }

    for i in 0..frames.len().saturating_sub(1) {
        if !resolved[i] || !resolved[i + 1] || !is_replaceable_function(&frames[i].function) {
            continue;
        }
        if let Some(name) = call_names[i + 1].take() {
            frames[i].function = name;
        }
    }

    count
}

// ============================================================================
// Cache
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    project_id: String,
    release: String,
    dist: String,
    bundle: String,
}

type Loaded = Option<Arc<SourceMap>>;

struct Entry {
    cell: Arc<OnceCell<Loaded>>,
    created: Instant,
    last_used: u64,
    /// Estimated bytes of the loaded map; 0 until loaded or for negative entries.
    size: usize,
}

#[derive(Default)]
struct Cache {
    entries: HashMap<CacheKey, Entry>,
    tick: u64,
    bytes: usize,
}

impl Cache {
    /// Return the (possibly still-loading) cell for `key`, replacing an
    /// expired entry with a fresh one.
    fn cell_for(&mut self, key: &CacheKey, now: Instant) -> Arc<OnceCell<Loaded>> {
        self.tick += 1;
        let tick = self.tick;

        let expired = self.entries.get(key).is_some_and(|e| {
            e.cell.get().is_some_and(|loaded| {
                let ttl = if loaded.is_some() {
                    POSITIVE_TTL
                } else {
                    NEGATIVE_TTL
                };
                now.duration_since(e.created) > ttl
            })
        });
        if expired {
            self.remove(key);
        }

        if let Some(entry) = self.entries.get_mut(key) {
            entry.last_used = tick;
            return entry.cell.clone();
        }

        let cell = Arc::new(OnceCell::new());
        self.entries.insert(
            key.clone(),
            Entry {
                cell: cell.clone(),
                created: now,
                last_used: tick,
                size: 0,
            },
        );
        self.evict(key);
        cell
    }

    /// Account for a freshly loaded map and enforce the budget.
    fn record_loaded(&mut self, key: &CacheKey, cell: &Arc<OnceCell<Loaded>>, size: usize) {
        let Some(entry) = self.entries.get_mut(key) else {
            return;
        };
        if !Arc::ptr_eq(&entry.cell, cell) || entry.size != 0 {
            return;
        }
        entry.size = size;
        self.bytes += size;
        if size > CACHE_BUDGET_BYTES {
            // Too large to retain; the caller still holds its Arc.
            self.remove(key);
            return;
        }
        self.evict(key);
    }

    fn remove(&mut self, key: &CacheKey) {
        if let Some(entry) = self.entries.remove(key) {
            self.bytes -= entry.size;
        }
    }

    /// Evict least-recently-used entries until under both limits, never `keep`.
    fn evict(&mut self, keep: &CacheKey) {
        while self.bytes > CACHE_BUDGET_BYTES || self.entries.len() > CACHE_MAX_ENTRIES {
            let victim = self
                .entries
                .iter()
                .filter(|(k, _)| *k != keep)
                .min_by_key(|(_, e)| e.last_used)
                .map(|(k, _)| k.clone());
            match victim {
                Some(k) => self.remove(&k),
                None => break,
            }
        }
    }
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(Cache::default()));

fn lock_cache() -> std::sync::MutexGuard<'static, Cache> {
    CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Drop the cached entry for a key (called after upload / delete so this
/// process sees the change immediately; other instances rely on the TTL).
pub fn invalidate(project_id: &str, release: &str, dist: &str, bundle: &str) {
    let key = CacheKey {
        project_id: project_id.to_string(),
        release: release.to_string(),
        dist: dist.to_string(),
        bundle: bundle.to_string(),
    };
    lock_cache().remove(&key);
}

async fn fetch_and_parse(pool: &DbPool, key: &CacheKey) -> anyhow::Result<Loaded> {
    let Some(data) =
        SourceMapRepository::find_data(pool, &key.project_id, &key.release, &key.dist, &key.bundle)
            .await?
    else {
        return Ok(None);
    };
    let parsed = tokio::task::spawn_blocking(move || -> Result<SourceMap, String> {
        let raw = decompress_map(&data)?;
        SourceMap::parse(&raw).map_err(|e| e.to_string())
    })
    .await?;
    match parsed {
        Ok(map) => Ok(Some(Arc::new(map))),
        Err(e) => {
            // A stored map that no longer parses behaves like a missing one.
            tracing::warn!(
                project_id = %key.project_id,
                release = %key.release,
                bundle = %key.bundle,
                "Ignoring unusable stored source map: {e}"
            );
            Ok(None)
        }
    }
}

async fn load_map(pool: &DbPool, key: CacheKey) -> Loaded {
    let cell = lock_cache().cell_for(&key, Instant::now());
    match cell.get_or_try_init(|| fetch_and_parse(pool, &key)).await {
        Ok(loaded) => {
            if let Some(map) = loaded {
                lock_cache().record_loaded(&key, &cell, map.estimated_size());
            }
            loaded.clone()
        }
        Err(e) => {
            tracing::warn!("Source map lookup failed for release {}: {e}", key.release);
            None
        }
    }
}

// ============================================================================
// Event entry point
// ============================================================================

/// Symbolicate the exception stack trace of `event` in place.
///
/// No-op unless the platform is `react-native`/`javascript`, the event has a
/// release, and an uploaded map exists for a bundle named by the frames.
pub async fn symbolicate_event(pool: &DbPool, project_id: &str, event: &mut ErrorEvent) {
    if !SYMBOLICATED_PLATFORMS.contains(&event.platform.as_str()) {
        return;
    }
    let Some(release) = event.release.as_deref().filter(|r| !r.is_empty()) else {
        return;
    };
    let Some(exc) = event.exception.as_mut() else {
        return;
    };
    let dist = event
        .tags
        .as_ref()
        .and_then(|t| t.get("dist"))
        .map(String::as_str)
        .unwrap_or("");

    let bundles: BTreeSet<String> = exc
        .stacktrace
        .iter()
        .filter(|f| f.lineno > 0 && f.minified.is_none())
        .filter_map(|f| bundle_basename(&f.filename))
        .take(MAX_BUNDLES_PER_EVENT)
        .collect();

    let mut maps: HashMap<String, Arc<SourceMap>> = HashMap::new();
    for bundle in bundles {
        let key = CacheKey {
            project_id: project_id.to_string(),
            release: release.to_string(),
            dist: dist.to_string(),
            bundle: bundle.clone(),
        };
        if let Some(map) = load_map(pool, key).await {
            maps.insert(bundle, map);
        }
    }
    if maps.is_empty() {
        return;
    }

    let n = symbolicate_frames(&mut exc.stacktrace, &maps);
    tracing::debug!(
        "Symbolicated {n}/{} frames for event {}",
        exc.stacktrace.len(),
        event.event_id
    );
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(filename: &str, function: &str, lineno: u32, colno: u32) -> StackFrame {
        StackFrame {
            filename: filename.to_string(),
            function: function.to_string(),
            lineno,
            colno,
            abs_path: None,
            context_line: Some("minified garbage".to_string()),
            pre_context: None,
            post_context: None,
            in_app: true,
            minified: None,
        }
    }

    /// Single generated line, tokens at columns 0, 10 and 20:
    /// 0 -> src/a.ts 1:1 "boom", 10 -> src/a.ts 2:1 "inner", 20 -> src/a.ts 3:1 "outer".
    fn sample_map() -> Arc<SourceMap> {
        let map = json!({
            "version": 3,
            "sources": ["webpack:///./src/a.ts"],
            "sourcesContent": ["line one\nline two\nline three\nline four"],
            "names": ["boom", "inner", "outer"],
            "mappings": "AAAAA,UACAC,UACAC",
        });
        Arc::new(SourceMap::parse(map.to_string().as_bytes()).unwrap())
    }

    fn maps(bundle: &str) -> HashMap<String, Arc<SourceMap>> {
        HashMap::from([(bundle.to_string(), sample_map())])
    }

    #[test]
    fn bundle_basename_strips_scheme_path_and_query() {
        assert_eq!(
            bundle_basename("app:///index.android.bundle").as_deref(),
            Some("index.android.bundle")
        );
        assert_eq!(
            bundle_basename("app:///main.jsbundle").as_deref(),
            Some("main.jsbundle")
        );
        assert_eq!(
            bundle_basename("http://10.0.2.2:8081/index.bundle?platform=android&dev=true")
                .as_deref(),
            Some("index.bundle")
        );
        assert_eq!(
            bundle_basename("C:\\dist\\app.js#frag").as_deref(),
            Some("app.js")
        );
        assert_eq!(bundle_basename("main.js").as_deref(), Some("main.js"));
        assert_eq!(bundle_basename("app:///"), None);
        assert_eq!(bundle_basename(""), None);
    }

    #[test]
    fn clean_source_path_normalises_bundler_prefixes() {
        assert_eq!(clean_source_path("webpack:///./src/a.ts"), "src/a.ts");
        assert_eq!(clean_source_path("webpack://my-app/./src/a.ts"), "src/a.ts");
        assert_eq!(
            clean_source_path("file:///Users/me/app/src/a.ts"),
            "/Users/me/app/src/a.ts"
        );
        assert_eq!(clean_source_path("./src/a.ts"), "src/a.ts");
        assert_eq!(
            clean_source_path("/Users/me/app/node_modules/react-native/index.js"),
            "node_modules/react-native/index.js"
        );
        assert_eq!(clean_source_path("src/a.ts"), "src/a.ts");
    }

    #[test]
    fn compress_round_trips_and_enforces_limit() {
        let data = br#"{"version":3,"sources":[],"mappings":""}"#;
        let packed = compress_map(data);
        assert_eq!(decompress_map(&packed).unwrap(), data);
        assert!(decompress_map(b"definitely not zlib").is_err());
    }

    #[test]
    fn rewrites_matching_frames_and_keeps_original() {
        let mut frames = vec![frame("app:///index.android.bundle", "t", 1, 11)];
        let n = symbolicate_frames(&mut frames, &maps("index.android.bundle"));
        assert_eq!(n, 1);

        let f = &frames[0];
        assert_eq!(f.filename, "src/a.ts");
        assert_eq!(f.abs_path.as_deref(), Some("webpack:///./src/a.ts"));
        assert_eq!((f.lineno, f.colno), (2, 1));
        assert_eq!(f.context_line.as_deref(), Some("line two"));
        assert_eq!(
            f.pre_context.as_deref(),
            Some(&["line one".to_string()][..])
        );
        assert_eq!(f.post_context.as_ref().unwrap().len(), 2);
        assert!(f.in_app);
        assert_eq!(
            f.minified,
            Some(MinifiedFrame {
                filename: "app:///index.android.bundle".to_string(),
                function: "t".to_string(),
                lineno: 1,
                colno: 11,
            })
        );
    }

    #[test]
    fn frames_without_a_map_or_position_are_untouched() {
        let mut frames = vec![
            frame("app:///other.bundle", "x", 1, 1),
            frame("app:///index.android.bundle", "y", 0, 0),
            frame("node:internal/process", "z", 10, 5),
        ];
        let before: Vec<_> = frames
            .iter()
            .map(|f| (f.filename.clone(), f.function.clone(), f.lineno))
            .collect();
        assert_eq!(
            symbolicate_frames(&mut frames, &maps("index.android.bundle")),
            0
        );
        let after: Vec<_> = frames
            .iter()
            .map(|f| (f.filename.clone(), f.function.clone(), f.lineno))
            .collect();
        assert_eq!(before, after);
        assert!(frames.iter().all(|f| f.minified.is_none()));
        assert_eq!(frames[0].context_line.as_deref(), Some("minified garbage"));
    }

    #[test]
    fn symbolication_is_idempotent() {
        let mut frames = vec![frame("app:///index.android.bundle", "t", 1, 11)];
        let m = maps("index.android.bundle");
        assert_eq!(symbolicate_frames(&mut frames, &m), 1);
        let once = frames[0].clone();
        assert_eq!(symbolicate_frames(&mut frames, &m), 0);
        assert_eq!(frames[0].filename, once.filename);
        assert_eq!(frames[0].minified, once.minified);
    }

    #[test]
    fn unmapped_position_leaves_frame_unchanged() {
        let empty = Arc::new(
            SourceMap::parse(br#"{"version":3,"sources":[],"names":[],"mappings":""}"#).unwrap(),
        );
        let maps = HashMap::from([("b.js".to_string(), empty)]);
        let mut frames = vec![frame("app:///b.js", "f", 4, 4)];
        assert_eq!(symbolicate_frames(&mut frames, &maps), 0);
        assert_eq!(frames[0].filename, "app:///b.js");
        assert!(frames[0].minified.is_none());
    }

    #[test]
    fn function_names_come_from_the_callers_call_site() {
        let mut frames = vec![
            frame("app:///b.js", "t", 1, 1),
            frame("app:///b.js", "", 1, 11),
            frame("app:///b.js", "n", 1, 21),
            frame("app:///other.js", "", 1, 1),
        ];
        assert_eq!(symbolicate_frames(&mut frames, &maps("b.js")), 3);
        assert_eq!(frames[0].function, "inner");
        assert_eq!(frames[1].function, "outer");
        // Outermost resolved frame has no resolved caller: keep its name.
        assert_eq!(frames[2].function, "n");
        assert_eq!(frames[0].minified.as_ref().unwrap().function, "t");
    }

    #[test]
    fn meaningful_function_names_are_not_overwritten() {
        let mut frames = vec![
            frame("app:///b.js", "handlePress", 1, 1),
            frame("app:///b.js", "render", 1, 11),
        ];
        symbolicate_frames(&mut frames, &maps("b.js"));
        assert_eq!(frames[0].function, "handlePress");
    }

    #[test]
    fn node_modules_sources_are_not_in_app() {
        let map = json!({
            "version": 3,
            "sources": ["/proj/node_modules/lib/index.js"],
            "names": [],
            "mappings": "AAAA",
        });
        let map = Arc::new(SourceMap::parse(map.to_string().as_bytes()).unwrap());
        let maps = HashMap::from([("b.js".to_string(), map)]);
        let mut frames = vec![frame("app:///b.js", "f", 1, 1)];
        symbolicate_frames(&mut frames, &maps);
        assert_eq!(frames[0].filename, "node_modules/lib/index.js");
        assert!(!frames[0].in_app);
        assert!(
            frames[0].context_line.is_none(),
            "no sourcesContent -> no context"
        );
    }

    #[test]
    fn context_window_clamps_at_file_edges() {
        let (line, pre, post) = context_window("a\nb\nc", 1).unwrap();
        assert_eq!((line.as_str(), pre.len(), post.len()), ("a", 0, 2));
        let (line, pre, post) = context_window("a\nb\nc", 3).unwrap();
        assert_eq!((line.as_str(), pre.len(), post.len()), ("c", 2, 0));
        assert!(context_window("a\nb", 9).is_none());
        assert!(context_window("a", 0).is_none());
    }

    #[test]
    fn context_lines_are_truncated() {
        let long = "x".repeat(5000);
        let (line, _, _) = context_window(&long, 1).unwrap();
        assert_eq!(line.chars().count(), MAX_CONTEXT_LINE_CHARS);
    }

    fn key(bundle: &str) -> CacheKey {
        CacheKey {
            project_id: "p".into(),
            release: "1".into(),
            dist: String::new(),
            bundle: bundle.into(),
        }
    }

    #[test]
    fn cache_reuses_cell_until_ttl_expires() {
        let mut cache = Cache::default();
        let t0 = Instant::now();
        let a = cache.cell_for(&key("a"), t0);
        assert!(Arc::ptr_eq(&a, &cache.cell_for(&key("a"), t0)));

        // Negative result expires after NEGATIVE_TTL, positive after POSITIVE_TTL.
        a.set(None).unwrap();
        let soon = t0 + NEGATIVE_TTL / 2;
        assert!(Arc::ptr_eq(&a, &cache.cell_for(&key("a"), soon)));
        let later = t0 + NEGATIVE_TTL + Duration::from_secs(1);
        assert!(!Arc::ptr_eq(&a, &cache.cell_for(&key("a"), later)));

        let b = cache.cell_for(&key("b"), t0);
        b.set(Some(sample_map())).unwrap();
        let after_neg = t0 + NEGATIVE_TTL + Duration::from_secs(1);
        assert!(Arc::ptr_eq(&b, &cache.cell_for(&key("b"), after_neg)));
        let after_pos = t0 + POSITIVE_TTL + Duration::from_secs(1);
        assert!(!Arc::ptr_eq(&b, &cache.cell_for(&key("b"), after_pos)));
    }

    #[test]
    fn cache_evicts_least_recently_used_over_budget() {
        let mut cache = Cache::default();
        let now = Instant::now();
        let third = CACHE_BUDGET_BYTES / 3 + 1;
        let mut cells = Vec::new();
        for name in ["a", "b", "c"] {
            let cell = cache.cell_for(&key(name), now);
            cache.record_loaded(&key(name), &cell, third);
            cells.push(cell);
        }
        // Touch "a" so "b" is now the least recently used, then overflow.
        cache.cell_for(&key("a"), now);
        let d = cache.cell_for(&key("d"), now);
        cache.record_loaded(&key("d"), &d, third);

        assert!(cache.entries.contains_key(&key("a")));
        assert!(!cache.entries.contains_key(&key("b")));
        assert!(cache.entries.contains_key(&key("d")));
        assert!(cache.bytes <= CACHE_BUDGET_BYTES);
    }

    #[test]
    fn oversize_entry_is_not_retained() {
        let mut cache = Cache::default();
        let cell = cache.cell_for(&key("huge"), Instant::now());
        cache.record_loaded(&key("huge"), &cell, CACHE_BUDGET_BYTES + 1);
        assert!(cache.entries.is_empty());
        assert_eq!(cache.bytes, 0);
    }

    #[test]
    fn entry_count_is_bounded() {
        let mut cache = Cache::default();
        let now = Instant::now();
        for i in 0..CACHE_MAX_ENTRIES + 50 {
            cache.cell_for(&key(&format!("bogus-{i}")), now);
        }
        assert_eq!(cache.entries.len(), CACHE_MAX_ENTRIES);
    }

    fn event(platform: &str, release: Option<&str>, dist: Option<&str>) -> ErrorEvent {
        let mut value = json!({
            "event_id": "e1",
            "timestamp": "2026-01-01T00:00:00Z",
            "level": "error",
            "platform": platform,
            "exception": {
                "type": "Error",
                "value": "boom",
                "stacktrace": [{
                    "filename": "app:///index.android.bundle",
                    "function": "t",
                    "lineno": 1,
                    "colno": 11,
                    "in_app": true
                }]
            }
        });
        if let Some(r) = release {
            value["release"] = json!(r);
        }
        if let Some(d) = dist {
            value["tags"] = json!({ "dist": d });
        }
        serde_json::from_value(value).unwrap()
    }

    #[tokio::test]
    async fn symbolicate_event_uses_release_dist_and_bundle_key() {
        use crate::db::repositories::ProjectRepository;
        let pool = crate::db::test_helpers::test_any_pool().await;
        let project = ProjectRepository::create(&pool, "RN", "sym-event", "owner-sym", None, None, None)
            .await
            .unwrap();

        let raw = json!({
            "version": 3,
            "sources": ["src/App.tsx"],
            "names": [],
            "mappings": "AAAA,UACA",
        })
        .to_string();
        let packed = compress_map(raw.as_bytes());
        SourceMapRepository::upsert(
            &pool,
            &project.id,
            "1.2.0",
            "42",
            "index.android.bundle",
            &packed,
            raw.len() as i64,
        )
        .await
        .unwrap();

        // Matching key -> symbolicated.
        let mut ev = event("react-native", Some("1.2.0"), Some("42"));
        symbolicate_event(&pool, &project.id, &mut ev).await;
        let f = &ev.exception.as_ref().unwrap().stacktrace[0];
        assert_eq!(f.filename, "src/App.tsx");
        assert_eq!(f.lineno, 2);
        assert_eq!(
            f.minified.as_ref().unwrap().filename,
            "app:///index.android.bundle"
        );

        // Wrong dist, wrong release, missing release, other platform: unchanged.
        for mut ev in [
            event("react-native", Some("1.2.0"), None),
            event("react-native", Some("9.9.9"), Some("42")),
            event("react-native", None, Some("42")),
            event("python", Some("1.2.0"), Some("42")),
        ] {
            symbolicate_event(&pool, &project.id, &mut ev).await;
            let f = &ev.exception.as_ref().unwrap().stacktrace[0];
            assert_eq!(f.filename, "app:///index.android.bundle");
            assert!(f.minified.is_none());
        }

        // Another project never sees this project's map.
        let other = ProjectRepository::create(&pool, "RN2", "sym-event-2", "owner-sym", None, None, None)
            .await
            .unwrap();
        let mut ev = event("react-native", Some("1.2.0"), Some("42"));
        symbolicate_event(&pool, &other.id, &mut ev).await;
        assert!(ev.exception.as_ref().unwrap().stacktrace[0]
            .minified
            .is_none());

        // Deleting and invalidating makes the next event unsymbolicated again.
        let meta = SourceMapRepository::list(&pool, &project.id, Some("1.2.0"))
            .await
            .unwrap()
            .remove(0);
        SourceMapRepository::delete(&pool, &meta.id, &project.id)
            .await
            .unwrap();
        invalidate(&project.id, "1.2.0", "42", "index.android.bundle");
        let mut ev = event("react-native", Some("1.2.0"), Some("42"));
        symbolicate_event(&pool, &project.id, &mut ev).await;
        assert!(ev.exception.as_ref().unwrap().stacktrace[0]
            .minified
            .is_none());
    }
}
