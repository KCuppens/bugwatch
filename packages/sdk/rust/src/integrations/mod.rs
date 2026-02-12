//! Framework integrations for Bugwatch.
//!
//! This module provides middleware and integrations for popular Rust web frameworks.
//!
//! ## Available Integrations
//!
//! - `actix` - Actix-web middleware (requires `actix` feature)
//! - `axum` - Axum Tower layer (requires `axum` feature)
//!
//! ## Usage
//!
//! ### Actix-web
//!
//! ```ignore
//! use actix_web::{App, HttpServer};
//! use bugwatch::integrations::actix::BugwatchActix;
//!
//! HttpServer::new(|| {
//!     App::new()
//!         .wrap(BugwatchActix::new())
//!         .service(/* your routes */)
//! })
//! ```
//!
//! ### Axum
//!
//! ```ignore
//! use axum::Router;
//! use bugwatch::integrations::axum::BugwatchLayer;
//!
//! let app = Router::new()
//!     .route("/", get(handler))
//!     .layer(BugwatchLayer::new());
//! ```

pub mod common;

#[cfg(feature = "actix")]
pub mod actix;

#[cfg(feature = "axum")]
pub mod axum;

pub use common::{extract_client_ip, filter_headers, is_sensitive_header};
