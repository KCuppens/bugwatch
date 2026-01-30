"""
Bugwatch Python SDK - AI-Powered Error Tracking

A Python SDK for capturing and sending errors to Bugwatch.

Plug and play usage::

    import bugwatch

    # Option 1: Use environment variable BUGWATCH_API_KEY
    bugwatch.init()

    # Option 2: Pass API key explicitly
    bugwatch.init(api_key="your-api-key")

    # That's it! All uncaught exceptions are now captured automatically.

Manual capture (optional)::

    try:
        do_something()
    except Exception:
        bugwatch.capture_exception()
"""
import atexit
import asyncio
import os
import sys
import threading
from typing import Any, Callable, Dict, Optional

from .client import BugwatchClient
from .fingerprint import fingerprint_from_exception, generate_fingerprint
from .transport import (
    AsyncHttpTransport,
    ConsoleTransport,
    HttpTransport,
    NoopTransport,
    Transport,
)
from .types import (
    Breadcrumb,
    BugwatchOptions,
    ErrorEvent,
    ExceptionInfo,
    Level,
    RequestContext,
    RuntimeInfo,
    SdkInfo,
    StackFrame,
    UserContext,
)

__version__ = "0.1.0"
__all__ = [
    # Main functions
    "init",
    "capture_exception",
    "capture_message",
    "add_breadcrumb",
    "set_user",
    "set_request",
    "set_tag",
    "set_extra",
    "get_client",
    "flush",
    "close",
    # Client
    "BugwatchClient",
    # Types
    "BugwatchOptions",
    "ErrorEvent",
    "ExceptionInfo",
    "StackFrame",
    "Breadcrumb",
    "UserContext",
    "RequestContext",
    "RuntimeInfo",
    "SdkInfo",
    "Level",
    # Transport
    "Transport",
    "HttpTransport",
    "AsyncHttpTransport",
    "NoopTransport",
    "ConsoleTransport",
    # Fingerprint
    "generate_fingerprint",
    "fingerprint_from_exception",
]

# Global client instance
_client: Optional[BugwatchClient] = None

# Original hooks (saved to restore and chain)
_original_excepthook: Optional[Callable] = None
_original_threading_excepthook: Optional[Callable] = None
_original_asyncio_handler: Optional[Callable] = None

# Track if hooks are installed
_hooks_installed: bool = False


# =============================================================================
# Global Exception Hooks
# =============================================================================

def _bugwatch_excepthook(exc_type, exc_value, exc_tb):
    """Global exception hook to capture uncaught exceptions."""
    if _client is not None:
        try:
            # Attach traceback to exception
            exc_value.__traceback__ = exc_tb
            _client.capture_exception(exc_value, level=Level.FATAL)
        except Exception:
            # Don't let our hook cause additional problems
            pass

    # Call original hook (usually prints to stderr)
    if _original_excepthook:
        _original_excepthook(exc_type, exc_value, exc_tb)


def _bugwatch_threading_excepthook(args):
    """Thread exception hook (Python 3.8+)."""
    if _client is not None:
        try:
            # Attach traceback to exception
            args.exc_value.__traceback__ = args.exc_traceback

            # Add thread info as tag
            thread_name = args.thread.name if args.thread else "unknown"
            _client.capture_exception(
                args.exc_value,
                level=Level.ERROR,
                tags={"thread.name": thread_name},
            )
        except Exception:
            pass

    # Call original hook
    if _original_threading_excepthook:
        _original_threading_excepthook(args)


def _bugwatch_asyncio_handler(loop, context):
    """Asyncio exception handler for task exceptions."""
    exception = context.get("exception")

    if exception and _client is not None:
        try:
            _client.capture_exception(
                exception,
                level=Level.ERROR,
                extra={
                    "asyncio.message": context.get("message", ""),
                    "asyncio.task": str(context.get("future", "")),
                },
            )
        except Exception:
            pass

    # Call original handler
    if _original_asyncio_handler:
        _original_asyncio_handler(loop, context)
    else:
        # Default behavior: log to stderr
        loop.default_exception_handler(context)


def _install_excepthook():
    """Install sys.excepthook."""
    global _original_excepthook
    if sys.excepthook is not _bugwatch_excepthook:
        _original_excepthook = sys.excepthook
        sys.excepthook = _bugwatch_excepthook


def _install_threading_hook():
    """Install threading.excepthook (Python 3.8+)."""
    global _original_threading_excepthook
    if sys.version_info >= (3, 8):
        if threading.excepthook is not _bugwatch_threading_excepthook:
            _original_threading_excepthook = threading.excepthook
            threading.excepthook = _bugwatch_threading_excepthook


def _install_asyncio_hook():
    """Install asyncio exception handler."""
    global _original_asyncio_handler

    try:
        loop = asyncio.get_running_loop()
        handler = loop.get_exception_handler()
        if handler is not _bugwatch_asyncio_handler:
            _original_asyncio_handler = handler
            loop.set_exception_handler(_bugwatch_asyncio_handler)
    except RuntimeError:
        # No running loop - that's okay, will work when loop starts
        pass


def _uninstall_hooks():
    """Restore original exception hooks."""
    global _hooks_installed

    if _original_excepthook:
        sys.excepthook = _original_excepthook

    if _original_threading_excepthook and sys.version_info >= (3, 8):
        threading.excepthook = _original_threading_excepthook

    _hooks_installed = False


# =============================================================================
# Atexit Handler
# =============================================================================

def _atexit_handler():
    """Flush pending events and cleanup on shutdown."""
    if _client is not None:
        try:
            # Give transport a chance to flush
            if hasattr(_client.transport, 'flush'):
                _client.transport.flush()
        except Exception:
            pass


