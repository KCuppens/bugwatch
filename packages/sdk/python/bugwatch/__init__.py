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

from .client import BugwatchClient, request_scope
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

__version__ = "0.2.1"
__all__ = [
    # Main functions
    "init",
    "init_from_env",
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
    "request_scope",
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

# Thread lock for thread-safe global state access
_lock = threading.Lock()

# Global client instance (protected by _lock)
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


def _bugwatch_task_done_callback(task):
    """Callback on every asyncio.Task — captures unhandled exceptions immediately."""
    if task.cancelled():
        return
    try:
        exc = task.exception()
    except (asyncio.CancelledError, asyncio.InvalidStateError):
        return
    if exc is None or _client is None:
        return
    if getattr(task, "_bugwatch_captured", False):
        return
    task._bugwatch_captured = True
    try:
        _client.capture_exception(
            exc,
            level=Level.ERROR,
            extra={
                "asyncio.task_name": getattr(task, "get_name", lambda: str(task))(),
                "asyncio.mechanism": "task_done_callback",
            },
        )
    except Exception:
        pass


_original_task_factory = None


def _bugwatch_task_factory(loop, coro, **kwargs):
    """Custom task factory that adds done callback to every task."""
    if _original_task_factory is not None:
        task = _original_task_factory(loop, coro, **kwargs)
    else:
        task = asyncio.tasks.Task(coro, loop=loop, **kwargs)
    task.add_done_callback(_bugwatch_task_done_callback)
    return task


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
    """Install asyncio exception handler AND task factory.

    The exception handler catches exceptions from tasks whose result is never
    retrieved (garbage-collected with unretreived exception). The task factory
    adds a done-callback to every task so we capture exceptions *immediately*
    when the task finishes, not on GC.

    If an event loop is already running, installs both immediately.
    Otherwise, patches asyncio.set_event_loop to install when a loop arrives.
    """
    global _original_asyncio_handler, _original_task_factory

    def _do_install(loop):
        global _original_asyncio_handler, _original_task_factory
        # Exception handler
        handler = loop.get_exception_handler()
        if handler is not _bugwatch_asyncio_handler:
            _original_asyncio_handler = handler
            loop.set_exception_handler(_bugwatch_asyncio_handler)
        # Task factory — capture exceptions immediately on task completion
        current_factory = loop.get_task_factory()
        if current_factory is not _bugwatch_task_factory:
            _original_task_factory = current_factory
            loop.set_task_factory(_bugwatch_task_factory)

    try:
        loop = asyncio.get_running_loop()
        _do_install(loop)
    except RuntimeError:
        # No running loop yet — patch the event loop policy so we install
        # when a loop is created and run.
        _original_run = asyncio.events.BaseDefaultEventLoopPolicy.set_event_loop

        def _patched_set_event_loop(self, loop):
            _original_run(self, loop)
            if loop is not None:
                try:
                    _do_install(loop)
                except Exception:
                    pass

        asyncio.events.BaseDefaultEventLoopPolicy.set_event_loop = _patched_set_event_loop


def _uninstall_hooks():
    """Restore original exception hooks."""
    global _hooks_installed, _original_task_factory

    if _original_excepthook:
        sys.excepthook = _original_excepthook

    if _original_threading_excepthook and sys.version_info >= (3, 8):
        threading.excepthook = _original_threading_excepthook

    # Restore asyncio task factory
    try:
        loop = asyncio.get_running_loop()
        if loop.get_task_factory() is _bugwatch_task_factory:
            loop.set_task_factory(_original_task_factory)
            _original_task_factory = None
    except RuntimeError:
        pass

    _hooks_installed = False


# =============================================================================
# Atexit Handler
# =============================================================================

def _atexit_handler():
    """Flush pending events and cleanup on shutdown with a timeout."""
    if _client is not None:
        try:
            # Use a thread-based timeout that works on all platforms
            def _flush():
                try:
                    if hasattr(_client.transport, 'flush'):
                        _client.transport.flush()
                except Exception:
                    pass

            flush_thread = threading.Thread(target=_flush, daemon=True)
            flush_thread.start()
            flush_thread.join(timeout=5.0)  # 5 second max
        except Exception:
            pass


# =============================================================================
# Public API
# =============================================================================

def _validate_api_key(key: Optional[str]) -> str:
    """
    Validate the API key format.

    Args:
        key: The API key to validate

    Returns:
        The validated API key

    Raises:
        ValueError: If the API key is not provided
    """
    if not key:
        raise ValueError(
            "Bugwatch: API key required. "
            "Set BUGWATCH_API_KEY environment variable or pass api_key parameter."
        )

    # Warn if key doesn't follow expected format
    if not key.startswith("bw_"):
        import warnings
        warnings.warn(
            f"Bugwatch: API key should start with 'bw_'. Got key starting with '{key[:3] if len(key) >= 3 else key}'",
            UserWarning,
            stacklevel=3,
        )

    return key


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

    # Validate and check API key format
    api_key = _validate_api_key(api_key)

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

    # Thread-safe initialization
    with _lock:
        # Prevent re-initialization if another thread already initialized
        if _client is not None:
            return _client

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

            # Register atexit handler (only once)
            atexit.register(_atexit_handler)
            if debug:
                print("[Bugwatch] Registered atexit handler")

            _hooks_installed = True

        return _client


def init_from_env() -> BugwatchClient:
    """
    Initialize Bugwatch from environment variables.

    This is a convenience function that reads all configuration from
    environment variables:
    - BUGWATCH_API_KEY - API key (required)
    - BUGWATCH_ENVIRONMENT - Environment name
    - BUGWATCH_RELEASE - Release version
    - BUGWATCH_DEBUG - Enable debug mode ('true')

    Returns:
        The initialized client

    Raises:
        ValueError: If BUGWATCH_API_KEY is not set

    Example::

        import bugwatch

        # Set environment variables before running:
        # export BUGWATCH_API_KEY=bw_live_xxxxx
        # export BUGWATCH_ENVIRONMENT=production

        bugwatch.init_from_env()
    """
    return init(
        api_key=os.environ.get("BUGWATCH_API_KEY"),
        environment=os.environ.get("BUGWATCH_ENVIRONMENT"),
        release=os.environ.get("BUGWATCH_RELEASE"),
        debug=os.environ.get("BUGWATCH_DEBUG", "").lower() == "true",
    )


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
    with _lock:
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
