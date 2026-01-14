# Bugwatch Python SDK

Official Python SDK for [Bugwatch](https://bugwatch.io) - AI-Powered Error Tracking.

## Installation

```bash
pip install bugwatch-sdk
```

With framework integrations:

```bash
# Django
pip install bugwatch-sdk[django]

# Flask
pip install bugwatch-sdk[flask]

# FastAPI
pip install bugwatch-sdk[fastapi]

# All integrations
pip install bugwatch-sdk[all]
```

## Quick Start (Plug and Play)

```python
import bugwatch

# Option 1: Use environment variable
# Set BUGWATCH_API_KEY=your-api-key in your environment
bugwatch.init()

# Option 2: Pass API key explicitly
bugwatch.init(api_key="your-api-key")

# That's it! All uncaught exceptions are now captured automatically.
```

The SDK automatically captures:
- **Uncaught exceptions** in the main thread (`sys.excepthook`)
- **Thread exceptions** in spawned threads (`threading.excepthook`)
- **Async task exceptions** in asyncio tasks

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BUGWATCH_API_KEY` | Your API key (required if not passed to `init()`) |
| `BUGWATCH_ENVIRONMENT` | Environment name (e.g., "production") |
| `BUGWATCH_RELEASE` | Release/version identifier |

## Manual Capture (Optional)

You can also capture exceptions manually:

```python
import bugwatch

bugwatch.init(api_key="your-api-key")

try:
    do_something_risky()
except Exception:
    bugwatch.capture_exception()

# Capture messages
bugwatch.capture_message("Something happened", level=bugwatch.Level.WARNING)
```

## Django Integration

Add the middleware to your settings:

```python
# settings.py

MIDDLEWARE = [
    'bugwatch.integrations.django.BugwatchMiddleware',
    # ... other middleware
]

BUGWATCH = {
    'api_key': 'your-api-key',  # Or use BUGWATCH_API_KEY env var
    'environment': 'production',
    'release': '1.0.0',
}
```

## Flask Integration

```python
from flask import Flask
from bugwatch.integrations.flask import BugwatchFlask

app = Flask(__name__)
BugwatchFlask(app, api_key='your-api-key')
```

## FastAPI Integration

```python
from fastapi import FastAPI
from bugwatch.integrations.fastapi import BugwatchFastAPI

app = FastAPI()
BugwatchFastAPI(app, api_key='your-api-key')
```

## Logging Integration

Capture logged errors automatically:

```python
import logging
from bugwatch.integrations.logging import BugwatchHandler, setup_logging

# Quick setup - captures ERROR and above
setup_logging()

# Or manual setup with options
handler = BugwatchHandler(
    level=logging.ERROR,
    capture_breadcrumbs=True,  # Add logs as breadcrumbs
    breadcrumb_level=logging.INFO,
)
logging.getLogger().addHandler(handler)

# Now logged errors are captured
logging.error("This will be sent to Bugwatch")
```

## Features

- **Plug and play** - Just call `init()` and all exceptions are captured
- **Automatic exception hooks** - Captures uncaught exceptions globally
- **Thread safety** - Captures exceptions in spawned threads
- **Async support** - Captures exceptions in asyncio tasks
- **Logging integration** - Capture logged errors
- **Breadcrumbs** - Track user actions leading up to an error
- **User context** - Associate errors with users
- **Tags and extra data** - Add custom metadata to errors
- **Fingerprinting** - Automatic grouping of similar errors
- **Framework integrations** - Django, Flask, FastAPI support
- **Atexit handling** - Flushes pending events on shutdown

## API Reference

### `bugwatch.init(api_key=None, **options)`

Initialize the SDK. If `api_key` is not provided, reads from `BUGWATCH_API_KEY` environment variable.

Options:
- `api_key` (str): Your Bugwatch API key
- `endpoint` (str): API endpoint (default: https://api.bugwatch.io)
- `environment` (str): Environment name
- `release` (str): Release/version identifier
- `debug` (bool): Enable debug logging
- `sample_rate` (float): Sample rate for events (0.0-1.0)
- `max_breadcrumbs` (int): Maximum breadcrumbs to keep
- `install_excepthook` (bool): Install sys.excepthook (default: True)
- `install_threading_hook` (bool): Install threading.excepthook (default: True)
- `install_asyncio_hook` (bool): Install asyncio exception handler (default: True)

### `bugwatch.capture_exception(error=None, level=Level.ERROR, tags=None, extra=None)`

Capture an exception. If `error` is None, captures the current exception from `sys.exc_info()`.

### `bugwatch.capture_message(message, level=Level.INFO, tags=None, extra=None)`

Capture a message.

### `bugwatch.add_breadcrumb(category, message, level=Level.INFO, data=None)`

Add a breadcrumb.

### `bugwatch.set_user(user)`

Set the current user context.

### `bugwatch.set_tag(key, value)`

Set a tag for all future events.

### `bugwatch.set_extra(key, value)`

Set extra context for all future events.

### `bugwatch.flush()`

Flush any pending events to Bugwatch.

### `bugwatch.close()`

Close the client and restore original exception hooks.

## Disabling Automatic Capture

If you want manual control only:

```python
bugwatch.init(
    api_key="your-api-key",
    install_excepthook=False,
    install_threading_hook=False,
    install_asyncio_hook=False,
)
```

## License

MIT
