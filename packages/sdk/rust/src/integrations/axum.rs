//! Axum integration for Bugwatch.
//!
//! This module provides a Tower layer and utilities for automatically capturing
//! errors and request context in Axum applications.
//!
//! ## Usage with Environment Variables (Recommended)
//!
//! ```ignore
//! use axum::{Router, routing::get};
//! use bugwatch::integrations::axum::BugwatchLayer;
//!
//! // Set BUGWATCH_API_KEY=bw_live_xxxxx in your environment
//!
//! #[tokio::main]
//! async fn main() {
//!     let app = Router::new()
//!         .route("/", get(|| async { "Hello, World!" }))
//!         // Auto-initializes from BUGWATCH_API_KEY env var
//!         .layer(BugwatchLayer::from_env().expect("BUGWATCH_API_KEY not set"));
//!
//!     let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
//!     axum::serve(listener, app).await.unwrap();
//! }
//! ```
//!
//! ## Manual Initialization
//!
//! ```ignore
//! use axum::{Router, routing::get};
//! use bugwatch::{init, BugwatchOptions};
//! use bugwatch::integrations::axum::BugwatchLayer;
//!
//! #[tokio::main]
//! async fn main() {
//!     // Initialize Bugwatch manually
//!     init(BugwatchOptions::new("your-api-key"));
//!
//!     let app = Router::new()
//!         .route("/", get(|| async { "Hello, World!" }))
//!         .layer(BugwatchLayer::new());
//!
//!     let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
//!     axum::serve(listener, app).await.unwrap();
//! }
//! ```

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use axum::extract::{FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use http::header::HeaderMap;
use pin_project_lite::pin_project;
use tower::{Layer, Service};

use crate::env::{get_env_options, EnvError};
use crate::types::{Breadcrumb, Level, RequestContext};
use crate::{add_breadcrumb, get_client, init};

use super::common::{build_url, extract_client_ip, filter_headers};

/// Tower layer for Bugwatch integration with Axum.
///
/// This layer automatically:
/// - Captures request context for errors
/// - Adds HTTP request breadcrumbs
/// - Reports server errors (5xx) to Bugwatch
#[derive(Clone, Default)]
pub struct BugwatchLayer {
    /// Whether to capture 5xx errors automatically
    capture_server_errors: bool,
    /// Whether to add request breadcrumbs
    add_breadcrumbs: bool,
}

impl BugwatchLayer {
    /// Create a new Bugwatch layer with default settings.
    ///
    /// Note: This assumes the SDK has already been initialized with `init()`.
    /// For automatic initialization from environment variables, use `from_env()`.
    pub fn new() -> Self {
        Self {
            capture_server_errors: true,
            add_breadcrumbs: true,
        }
    }

    /// Create a new Bugwatch layer, initializing from environment variables.
    ///
    /// This is the recommended way to create the layer. It will:
    /// 1. Initialize the Bugwatch SDK from `BUGWATCH_API_KEY` and other env vars
    /// 2. Create the layer with default settings
    ///
    /// # Errors
    ///
    /// Returns `EnvError::MissingApiKey` if `BUGWATCH_API_KEY` is not set.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use axum::Router;
    /// use bugwatch::integrations::axum::BugwatchLayer;
    ///
    /// // Requires BUGWATCH_API_KEY environment variable
    /// Router::new()
    ///     .layer(BugwatchLayer::from_env()?)
    /// ```
    pub fn from_env() -> Result<Self, EnvError> {
        // Initialize SDK if not already initialized
        if get_client().is_none() {
            let options = get_env_options()?;
            init(options);
        }
        Ok(Self::new())
    }

    /// Configure whether to automatically capture 5xx server errors.
    pub fn capture_server_errors(mut self, capture: bool) -> Self {
        self.capture_server_errors = capture;
        self
    }

    /// Configure whether to add HTTP request breadcrumbs.
    pub fn add_breadcrumbs(mut self, add: bool) -> Self {
        self.add_breadcrumbs = add;
        self
    }
}

impl<S> Layer<S> for BugwatchLayer {
    type Service = BugwatchService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        BugwatchService {
            inner,
            capture_server_errors: self.capture_server_errors,
            add_breadcrumbs: self.add_breadcrumbs,
        }
    }
}

/// The Bugwatch Tower service.
#[derive(Clone)]
pub struct BugwatchService<S> {
    inner: S,
    capture_server_errors: bool,
    add_breadcrumbs: bool,
}

