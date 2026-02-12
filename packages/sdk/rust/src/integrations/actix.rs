//! Actix-web integration for Bugwatch.
//!
//! This module provides middleware for automatically capturing errors and
//! request context in Actix-web applications.
//!
//! ## Usage with Environment Variables (Recommended)
//!
//! ```ignore
//! use actix_web::{App, HttpServer, web, HttpResponse};
//! use bugwatch::integrations::actix::BugwatchActix;
//!
//! // Set BUGWATCH_API_KEY=bw_live_xxxxx in your environment
//!
//! #[actix_web::main]
//! async fn main() -> std::io::Result<()> {
//!     HttpServer::new(|| {
//!         App::new()
//!             // Auto-initializes from BUGWATCH_API_KEY env var
//!             .wrap(BugwatchActix::from_env().expect("BUGWATCH_API_KEY not set"))
//!             .route("/", web::get().to(|| async { HttpResponse::Ok().body("Hello!") }))
//!     })
//!     .bind("127.0.0.1:8080")?
//!     .run()
//!     .await
//! }
//! ```
//!
//! ## Manual Initialization
//!
//! ```ignore
//! use actix_web::{App, HttpServer, web, HttpResponse};
//! use bugwatch::{init, BugwatchOptions};
//! use bugwatch::integrations::actix::BugwatchActix;
//!
//! #[actix_web::main]
//! async fn main() -> std::io::Result<()> {
//!     // Initialize Bugwatch manually
//!     init(BugwatchOptions::new("your-api-key"));
//!
//!     HttpServer::new(|| {
//!         App::new()
//!             .wrap(BugwatchActix::new())
//!             .route("/", web::get().to(|| async { HttpResponse::Ok().body("Hello!") }))
//!     })
//!     .bind("127.0.0.1:8080")?
//!     .run()
//!     .await
//! }
//! ```

use std::collections::HashMap;
use std::sync::Arc;
use std::task::{Context, Poll};

use actix_service::{Service, Transform};
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::{Error, HttpMessage};
use futures_util::future::{ok, LocalBoxFuture, Ready};

use crate::env::{get_env_options, EnvError};
use crate::types::{Breadcrumb, Level, RequestContext};
use crate::{add_breadcrumb, get_client, init};

use super::common::{build_url, extract_client_ip, filter_headers};

/// Bugwatch middleware for Actix-web.
///
/// This middleware automatically:
/// - Captures request context for errors
/// - Adds HTTP request breadcrumbs
/// - Reports server errors (5xx) to Bugwatch
#[derive(Clone, Default)]
pub struct BugwatchActix {
    /// Whether to capture 5xx errors automatically
    capture_server_errors: bool,
    /// Whether to add request breadcrumbs
    add_breadcrumbs: bool,
}

impl BugwatchActix {
    /// Create a new Bugwatch middleware with default settings.
    ///
    /// Note: This assumes the SDK has already been initialized with `init()`.
    /// For automatic initialization from environment variables, use `from_env()`.
    pub fn new() -> Self {
        Self {
            capture_server_errors: true,
            add_breadcrumbs: true,
        }
    }

    /// Create a new Bugwatch middleware, initializing from environment variables.
    ///
    /// This is the recommended way to create the middleware. It will:
    /// 1. Initialize the Bugwatch SDK from `BUGWATCH_API_KEY` and other env vars
    /// 2. Create the middleware with default settings
    ///
    /// # Errors
    ///
    /// Returns `EnvError::MissingApiKey` if `BUGWATCH_API_KEY` is not set.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use actix_web::App;
    /// use bugwatch::integrations::actix::BugwatchActix;
    ///
    /// // Requires BUGWATCH_API_KEY environment variable
    /// App::new()
    ///     .wrap(BugwatchActix::from_env()?)
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

impl<S, B> Transform<S, ServiceRequest> for BugwatchActix
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = BugwatchActixMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(BugwatchActixMiddleware {
            service: Arc::new(service),
            capture_server_errors: self.capture_server_errors,
            add_breadcrumbs: self.add_breadcrumbs,
        })
    }
}

/// The actual middleware service.
pub struct BugwatchActixMiddleware<S> {
    service: Arc<S>,
    capture_server_errors: bool,
    add_breadcrumbs: bool,
}

impl<S> Clone for BugwatchActixMiddleware<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            capture_server_errors: self.capture_server_errors,
            add_breadcrumbs: self.add_breadcrumbs,
        }
    }
}

