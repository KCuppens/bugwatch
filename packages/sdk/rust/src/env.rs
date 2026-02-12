//! Environment variable utilities for Bugwatch Rust SDK.
//!
//! This module provides functions for reading configuration from environment
//! variables and creating `BugwatchOptions` from the environment.
//!
//! ## Supported Environment Variables
//!
//! | Variable | Purpose |
//! |----------|---------|
//! | `BUGWATCH_API_KEY` | API key (required) |
//! | `BUGWATCH_ENVIRONMENT` | Environment tag |
//! | `BUGWATCH_RELEASE` | Release version |
//! | `BUGWATCH_DEBUG` | Enable debug mode ("true") |
//! | `BUGWATCH_ENDPOINT` | Custom API endpoint |
//!
//! ## Example
//!
//! ```no_run
//! use bugwatch::env::get_env_options;
//!
//! // Set BUGWATCH_API_KEY=bw_live_xxxxx in your environment
//! let options = get_env_options().expect("BUGWATCH_API_KEY not set");
//! ```

use std::env;
use std::fmt;

use crate::types::BugwatchOptions;

/// Environment variable names for Bugwatch configuration.
pub mod vars {
    /// API key environment variable.
    pub const API_KEY: &str = "BUGWATCH_API_KEY";
    /// Environment tag environment variable.
    pub const ENVIRONMENT: &str = "BUGWATCH_ENVIRONMENT";
    /// Release version environment variable.
    pub const RELEASE: &str = "BUGWATCH_RELEASE";
    /// Debug mode environment variable.
    pub const DEBUG: &str = "BUGWATCH_DEBUG";
    /// Custom endpoint environment variable.
    pub const ENDPOINT: &str = "BUGWATCH_ENDPOINT";
}

/// Error type for environment configuration issues.
#[derive(Debug, Clone)]
pub enum EnvError {
    /// API key environment variable is not set.
    MissingApiKey,
    /// API key has an invalid format.
    InvalidApiKeyFormat(String),
}

impl fmt::Display for EnvError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EnvError::MissingApiKey => write!(
                f,
                "Bugwatch: API key required. Set {} environment variable or pass options explicitly",
                vars::API_KEY
            ),
            EnvError::InvalidApiKeyFormat(key) => {
                // Only show prefix if key is long enough to not expose the full key
                let preview = if key.len() > 10 {
                    format!("{}...", &key[..6])
                } else {
                    "[hidden]".to_string()
                };
                write!(
                    f,
                    "Bugwatch: API key should start with 'bw_'. Got '{}'",
                    preview
                )
            }
        }
    }
}

impl std::error::Error for EnvError {}

/// Read Bugwatch options from environment variables.
///
/// This function reads configuration from the following environment variables:
/// - `BUGWATCH_API_KEY` - API key (required)
/// - `BUGWATCH_ENVIRONMENT` - Environment tag
/// - `BUGWATCH_RELEASE` - Release version
/// - `BUGWATCH_DEBUG` - Enable debug mode ("true" to enable)
/// - `BUGWATCH_ENDPOINT` - Custom API endpoint
///
/// # Errors
///
/// Returns `EnvError::MissingApiKey` if `BUGWATCH_API_KEY` is not set.
///
/// # Example
///
/// ```no_run
/// use bugwatch::env::get_env_options;
///
/// let options = get_env_options()?;
/// let client = bugwatch::init(options);
/// # Ok::<(), bugwatch::env::EnvError>(())
/// ```
pub fn get_env_options() -> Result<BugwatchOptions, EnvError> {
    let api_key = env::var(vars::API_KEY).map_err(|_| EnvError::MissingApiKey)?;

    // Warn about invalid API key format (but don't fail)
    if !api_key.starts_with("bw_") {
        // Only show prefix if key is long enough to not expose the full key
        let preview = if api_key.len() > 10 {
            format!("{}...", &api_key[..6])
        } else {
            "[hidden]".to_string()
        };
        tracing::warn!(
            "Bugwatch: API key should start with 'bw_'. Got '{}'",
            preview
        );
    }

    let mut options = BugwatchOptions::new(api_key);

    if let Ok(environment) = env::var(vars::ENVIRONMENT) {
        options = options.with_environment(environment);
    }

    if let Ok(release) = env::var(vars::RELEASE) {
        options = options.with_release(release);
    }

    if env::var(vars::DEBUG).ok().as_deref() == Some("true") {
        options = options.with_debug(true);
    }

    if let Ok(endpoint) = env::var(vars::ENDPOINT) {
        options = options.with_endpoint(endpoint);
    }

    Ok(options)
}

/// Check if an API key is available in environment variables.
///
/// Returns `true` if `BUGWATCH_API_KEY` is set, `false` otherwise.
pub fn has_api_key() -> bool {
    env::var(vars::API_KEY).is_ok()
}

/// Validate an API key format.
///
/// # Errors
///
/// Returns `EnvError::InvalidApiKeyFormat` if the key doesn't start with "bw_".
pub fn validate_api_key(key: &str) -> Result<(), EnvError> {
    if !key.starts_with("bw_") {
        return Err(EnvError::InvalidApiKeyFormat(key.to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_has_api_key() {
        // Save current value
        let original = env::var(vars::API_KEY).ok();

        // Test without key
        env::remove_var(vars::API_KEY);
        assert!(!has_api_key());

        // Test with key
        env::set_var(vars::API_KEY, "bw_test_key");
        assert!(has_api_key());

        // Restore
        match original {
            Some(val) => env::set_var(vars::API_KEY, val),
            None => env::remove_var(vars::API_KEY),
        }
    }

    #[test]
    fn test_validate_api_key() {
        assert!(validate_api_key("bw_test_key").is_ok());
        assert!(validate_api_key("bw_live_xxxxx").is_ok());
        assert!(validate_api_key("invalid").is_err());
        assert!(validate_api_key("").is_err());
    }

    #[test]
    fn test_env_error_display() {
        let err = EnvError::MissingApiKey;
        assert!(err.to_string().contains("BUGWATCH_API_KEY"));

        // Short key should be hidden
        let err = EnvError::InvalidApiKeyFormat("short".to_string());
        assert!(err.to_string().contains("[hidden]"));
        assert!(err.to_string().contains("bw_"));

        // Long key should show prefix only
        let err = EnvError::InvalidApiKeyFormat("very_long_invalid_key_here".to_string());
        assert!(err.to_string().contains("very_l..."));
    }
}