impl<S> Service<Request> for BugwatchService<S>
where
    S: Service<Request, Response = Response> + Clone + Send + 'static,
    S::Future: Send,
{
    type Response = Response;
    type Error = S::Error;
    type Future = BugwatchFuture<S::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request) -> Self::Future {
        // Extract request info before calling inner service
        let method = req.method().to_string();
        let path = req.uri().path().to_string();
        let query = req.uri().query().map(|q| q.to_string());
        let request_context = extract_request_context(&req);

        let future = self.inner.call(req);

        BugwatchFuture {
            inner: future,
            method,
            path,
            query,
            request_context,
            capture_server_errors: self.capture_server_errors,
            add_breadcrumbs: self.add_breadcrumbs,
        }
    }
}

pin_project! {
    /// Future for the Bugwatch service.
    pub struct BugwatchFuture<F> {
        #[pin]
        inner: F,
        method: String,
        path: String,
        query: Option<String>,
        request_context: RequestContext,
        capture_server_errors: bool,
        add_breadcrumbs: bool,
    }
}

impl<F, E> Future for BugwatchFuture<F>
where
    F: Future<Output = Result<Response, E>>,
{
    type Output = Result<Response, E>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();

        match this.inner.poll(cx) {
            Poll::Ready(Ok(response)) => {
                let status = response.status();

                // Add breadcrumb for the request
                if *this.add_breadcrumbs {
                    let mut data = HashMap::new();
                    data.insert("status_code".to_string(), serde_json::json!(status.as_u16()));
                    if let Some(ref url) = this.request_context.url {
                        data.insert("url".to_string(), serde_json::json!(url));
                    }

                    add_breadcrumb(
                        Breadcrumb::new("http", format!("{} {} -> {}", this.method, this.path, status.as_u16()))
                            .with_level(if status.is_server_error() {
                                Level::Error
                            } else if status.is_client_error() {
                                Level::Warning
                            } else {
                                Level::Info
                            })
                            .with_data(data),
                    );
                }

                // Capture server errors
                if *this.capture_server_errors && status.is_server_error() {
                    let message = format!(
                        "HTTP {} {} returned {}",
                        this.method,
                        this.path,
                        status.as_u16()
                    );

                    if let Some(client) = get_client() {
                        let mut tags = HashMap::new();
                        tags.insert("http.method".to_string(), this.method.clone());
                        tags.insert("http.status_code".to_string(), status.as_u16().to_string());
                        if let Some(ref url) = this.request_context.url {
                            tags.insert("http.url".to_string(), url.clone());
                        }

                        let mut extra = HashMap::new();
                        extra.insert(
                            "request".to_string(),
                            serde_json::to_value(&this.request_context).unwrap_or_default(),
                        );

                        client.capture_message_with_options(
                            &message,
                            Level::Error,
                            Some(tags),
                            Some(extra),
                        );
                    }
                }

                Poll::Ready(Ok(response))
            }
            Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Extract request context from an Axum request.
fn extract_request_context(req: &Request) -> RequestContext {
    let headers = headers_to_map(req.headers());
    let filtered_headers = filter_headers(&headers);
    let client_ip = extract_client_ip(&headers);

    let scheme = req
        .uri()
        .scheme_str()
        .unwrap_or("http");

    let host = headers
        .get("host")
        .or_else(|| headers.get("Host"))
        .map(|h| h.as_str())
        .or_else(|| req.uri().host())
        .unwrap_or("unknown");

    RequestContext {
        url: Some(build_url(
            scheme,
            host,
            req.uri().path(),
            req.uri().query(),
        )),
        method: Some(req.method().to_string()),
        headers: Some(filtered_headers),
        query_string: req.uri().query().map(|q| q.to_string()),
        client_ip: client_ip.map(|ip| ip.to_string()),
        ..Default::default()
    }
}

/// Convert HeaderMap to HashMap.
fn headers_to_map(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|v| (name.to_string(), v.to_string()))
        })
        .collect()
}

/// Axum extractor for Bugwatch request context.
///
/// Use this to access the Bugwatch request context in your handlers.
///
/// ## Example
///
/// ```ignore
/// use axum::extract::State;
/// use bugwatch::integrations::axum::BugwatchExt;
///
/// async fn handler(bugwatch: BugwatchExt) -> &'static str {
///     println!("Request URL: {:?}", bugwatch.request.url);
///     "Hello, World!"
/// }
/// ```
#[derive(Clone, Debug)]
pub struct BugwatchExt {
    /// The request context captured by the middleware.
    pub request: RequestContext,
}