# =============================================================================
# Public API
# =============================================================================

def init(
    api_key: Optional[str] = None,
    endpoint: str = "https://api.bugwatch.dev",
    environment: Optional[str] = None,
    release: Optional[str] = None,
    debug: bool = False,
    install_excepthook: bool = True,
    install_threading_hook: bool = True,
    install_asyncio_hook: bool = True,
    **kwargs: Any,
) -> BugwatchClient:
    """
    Initialize the global Bugwatch client.

    This sets up automatic exception capture for:
    - Uncaught exceptions in the main thread (sys.excepthook)
    - Uncaught exceptions in spawned threads (threading.excepthook)
    - Exceptions in asyncio tasks

    Args:
        api_key: Your Bugwatch API key. If not provided, reads from
                 BUGWATCH_API_KEY environment variable.
        endpoint: The Bugwatch API endpoint
        environment: The environment name (e.g., "production", "staging").
                     Can also be set via BUGWATCH_ENVIRONMENT env var.
        release: The release/version identifier.
                 Can also be set via BUGWATCH_RELEASE env var.
        debug: Enable debug logging
        install_excepthook: Install sys.excepthook for uncaught exceptions
        install_threading_hook: Install threading.excepthook (Python 3.8+)
        install_asyncio_hook: Install asyncio exception handler
        **kwargs: Additional options passed to BugwatchOptions

    Returns:
        The initialized client

    Raises:
        ValueError: If api_key is not provided and BUGWATCH_API_KEY is not set

    Example::

        # Using environment variable
        import os
        os.environ["BUGWATCH_API_KEY"] = "sk-xxx"

        import bugwatch
        bugwatch.init()  # Works without arguments

        # Or pass explicitly
        bugwatch.init(api_key="sk-xxx", environment="production")
    """
    global _client, _hooks_installed

    # Read from environment if not provided
    if api_key is None:
        api_key = os.environ.get("BUGWATCH_API_KEY")

    if api_key is None:
        raise ValueError(
            "api_key is required. Either pass it explicitly or set the "
            "BUGWATCH_API_KEY environment variable."
        )

    # Read optional config from environment
    if environment is None:
        environment = os.environ.get("BUGWATCH_ENVIRONMENT")

    if release is None:
        release = os.environ.get("BUGWATCH_RELEASE")

    options = BugwatchOptions(
        api_key=api_key,
        endpoint=endpoint,
        environment=environment,
        release=release,
        debug=debug,
        **kwargs,
    )

    _client = BugwatchClient(options)

    # Install exception hooks
    if not _hooks_installed:
        if install_excepthook:
            _install_excepthook()
            if debug:
                print("[Bugwatch] Installed sys.excepthook")

        if install_threading_hook:
            _install_threading_hook()
            if debug and sys.version_info >= (3, 8):
                print("[Bugwatch] Installed threading.excepthook")

        if install_asyncio_hook:
            _install_asyncio_hook()
            if debug:
                print("[Bugwatch] Installed asyncio exception handler")

        # Register atexit handler
        atexit.register(_atexit_handler)
        if debug:
            print("[Bugwatch] Registered atexit handler")

        _hooks_installed = True

    return _client


def get_client() -> Optional[BugwatchClient]:
    """
    Get the global Bugwatch client.

    Returns:
        The client or None if not initialized
    """
    return _client


def flush():
    """Flush any pending events to Bugwatch."""
    if _client is not None:
        if hasattr(_client.transport, 'flush'):
            _client.transport.flush()


def close():
    """Close the Bugwatch client and restore original hooks."""
    global _client

    flush()
    _uninstall_hooks()
    _client = None


def capture_exception(
    error: Optional[BaseException] = None,
    level: Level = Level.ERROR,
    tags: Optional[Dict[str, str]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Capture an exception and send it to Bugwatch.

    Args:
        error: The exception to capture. If None, captures current exception.
        level: The severity level
        tags: Additional tags for this event
        extra: Additional context data

    Returns:
        The event ID, or empty string if not initialized
    """
    if _client is None:
        return ""

    return _client.capture_exception(error, level, tags, extra)


def capture_message(
    message: str,
    level: Level = Level.INFO,
    tags: Optional[Dict[str, str]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Capture a message and send it to Bugwatch.

    Args:
        message: The message to capture
        level: The severity level
        tags: Additional tags for this event
        extra: Additional context data

    Returns:
        The event ID, or empty string if not initialized
    """
    if _client is None:
        return ""

    return _client.capture_message(message, level, tags, extra)


def add_breadcrumb(
    category: str,
    message: str,
    level: Level = Level.INFO,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Add a breadcrumb to the trail.

    Args:
        category: The breadcrumb category
        message: The breadcrumb message
        level: The severity level
        data: Additional data
    """
    if _client is None:
        return

    _client.add_breadcrumb(category, message, level, data)


def set_user(user: Optional[UserContext]) -> None:
    """
    Set the current user context.

    Args:
        user: The user context or None to clear
    """
    if _client is None:
        return

    _client.set_user(user)


def set_request(request: Optional[RequestContext]) -> None:
    """
    Set the current request context.

    Args:
        request: The request context or None to clear
    """
    if _client is None:
        return

    _client.set_request(request)


def set_tag(key: str, value: str) -> None:
    """
    Set a tag for all future events.

    Args:
        key: The tag key
        value: The tag value
    """
    if _client is None:
        return

    _client.set_tag(key, value)


def set_extra(key: str, value: Any) -> None:
    """
    Set extra context for all future events.

    Args:
        key: The extra key
        value: The extra value
    """
    if _client is None:
        return

    _client.set_extra(key, value)
