//! HTTP transport for sending error events to Bugwatch.

use std::time::Duration;
use thiserror::Error;

use crate::types::{BugwatchOptions, ErrorEvent};

/// Transport errors.
#[derive(Error, Debug)]
pub enum TransportError {
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Request error: {0}")]
    Request(String),
}

/// Trait for sending events to Bugwatch.
pub trait Transport: Send + Sync {
    /// Send an event to Bugwatch.
    fn send(&self, event: &ErrorEvent) -> Result<(), TransportError>;

    /// Flush any pending events.
    ///
    /// This ensures all queued events are sent before the method returns.
    /// The default implementation does nothing (for transports that send synchronously).
    fn flush(&self) -> Result<(), TransportError> {
        Ok(())
    }

    /// Close the transport and release any resources.
    ///
    /// After calling this method, the transport should not be used again.
    /// The default implementation calls flush().
    fn close(&self) -> Result<(), TransportError> {
        self.flush()
    }

    /// Downcast support for accessing concrete transport types.
    ///
    /// The default implementation returns a reference that will fail any downcast,
    /// causing the client to fall back to synchronous `send()`. Override this in
    /// custom transports that need async support.
    fn as_any(&self) -> &dyn std::any::Any {
        &()
    }
}

/// HTTP transport for sending events.
#[derive(Clone)]
pub struct HttpTransport {
    endpoint: String,
    api_key: String,
    debug: bool,
    #[cfg(feature = "blocking")]
    blocking_client: Option<reqwest::blocking::Client>,
    #[cfg(feature = "async")]
    async_client: reqwest::Client,
}

impl HttpTransport {
    /// Create a new HTTP transport.
    ///
    /// # Errors
    ///
    /// Returns `TransportError::Request` if the HTTP client cannot be created.
    pub fn new(options: &BugwatchOptions) -> Result<Self, TransportError> {
        #[cfg(feature = "blocking")]
        let blocking_client = Some(
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|e| {
                    TransportError::Request(format!("Failed to create HTTP client: {}", e))
                })?,
        );

        #[cfg(feature = "async")]
        let async_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| {
                TransportError::Request(format!("Failed to create async HTTP client: {}", e))
            })?;

        Ok(Self {
            endpoint: format!("{}/api/v1/events", options.endpoint.trim_end_matches('/')),
            api_key: options.api_key.clone(),
            debug: options.debug,
            #[cfg(feature = "blocking")]
            blocking_client,
            #[cfg(feature = "async")]
            async_client,
        })
    }

    /// Send an event synchronously (blocking).
    #[cfg(feature = "blocking")]
    pub fn send_blocking(&self, event: &ErrorEvent) -> Result<(), TransportError> {
        let client = self
            .blocking_client
            .as_ref()
            .ok_or_else(|| TransportError::Request("No blocking client available".to_string()))?;

        // Serialize explicitly so we get a clear serialization error vs network error
        let body = serde_json::to_vec(event)?;

        let response = client
            .post(&self.endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header(
                "User-Agent",
                format!("bugwatch-rust/{}", env!("CARGO_PKG_VERSION")),
            )
            .body(body)
            .send()
            .map_err(|e| TransportError::Request(e.to_string()))?;

        if response.status().is_success() {
            if self.debug {
                tracing::debug!("Event sent successfully: {}", event.event_id);
            }
            Ok(())
        } else {
            Err(TransportError::Http(format!(
                "HTTP {} {}",
                response.status().as_u16(),
                response.status().as_str()
            )))
        }
    }

    /// Send an event asynchronously.
    #[cfg(feature = "async")]
    pub async fn send_async(&self, event: &ErrorEvent) -> Result<(), TransportError> {
        // Serialize explicitly so we get a clear serialization error vs network error
        let body = serde_json::to_vec(event)?;

        let response = self
            .async_client
            .post(&self.endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header(
                "User-Agent",
                format!("bugwatch-rust/{}", env!("CARGO_PKG_VERSION")),
            )
            .body(body)
            .send()
            .await
            .map_err(|e| TransportError::Request(e.to_string()))?;

        if response.status().is_success() {
            if self.debug {
                tracing::debug!("Event sent successfully: {}", event.event_id);
            }
            Ok(())
        } else {
            Err(TransportError::Http(format!(
                "HTTP {} {}",
                response.status().as_u16(),
                response.status().as_str()
            )))
        }
    }
}

impl Transport for HttpTransport {
    fn send(&self, event: &ErrorEvent) -> Result<(), TransportError> {
        #[cfg(feature = "blocking")]
        {
            self.send_blocking(event)
        }
        #[cfg(not(feature = "blocking"))]
        {
            Err(TransportError::Request(
                "Blocking transport not available. Enable the 'blocking' feature.".to_string(),
            ))
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// No-op transport that does nothing (for testing).
#[derive(Default)]
pub struct NoopTransport;

impl Transport for NoopTransport {
    fn send(&self, _event: &ErrorEvent) -> Result<(), TransportError> {
        Ok(())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// Console transport that logs events (for debugging).
pub struct ConsoleTransport {
    debug: bool,
}

impl ConsoleTransport {
    pub fn new(debug: bool) -> Self {
        Self { debug }
    }
}

impl Transport for ConsoleTransport {
    fn send(&self, event: &ErrorEvent) -> Result<(), TransportError> {
        println!("[Bugwatch] Event {}", event.event_id);
        println!("  Level: {}", event.level);
        if let Some(ref exception) = event.exception {
            println!("  Exception: {}: {}", exception.error_type, exception.value);
        }
        if let Some(ref message) = event.message {
            println!("  Message: {}", message);
        }
        println!("  Tags: {:?}", event.tags);
        Ok(())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

impl Default for ConsoleTransport {
    fn default() -> Self {
        Self::new(false)
    }
}