impl<S> FromRequestParts<S> for BugwatchExt
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let headers = headers_to_map(&parts.headers);
        let filtered_headers = filter_headers(&headers);
        let client_ip = extract_client_ip(&headers);

        let scheme = parts.uri.scheme_str().unwrap_or("http");
        let host = headers
            .get("host")
            .or_else(|| headers.get("Host"))
            .map(|h| h.as_str())
            .or_else(|| parts.uri.host())
            .unwrap_or("unknown");

        let request = RequestContext {
            url: Some(build_url(scheme, host, parts.uri.path(), parts.uri.query())),
            method: Some(parts.method.to_string()),
            headers: Some(filtered_headers),
            query_string: parts.uri.query().map(|q| q.to_string()),
            client_ip: client_ip.map(|ip| ip.to_string()),
            ..Default::default()
        };

        Ok(BugwatchExt { request })
    }
}

/// An error type that automatically captures to Bugwatch when converted to a response.
///
/// ## Example
///
/// ```ignore
/// use axum::response::IntoResponse;
/// use bugwatch::integrations::axum::BugwatchError;
///
/// async fn handler() -> Result<&'static str, BugwatchError> {
///     do_something().map_err(BugwatchError::from_error)?;
///     Ok("Success")
/// }
/// # fn do_something() -> Result<(), std::io::Error> { Ok(()) }
/// ```
pub struct BugwatchError {
    status: StatusCode,
    message: String,
    captured: bool,
}

impl BugwatchError {
    /// Create a new Bugwatch error from any error type.
    pub fn from_error<E: std::error::Error>(error: E) -> Self {
        Self::from_error_with_status(error, StatusCode::INTERNAL_SERVER_ERROR)
    }

    /// Create a new Bugwatch error with a custom status code.
    pub fn from_error_with_status<E: std::error::Error>(error: E, status: StatusCode) -> Self {
        // Capture the error to Bugwatch
        let event_id = if let Some(client) = get_client() {
            client.capture_error(&error)
        } else {
            String::new()
        };

        Self {
            status,
            message: error.to_string(),
            captured: !event_id.is_empty(),
        }
    }

    /// Create a new Bugwatch error from a message.
    pub fn from_message(message: impl Into<String>, status: StatusCode) -> Self {
        let message = message.into();

        // Capture as a message event
        if let Some(client) = get_client() {
            client.capture_message(&message, Level::Error);
        }

        Self {
            status,
            message,
            captured: true,
        }
    }

    /// Check if this error was captured to Bugwatch.
    pub fn was_captured(&self) -> bool {
        self.captured
    }
}

impl IntoResponse for BugwatchError {
    fn into_response(self) -> Response {
        (self.status, self.message).into_response()
    }
}

impl<E: std::error::Error> From<E> for BugwatchError {
    fn from(error: E) -> Self {
        Self::from_error(error)
    }
}

/// Manually capture an error with Axum request parts.
///
/// Use this function to capture errors with request context.
///
/// ## Example
///
/// ```ignore
/// use axum::extract::Request;
/// use bugwatch::integrations::axum::capture_axum_error;
///
/// async fn handler(req: Request) -> &'static str {
///     if let Err(e) = do_something() {
///         capture_axum_error(&req, &e);
///     }
///     "Hello"
/// }
/// # fn do_something() -> Result<(), std::io::Error> { Ok(()) }
/// ```
pub fn capture_axum_error<E: std::error::Error>(req: &Request, error: &E) -> String {
    if let Some(client) = get_client() {
        let request_context = extract_request_context(req);

        let mut tags = HashMap::new();
        tags.insert("http.method".to_string(), req.method().to_string());
        if let Some(ref url) = request_context.url {
            tags.insert("http.url".to_string(), url.clone());
        }

        let mut extra = HashMap::new();
        extra.insert(
            "request".to_string(),
            serde_json::to_value(&request_context).unwrap_or_default(),
        );

        client.capture_error_with_options(error, Level::Error, Some(tags), Some(extra))
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bugwatch_layer_builder() {
        let layer = BugwatchLayer::new()
            .capture_server_errors(false)
            .add_breadcrumbs(false);

        assert!(!layer.capture_server_errors);
        assert!(!layer.add_breadcrumbs);
    }

    #[test]
    fn test_headers_to_map() {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", "application/json".parse().unwrap());
        headers.insert("x-request-id", "abc123".parse().unwrap());

        let map = headers_to_map(&headers);

        assert_eq!(map.get("content-type"), Some(&"application/json".to_string()));
        assert_eq!(map.get("x-request-id"), Some(&"abc123".to_string()));
    }

    #[test]
    fn test_from_env_missing_key() {
        // Temporarily remove the env var
        let original = std::env::var("BUGWATCH_API_KEY").ok();
        std::env::remove_var("BUGWATCH_API_KEY");

        let result = BugwatchLayer::from_env();
        assert!(result.is_err());

        // Restore
        if let Some(val) = original {
            std::env::set_var("BUGWATCH_API_KEY", val);
        }
    }
}
