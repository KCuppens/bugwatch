use axum::{
    extract::{multipart::Field, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;

use super::{enforce_rate_limit, ApiResponse};
use crate::{
    api::events::extract_api_key,
    db::{
        models::{Project, SourceMapMeta},
        repositories::{ProjectRepository, SourceMapRepository},
    },
    processing::{
        sourcemap::SourceMap,
        symbolicate::{bundle_basename, compress_map, invalidate, MAX_SOURCE_MAP_BYTES},
    },
    AppError, AppResult, AppState,
};

/// Body limit for the upload route: the map itself plus room for form fields
/// and multipart framing. Overrides the global 2 MiB limit for this route only.
pub const MAX_UPLOAD_BODY_BYTES: usize = MAX_SOURCE_MAP_BYTES + 1024 * 1024;

const MAX_RELEASE_LEN: usize = 200;
const MAX_DIST_LEN: usize = 256;
const MAX_BUNDLE_LEN: usize = 256;
const MAX_TEXT_FIELD_BYTES: usize = 4096;
const RATE_LIMIT_PER_MINUTE: u32 = 60;

/// Authenticate a request by project API key (same mechanism as event ingest)
/// and apply a per-project rate limit.
async fn authenticate(state: &AppState, headers: &HeaderMap) -> AppResult<Project> {
    let api_key = extract_api_key(headers)?;
    let project = ProjectRepository::find_by_api_key(&state.db, &api_key)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid API key".to_string()))?;
    enforce_rate_limit(
        state,
        &format!("sourcemaps:{}", project.id),
        RATE_LIMIT_PER_MINUTE,
    )?;
    Ok(project)
}

fn multipart_error(e: axum::extract::multipart::MultipartError) -> AppError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::BadRequest(too_large_message())
    } else {
        AppError::BadRequest(format!("Invalid multipart body: {e}"))
    }
}

fn too_large_message() -> String {
    format!(
        "Source map exceeds the {} MiB limit",
        MAX_SOURCE_MAP_BYTES / (1024 * 1024)
    )
}

/// Read a multipart field into memory, failing once it exceeds `max` bytes.
async fn read_limited(mut field: Field<'_>, max: usize) -> AppResult<Vec<u8>> {
    let mut buf = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
        if buf.len() + chunk.len() > max {
            return Err(AppError::BadRequest(too_large_message()));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

async fn read_text(field: Field<'_>, name: &str) -> AppResult<String> {
    let bytes = read_limited(field, MAX_TEXT_FIELD_BYTES)
        .await
        .map_err(|e| match e {
            AppError::BadRequest(_) => AppError::Validation(format!("Field '{name}' is too long")),
            other => other,
        })?;
    String::from_utf8(bytes)
        .map_err(|_| AppError::Validation(format!("Field '{name}' must be valid UTF-8")))
}

/// POST /api/v1/sourcemaps
///
/// multipart/form-data with `release`, optional `dist`, `bundle` (bundle
/// basename, e.g. `index.android.bundle`) and the `sourcemap` file part.
/// Idempotent upsert on (project, release, dist, bundle).
pub async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> AppResult<Json<ApiResponse<SourceMapMeta>>> {
    let project = authenticate(&state, &headers).await?;

    let mut release: Option<String> = None;
    let mut dist: Option<String> = None;
    let mut bundle: Option<String> = None;
    let mut file: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(multipart_error)? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "release" => release = Some(read_text(field, "release").await?),
            "dist" => dist = Some(read_text(field, "dist").await?),
            "bundle" => bundle = Some(read_text(field, "bundle").await?),
            "sourcemap" => file = Some(read_limited(field, MAX_SOURCE_MAP_BYTES).await?),
            _ => {}
        }
    }

    let release = release
        .filter(|r| !r.trim().is_empty())
        .ok_or_else(|| AppError::Validation("Field 'release' is required".to_string()))?;
    if release.len() > MAX_RELEASE_LEN {
        return Err(AppError::Validation(format!(
            "Field 'release' too long (max {MAX_RELEASE_LEN})"
        )));
    }

    let dist = dist.unwrap_or_default();
    if dist.len() > MAX_DIST_LEN {
        return Err(AppError::Validation(format!(
            "Field 'dist' too long (max {MAX_DIST_LEN})"
        )));
    }

    let bundle = bundle
        .and_then(|b| bundle_basename(&b))
        .ok_or_else(|| AppError::Validation("Field 'bundle' is required".to_string()))?;
    if bundle.len() > MAX_BUNDLE_LEN {
        return Err(AppError::Validation(format!(
            "Field 'bundle' too long (max {MAX_BUNDLE_LEN})"
        )));
    }

    let file = file
        .filter(|f| !f.is_empty())
        .ok_or_else(|| AppError::Validation("File part 'sourcemap' is required".to_string()))?;

    // Validate and compress off the async threads: both are CPU-bound on up to 50 MiB.
    let (compressed, size) = tokio::task::spawn_blocking(move || {
        SourceMap::parse(&file).map_err(|e| e.to_string())?;
        Ok::<_, String>((compress_map(&file), file.len()))
    })
    .await
    .map_err(|e| AppError::Internal(format!("Source map task failed: {e}")))?
    .map_err(|e| AppError::Validation(format!("Invalid source map: {e}")))?;

    let meta = SourceMapRepository::upsert(
        &state.db,
        &project.id,
        &release,
        &dist,
        &bundle,
        &compressed,
        size as i64,
    )
    .await?;
    invalidate(&project.id, &release, &dist, &bundle);

    tracing::info!(
        project_id = %project.id,
        release = %release,
        dist = %dist,
        bundle = %bundle,
        size,
        compressed_size = compressed.len(),
        "Source map uploaded"
    );

    Ok(Json(ApiResponse { data: meta }))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub release: Option<String>,
}