impl<S, B> Service<ServiceRequest> for BugwatchActixMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();
        let capture_server_errors = self.capture_server_errors;
        let add_breadcrumbs = self.add_breadcrumbs;

        // Extract request context before calling the service
        let request_context = extract_request_context(&req);
        let method = req.method().to_string();
        let path = req.path().to_string();

        // Store request context in extensions for error handlers
        req.extensions_mut().insert(BugwatchRequestContext(request_context.clone()));

        Box::pin(async move {
            let response = service.call(req).await?;

            let status = response.status();

            // Add breadcrumb for the request
            if add_breadcrumbs {
                let mut data = HashMap::new();
                data.insert("status_code".to_string(), serde_json::json!(status.as_u16()));
                if let Some(ref url) = request_context.url {
                    data.insert("url".to_string(), serde_json::json!(url));
                }

                add_breadcrumb(
                    Breadcrumb::new("http", format!("{} {} -> {}", method, path, status.as_u16()))
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
            if capture_server_errors && status.is_server_error() {
                let message = format!(
                    "HTTP {} {} returned {}",
                    method,
                    path,
                    status.as_u16()
                );

                if let Some(client) = get_client() {
                    let mut tags = HashMap::new();
                    tags.insert("http.method".to_string(), method);
                    tags.insert("http.status_code".to_string(), status.as_u16().to_string());
                    if let Some(ref url) = request_context.url {
                        tags.insert("http.url".to_string(), url.clone());
                    }

                    let mut extra = HashMap::new();
                    extra.insert("request".to_string(), serde_json::to_value(&request_context).unwrap_or_default());

                    client.capture_message_with_options(&message, Level::Error, Some(tags), Some(extra));
                }
            }

            Ok(response)
        })
    }
}

/// Request context stored in request extensions.
#[derive(Clone)]
pub struct BugwatchRequestContext(pub RequestContext);

/// Extract request context from an Actix-web request.
fn extract_request_context(req: &ServiceRequest) -> RequestContext {
    let conn_info = req.connection_info();
    let headers: HashMap<String, String> = req
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|v| (name.to_string(), v.to_string()))
        })
        .collect();

    let filtered_headers = filter_headers(&headers);
    let client_ip = extract_client_ip(&headers);

    RequestContext {
        url: Some(build_url(
            conn_info.scheme(),
            conn_info.host(),
            req.path(),
            req.query_string().is_empty().then(|| None).unwrap_or(Some(req.query_string())),
        )),
        method: Some(req.method().to_string()),
        headers: Some(filtered_headers),
        query_string: if req.query_string().is_empty() {
            None
        } else {
            Some(req.query_string().to_string())
        },
        client_ip: client_ip.map(|ip| ip.to_string()),
        ..Default::default()
    }
}

/// Manually capture an error with Actix-web request context.
///
/// Use this function to capture errors that are caught in your handlers
/// but should still be reported to Bugwatch.
///
/// ## Example
///
/// ```ignore
/// use actix_web::{web, HttpResponse, Error};
/// use bugwatch::integrations::actix::capture_actix_error;
///
/// async fn handler(req: actix_web::HttpRequest) -> Result<HttpResponse, Error> {
///     match do_something() {
///         Ok(result) => Ok(HttpResponse::Ok().json(result)),
///         Err(e) => {
///             capture_actix_error(&req, &e);
///             Ok(HttpResponse::InternalServerError().finish())
///         }
///     }
/// }
/// # fn do_something() -> Result<(), std::io::Error> { Ok(()) }
/// ```
pub fn capture_actix_error<E: std::error::Error>(
    req: &actix_web::HttpRequest,
    error: &E,
) -> String {
    if let Some(client) = get_client() {
        let headers: HashMap<String, String> = req
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value.to_str().ok().map(|v| (name.to_string(), v.to_string()))
            })
            .collect();

        let filtered_headers = filter_headers(&headers);
        let client_ip = extract_client_ip(&headers);
        let conn_info = req.connection_info();

        let request_context = RequestContext {
            url: Some(build_url(
                conn_info.scheme(),
                conn_info.host(),
                req.path(),
                req.query_string().is_empty().then(|| None).unwrap_or(Some(req.query_string())),
            )),
            method: Some(req.method().to_string()),
            headers: Some(filtered_headers),
            query_string: if req.query_string().is_empty() {
                None
            } else {
                Some(req.query_string().to_string())
            },
            client_ip: client_ip.map(|ip| ip.to_string()),
            ..Default::default()
        };

        let mut tags = HashMap::new();
        tags.insert("http.method".to_string(), req.method().to_string());
        if let Some(ref url) = request_context.url {
            tags.insert("http.url".to_string(), url.clone());
        }

        let mut extra = HashMap::new();
        extra.insert("request".to_string(), serde_json::to_value(&request_context).unwrap_or_default());

        client.capture_error_with_options(error, Level::Error, Some(tags), Some(extra))
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bugwatch_actix_builder() {
        let middleware = BugwatchActix::new()
            .capture_server_errors(false)
            .add_breadcrumbs(false);

        assert!(!middleware.capture_server_errors);
        assert!(!middleware.add_breadcrumbs);
    }

    #[test]
    fn test_from_env_missing_key() {
        // Temporarily remove the env var
        let original = std::env::var("BUGWATCH_API_KEY").ok();
        std::env::remove_var("BUGWATCH_API_KEY");

        let result = BugwatchActix::from_env();
        assert!(result.is_err());

        // Restore
        if let Some(val) = original {
            std::env::set_var("BUGWATCH_API_KEY", val);
        }
    }
}
