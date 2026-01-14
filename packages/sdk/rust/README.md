# Bugwatch Rust SDK

Official Rust SDK for [Bugwatch](https://bugwatch.io) - AI-Powered Error Tracking.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
bugwatch = "0.1"
```

With specific features:

```toml
# Async only
bugwatch = { version = "0.1", default-features = false, features = ["async"] }

# Blocking only
bugwatch = { version = "0.1", default-features = false, features = ["blocking"] }
```

## Quick Start

```rust
use bugwatch::{BugwatchClient, BugwatchOptions, Level};
use std::sync::Arc;

fn main() {
    // Create a client
    let client = Arc::new(BugwatchClient::new(
        BugwatchOptions::new("your-api-key")
            .with_environment("production")
            .with_release("1.0.0")
    ));

    // Capture an error
    if let Err(e) = some_operation() {
        client.capture_error(&e);
    }

    // Capture a message
    client.capture_message("Something happened", Level::Warning);
}
```

## Panic Hook

Automatically capture panics:

```rust
use bugwatch::{BugwatchClient, BugwatchOptions, install_panic_hook};
use std::sync::Arc;

fn main() {
    let client = Arc::new(BugwatchClient::new(
        BugwatchOptions::new("your-api-key")
    ));

    // Install panic hook
    install_panic_hook(client);

    // Now panics will be captured to Bugwatch
    panic!("This will be captured!");
}
```

## Breadcrumbs

Track user actions leading up to an error:

```rust
use bugwatch::{BugwatchClient, BugwatchOptions, Breadcrumb, Level};

let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));

client.add_breadcrumb(
    Breadcrumb::new("http", "GET /api/users")
        .with_level(Level::Info)
);

client.add_breadcrumb(
    Breadcrumb::new("db", "SELECT * FROM users")
        .with_level(Level::Debug)
);
```

## User Context

Associate errors with users:

```rust
use bugwatch::{BugwatchClient, BugwatchOptions, UserContext};

let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));

client.set_user(Some(
    UserContext::new()
        .with_id("user-123")
        .with_email("user@example.com")
        .with_username("johndoe")
));
```

## Tags and Extra Data

Add custom metadata:

```rust
use bugwatch::{BugwatchClient, BugwatchOptions};

let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));

// Set tags
client.set_tag("version", "1.0.0");
client.set_tag("feature", "checkout");

// Set extra context
client.set_extra("order_id", serde_json::json!(12345));
```

## Async Usage

```rust
use bugwatch::{BugwatchClient, BugwatchOptions, Level};

#[tokio::main]
async fn main() {
    let client = BugwatchClient::new(BugwatchOptions::new("your-api-key"));

    // Capture error asynchronously
    if let Err(e) = async_operation().await {
        client.capture_error_async(&e).await;
    }

    // Capture message asynchronously
    client.capture_message_async("Async event", Level::Info).await;
}
```

## Global Client

For convenience, you can use the global client:

```rust
use bugwatch::{init, capture_message, capture_error, Level, BugwatchOptions};

fn main() {
    // Initialize once
    init(BugwatchOptions::new("your-api-key"));

    // Use anywhere
    capture_message("Hello!", Level::Info);

    if let Err(e) = some_operation() {
        capture_error(&e);
    }
}
```

## Features

- **Automatic panic capture** - Install a panic hook for automatic capture
- **Breadcrumbs** - Track user actions leading up to an error
- **User context** - Associate errors with users
- **Tags and extra data** - Add custom metadata to errors
- **Fingerprinting** - Automatic grouping of similar errors
- **Async support** - Full async/await support with tokio
- **Blocking support** - Synchronous API available

## Configuration Options

```rust
use bugwatch::BugwatchOptions;

let options = BugwatchOptions::new("your-api-key")
    .with_endpoint("https://api.bugwatch.io")  // Custom endpoint
    .with_environment("production")             // Environment name
    .with_release("1.0.0")                      // Release version
    .with_debug(true)                           // Enable debug logging
    .with_sample_rate(0.5);                     // Sample 50% of events
```

## License

MIT