/// GET /api/v1/sourcemaps?release=
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<ApiResponse<Vec<SourceMapMeta>>>> {
    let project = authenticate(&state, &headers).await?;
    let release = query.release.as_deref().filter(|r| !r.is_empty());
    let maps = SourceMapRepository::list(&state.db, &project.id, release).await?;
    Ok(Json(ApiResponse { data: maps }))
}

/// DELETE /api/v1/sourcemaps/{id}
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let project = authenticate(&state, &headers).await?;
    let removed = SourceMapRepository::delete(&state.db, &id, &project.id)
        .await?
        .ok_or_else(|| AppError::NotFound("Source map not found".to_string()))?;
    invalidate(
        &project.id,
        &removed.release,
        &removed.dist,
        &removed.bundle,
    );
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use serde_json::{json, Value};
    use tower::ServiceExt;

    const BOUNDARY: &str = "----bugwatch-test-boundary";

    struct Harness {
        app: axum::Router,
        state: AppState,
    }

    async fn harness() -> Harness {
        let state = crate::db::test_helpers::test_app_state().await;
        let app = axum::Router::new()
            .nest("/api/v1", crate::api::router())
            // Same global limit as main.rs: the route-level layer must override it.
            .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024))
            .with_state(state.clone());
        Harness { app, state }
    }

    fn peer() -> std::net::SocketAddr {
        "127.0.0.1:1234".parse().unwrap()
    }

    async fn json_body(resp: axum::response::Response) -> Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    }

    /// Sign up and create a project; returns (project_id, api_key).
    async fn new_project(app: &axum::Router, email: &str) -> (String, String) {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/signup")
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(peer()))
            .body(Body::from(format!(
                r#"{{"email":"{email}","password":"StrongPass1!"}}"#
            )))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let mut token = String::new();
        for v in resp.headers().get_all("set-cookie") {
            if let Some(rest) = v.to_str().unwrap_or("").strip_prefix("access_token=") {
                token = rest.split(';').next().unwrap_or("").to_string();
            }
        }
        assert!(!token.is_empty(), "no access_token in signup response");

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(r#"{"name":"Source Maps Test"}"#))
            .unwrap();
        let json = json_body(app.clone().oneshot(req).await.unwrap()).await;
        (
            json["data"]["id"].as_str().unwrap().to_string(),
            json["data"]["api_key"].as_str().unwrap().to_string(),
        )
    }

    fn multipart_body(fields: &[(&str, &str)], file: Option<&[u8]>) -> Vec<u8> {
        let mut body = Vec::new();
        for (name, value) in fields {
            body.extend_from_slice(
                format!(
                    "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
                )
                .as_bytes(),
            );
        }
        if let Some(file) = file {
            body.extend_from_slice(
                format!(
                    "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"sourcemap\"; filename=\"x.map\"\r\nContent-Type: application/json\r\n\r\n"
                )
                .as_bytes(),
            );
            body.extend_from_slice(file);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
        body
    }

    async fn post_map(
        app: &axum::Router,
        api_key: Option<&str>,
        fields: &[(&str, &str)],
        file: Option<&[u8]>,
    ) -> axum::response::Response {
        let mut req = Request::builder()
            .method("POST")
            .uri("/api/v1/sourcemaps")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            );
        if let Some(key) = api_key {
            req = req.header("x-api-key", key);
        }
        app.clone()
            .oneshot(req.body(Body::from(multipart_body(fields, file))).unwrap())
            .await
            .unwrap()
    }

    async fn get_with_key(app: &axum::Router, uri: &str, key: &str) -> axum::response::Response {
        let req = Request::builder()
            .uri(uri)
            .header("authorization", format!("Bearer {key}"))
            .body(Body::empty())
            .unwrap();
        app.clone().oneshot(req).await.unwrap()
    }

    async fn delete_with_key(app: &axum::Router, id: &str, key: &str) -> StatusCode {
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/sourcemaps/{id}"))
            .header("x-api-key", key)
            .body(Body::empty())
            .unwrap();
        app.clone().oneshot(req).await.unwrap().status()
    }

    fn sample_map() -> Vec<u8> {
        json!({
            "version": 3,
            "sources": ["webpack:///./src/App.tsx"],
            "sourcesContent": ["const a = 1;\nthrow new Error('boom');\n"],
            "names": [],
            "mappings": "AAAA,UACA",
        })
        .to_string()
        .into_bytes()
    }

    #[tokio::test]
    async fn requires_a_valid_api_key() {
        let h = harness().await;
        let resp = post_map(
            &h.app,
            None,
            &[("release", "1"), ("bundle", "b.js")],
            Some(&sample_map()),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        let resp = post_map(
            &h.app,
            Some("nope"),
            &[("release", "1"), ("bundle", "b.js")],
            Some(&sample_map()),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        assert_eq!(
            get_with_key(&h.app, "/api/v1/sourcemaps", "nope")
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            delete_with_key(&h.app, "some-id", "nope").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn upload_list_replace_and_delete() {
        let h = harness().await;
        let (project_id, key) = new_project(&h.app, "sm_crud@example.com").await;
        let map = sample_map();

        let resp = post_map(
            &h.app,
            Some(&key),
            &[
                ("release", "1.0.0"),
                ("dist", "3"),
                ("bundle", "app:///index.android.bundle"),
            ],
            Some(&map),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = json_body(resp).await;
        let id = body["data"]["id"].as_str().unwrap().to_string();
        assert_eq!(body["data"]["project_id"], project_id);
        assert_eq!(body["data"]["release"], "1.0.0");
        assert_eq!(body["data"]["dist"], "3");
        assert_eq!(
            body["data"]["bundle"], "index.android.bundle",
            "bundle is normalised to its basename"
        );
        assert_eq!(body["data"]["size"], map.len());
        assert!(body["data"]["compressed_size"].as_i64().unwrap() > 0);
        assert!(
            body["data"].get("data").is_none(),
            "payload must not be returned"
        );

        // Same key again replaces rather than duplicates.
        let resp = post_map(
            &h.app,
            Some(&key),
            &[
                ("release", "1.0.0"),
                ("dist", "3"),
                ("bundle", "index.android.bundle"),
            ],
            Some(&map),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(json_body(resp).await["data"]["id"], id.as_str());

        // Different release and no dist.
        let resp = post_map(
            &h.app,
            Some(&key),
            &[("release", "2.0.0"), ("bundle", "main.jsbundle")],
            Some(&map),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(json_body(resp).await["data"]["dist"], "");

        let all = json_body(get_with_key(&h.app, "/api/v1/sourcemaps", &key).await).await;
        assert_eq!(all["data"].as_array().unwrap().len(), 2);
        let one =
            json_body(get_with_key(&h.app, "/api/v1/sourcemaps?release=2.0.0", &key).await).await;
        assert_eq!(one["data"].as_array().unwrap().len(), 1);
        assert_eq!(one["data"][0]["bundle"], "main.jsbundle");

        assert_eq!(
            delete_with_key(&h.app, &id, &key).await,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            delete_with_key(&h.app, &id, &key).await,
            StatusCode::NOT_FOUND
        );
        let all = json_body(get_with_key(&h.app, "/api/v1/sourcemaps", &key).await).await;
        assert_eq!(all["data"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn other_projects_cannot_see_or_delete_maps() {
        let h = harness().await;
        let (_, key_a) = new_project(&h.app, "sm_iso_a@example.com").await;
        let (_, key_b) = new_project(&h.app, "sm_iso_b@example.com").await;

        let resp = post_map(
            &h.app,
            Some(&key_a),
            &[("release", "1"), ("bundle", "b.js")],
            Some(&sample_map()),
        )
        .await;
        let id = json_body(resp).await["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let listed = json_body(get_with_key(&h.app, "/api/v1/sourcemaps", &key_b).await).await;
        assert!(listed["data"].as_array().unwrap().is_empty());
        assert_eq!(
            delete_with_key(&h.app, &id, &key_b).await,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            delete_with_key(&h.app, &id, &key_a).await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn rejects_invalid_uploads() {
        let h = harness().await;
        let (_, key) = new_project(&h.app, "sm_invalid@example.com").await;
        let map = sample_map();

        let cases: Vec<(Vec<(&str, &str)>, Option<&[u8]>)> = vec![
            (vec![("bundle", "b.js")], Some(&map)), // no release
            (vec![("release", "1")], Some(&map)),   // no bundle
            (vec![("release", "1"), ("bundle", "app:///")], Some(&map)), // empty basename
            (vec![("release", "1"), ("bundle", "b.js")], None), // no file
            (
                vec![("release", "1"), ("bundle", "b.js")],
                Some(b"not json"),
            ), // invalid map
            (
                vec![("release", "1"), ("bundle", "b.js")],
                Some(br#"{"version":2}"#),
            ), // wrong version
        ];
        for (i, (fields, file)) in cases.iter().enumerate() {
            let resp = post_map(&h.app, Some(&key), fields, *file).await;
            assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY, "case {i}");
        }

        let long_release = "r".repeat(MAX_RELEASE_LEN + 1);
        let resp = post_map(
            &h.app,
            Some(&key),
            &[("release", &long_release), ("bundle", "b.js")],
            Some(&map),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let listed = json_body(get_with_key(&h.app, "/api/v1/sourcemaps", &key).await).await;
        assert!(listed["data"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn file_part_may_precede_text_fields_and_exceed_the_global_body_limit() {
        let h = harness().await;
        let (_, key) = new_project(&h.app, "sm_large@example.com").await;

        // ~3 MiB map: above the global 2 MiB body limit, below the route's.
        let big = json!({
            "version": 3,
            "sources": ["src/big.ts"],
            "sourcesContent": ["x".repeat(3 * 1024 * 1024)],
            "names": [],
            "mappings": "AAAA",
        })
        .to_string()
        .into_bytes();

        // Build a body with the file part first.
        let mut body = Vec::new();
        body.extend_from_slice(
            format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"sourcemap\"; filename=\"big.map\"\r\n\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(&big);
        body.extend_from_slice(
            format!(
                "\r\n--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"release\"\r\n\r\n9\r\n--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"bundle\"\r\n\r\nbig.js\r\n--{BOUNDARY}--\r\n"
            )
            .as_bytes(),
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/sourcemaps")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .header("x-api-key", &key)
            .body(Body::from(body))
            .unwrap();
        let resp = h.app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let data = json_body(resp).await;
        assert_eq!(data["data"]["size"], big.len());
        assert!(
            data["data"]["compressed_size"].as_i64().unwrap() < 100 * 1024,
            "repetitive content must compress well"
        );
    }

    #[tokio::test]
    async fn ingest_symbolicates_with_uploaded_map_before_fingerprinting() {
        use crate::api::events::ErrorEvent;
        use crate::processing::fingerprint::generate_fingerprint;

        let h = harness().await;
        let (project_id, key) = new_project(&h.app, "sm_ingest@example.com").await;

        let resp = post_map(
            &h.app,
            Some(&key),
            &[
                ("release", "1.4.0"),
                ("dist", "12"),
                ("bundle", "index.android.bundle"),
            ],
            Some(&sample_map()),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let event = json!({
            "event_id": "evt-rn-sym-1",
            "timestamp": "2026-01-01T00:00:00Z",
            "level": "error",
            "platform": "react-native",
            "release": "1.4.0",
            "tags": { "dist": "12" },
            "exception": {
                "type": "Error",
                "value": "boom",
                "stacktrace": [{
                    "filename": "app:///index.android.bundle",
                    "function": "onPress",
                    "lineno": 1,
                    "colno": 11,
                    "in_app": true
                }]
            }
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &key)
            .body(Body::from(event.to_string()))
            .unwrap();
        let resp = h.app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);

        let payload: String =
            sqlx::query_scalar("SELECT payload FROM events WHERE event_id = 'evt-rn-sym-1'")
                .fetch_one(&h.state.db)
                .await
                .unwrap();
        let stored: ErrorEvent = serde_json::from_str(&payload).unwrap();
        let exc = stored.exception.unwrap();
        let frame = &exc.stacktrace[0];
        assert_eq!(frame.filename, "src/App.tsx");
        assert_eq!((frame.lineno, frame.colno), (2, 1));
        assert_eq!(
            frame.context_line.as_deref(),
            Some("throw new Error('boom');")
        );
        let minified = frame.minified.as_ref().expect("original frame preserved");
        assert_eq!(minified.filename, "app:///index.android.bundle");
        assert_eq!((minified.lineno, minified.colno), (1, 11));

        let fingerprint: String =
            sqlx::query_scalar("SELECT fingerprint FROM issues WHERE project_id = $1")
                .bind(&project_id)
                .fetch_one(&h.state.db)
                .await
                .unwrap();
        assert_eq!(
            fingerprint,
            generate_fingerprint(&exc),
            "fingerprint uses symbolicated frames"
        );
    }

    #[tokio::test]
    async fn ingest_without_a_matching_map_keeps_frames() {
        use crate::api::events::ErrorEvent;

        let h = harness().await;
        let (_, key) = new_project(&h.app, "sm_nomap@example.com").await;

        let event = json!({
            "event_id": "evt-rn-nomap-1",
            "timestamp": "2026-01-01T00:00:00Z",
            "level": "error",
            "platform": "react-native",
            "release": "0.0.1",
            "exception": {
                "type": "Error",
                "value": "boom",
                "stacktrace": [{
                    "filename": "app:///index.android.bundle",
                    "function": "f",
                    "lineno": 1,
                    "colno": 11,
                    "in_app": true
                }]
            }
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/events")
            .header("content-type", "application/json")
            .header("x-api-key", &key)
            .body(Body::from(event.to_string()))
            .unwrap();
        assert_eq!(
            h.app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::ACCEPTED
        );

        let payload: String =
            sqlx::query_scalar("SELECT payload FROM events WHERE event_id = 'evt-rn-nomap-1'")
                .fetch_one(&h.state.db)
                .await
                .unwrap();
        let stored: ErrorEvent = serde_json::from_str(&payload).unwrap();
        let frame = &stored.exception.unwrap().stacktrace[0];
        assert_eq!(frame.filename, "app:///index.android.bundle");
        assert_eq!((frame.lineno, frame.colno), (1, 11));
        assert!(frame.minified.is_none());
    }
}
