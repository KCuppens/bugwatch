"""Bugwatch client for capturing and sending error events."""
import platform
import socket
import sys
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .fingerprint import fingerprint_from_exception
from .transport import HttpTransport, Transport
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

SDK_NAME = "bugwatch-python"
SDK_VERSION = "0.1.0"


class BugwatchClient:
    """Main Bugwatch client for error tracking."""

    def __init__(
        self,
        options: BugwatchOptions,
        transport: Optional[Transport] = None
    ):
        """
        Initialize the Bugwatch client.

        Args:
            options: Configuration options
            transport: Optional custom transport
        """
        self.options = options
        self.transport = transport or HttpTransport(options)
        self._breadcrumbs: List[Breadcrumb] = []
        self._user: Optional[UserContext] = None
        self._request: Optional[RequestContext] = None
        self._tags: Dict[str, str] = {}
        self._extra: Dict[str, Any] = {}

        # Set default tags
        self._tags["runtime"] = "python"
        self._tags["runtime.version"] = platform.python_version()
        self._tags["os.platform"] = sys.platform
        self._tags["os.name"] = platform.system()

        if options.environment:
            self._tags["environment"] = options.environment

        if options.debug:
            print(f"[Bugwatch] Python SDK initialized")

    def capture_exception(
        self,
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
            The event ID
        """
        if error is None:
            exc_info = sys.exc_info()
            if exc_info[0] is not None:
                error = exc_info[1]
            else:
                return ""

        if error is None:
            return ""

        # Apply sample rate
        if self.options.sample_rate < 1.0:
            import random
            if random.random() > self.options.sample_rate:
                return ""

        # Extract exception info
        exception_info = self._extract_exception(error)

        # Create event
        event = self._create_event(
            level=level,
            exception=exception_info,
            tags=tags,
            extra=extra,
        )

        # Generate fingerprint
        event.fingerprint = fingerprint_from_exception(exception_info)

        # Apply before_send hook
        if self.options.before_send:
            event = self.options.before_send(event)
            if event is None:
                return ""

        # Send event
        self.transport.send(event)

        return event.event_id

    def capture_message(
        self,
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
            The event ID
        """
        # Apply sample rate
        if self.options.sample_rate < 1.0:
            import random
            if random.random() > self.options.sample_rate:
                return ""

        # Create event
        event = self._create_event(
            level=level,
            message=message,
            tags=tags,
            extra=extra,
        )

        # Apply before_send hook
        if self.options.before_send:
            event = self.options.before_send(event)
            if event is None:
                return ""

        # Send event
        self.transport.send(event)

        return event.event_id

    def add_breadcrumb(
        self,
        category: str,
        message: str,
        level: Level = Level.INFO,
        data: Optional[Dict[str, Any]] = None,
        breadcrumb_type: str = "default",
    ) -> None:
        """
        Add a breadcrumb to the trail.

        Args:
            category: The breadcrumb category
            message: The breadcrumb message
            level: The severity level
            data: Additional data
            breadcrumb_type: The breadcrumb type (default, http, navigation, etc.)
        """
        breadcrumb = Breadcrumb(
            category=category,
            message=message,
            type=breadcrumb_type,
            level=level,
            timestamp=datetime.now(timezone.utc),
            data=data,
        )

        self._breadcrumbs.append(breadcrumb)

        # Limit breadcrumbs
        if len(self._breadcrumbs) > self.options.max_breadcrumbs:
            self._breadcrumbs = self._breadcrumbs[-self.options.max_breadcrumbs:]

    def set_user(self, user: Optional[UserContext]) -> None:
        """
        Set the current user context.

        Args:
            user: The user context or None to clear
        """
        self._user = user

    def set_request(self, request: Optional[RequestContext]) -> None:
        """
        Set the current request context.

        Args:
            request: The request context or None to clear
        """
        self._request = request

    def set_tag(self, key: str, value: str) -> None:
        """
        Set a tag for all future events.

        Args:
            key: The tag key
            value: The tag value
        """
        self._tags[key] = value

    def set_extra(self, key: str, value: Any) -> None:
        """
        Set extra context for all future events.

        Args:
            key: The extra key
            value: The extra value
        """
        self._extra[key] = value

    def clear_breadcrumbs(self) -> None:
        """Clear all breadcrumbs."""
        self._breadcrumbs = []

    def _create_event(
        self,
        level: Level,
        exception: Optional[ExceptionInfo] = None,
        message: Optional[str] = None,
        tags: Optional[Dict[str, str]] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> ErrorEvent:
        """Create an error event."""
        event_id = uuid.uuid4().hex

        # Merge tags and extra
        merged_tags = {**self._tags}
        if tags:
            merged_tags.update(tags)

        merged_extra = {**self._extra}
        if extra:
            merged_extra.update(extra)

        # Ensure message is never None (server requires it)
        final_message = message
        if final_message is None and exception:
            final_message = f"{exception.type}: {exception.value}"
        elif final_message is None:
            final_message = ""

        return ErrorEvent(
            event_id=event_id,
            timestamp=datetime.now(timezone.utc),
            level=level,
            exception=exception,
            message=final_message,
            platform="python",
            sdk=SdkInfo(name=SDK_NAME, version=SDK_VERSION),
            runtime=RuntimeInfo(name="python", version=platform.python_version()),
            request=self._request,
            user=self._user,
            tags=merged_tags,
            extra=merged_extra,
            breadcrumbs=list(self._breadcrumbs),
            environment=self.options.environment,
            release=self.options.release,
            server_name=self.options.server_name or socket.gethostname(),
        )

    def _extract_exception(self, error: BaseException) -> ExceptionInfo:
        """Extract exception information from an error."""
        # Get the traceback
        tb = error.__traceback__
        frames = []

        while tb is not None:
            frame = tb.tb_frame
            lineno = tb.tb_lineno
            filename = frame.f_code.co_filename

            # Determine if this is app code
            in_app = self._is_in_app(filename)

            # Get context lines
            context_line = None
            pre_context = []
            post_context = []

            try:
                import linecache
                context_line = linecache.getline(filename, lineno).rstrip()
                for i in range(max(1, lineno - 3), lineno):
                    line = linecache.getline(filename, i)
                    if line:
                        pre_context.append(line.rstrip())
                for i in range(lineno + 1, lineno + 4):
                    line = linecache.getline(filename, i)
                    if line:
                        post_context.append(line.rstrip())
            except Exception:
                pass

            # Capture local variables if enabled
            local_vars = None
            if self.options.capture_locals and in_app:
                local_vars = self._extract_locals(frame.f_locals)

            frames.append(StackFrame(
                filename=filename,
                function=frame.f_code.co_name,
                lineno=lineno,
                colno=0,  # Python traceback doesn't have column numbers
                context_line=context_line or None,
                pre_context=pre_context or None,
                post_context=post_context or None,
                in_app=in_app,
                module=frame.f_globals.get("__name__"),
                vars=local_vars,
            ))

            tb = tb.tb_next

        return ExceptionInfo(
            type=type(error).__name__,
            value=str(error),
            stacktrace=frames,
            module=type(error).__module__,
        )

    def _is_in_app(self, filename: str) -> bool:
        """Determine if a filename is from app code."""
        # Skip standard library and site-packages
        if "site-packages" in filename:
            return False
        if filename.startswith("<"):
            return False

        # Check for Python standard library paths
        stdlib_paths = [
            sys.prefix,
            sys.base_prefix,
        ]
        for path in stdlib_paths:
            if filename.startswith(path):
                if "site-packages" not in filename:
                    return False

        return True

    def _extract_locals(self, local_vars: dict) -> Dict[str, Any]:
        """Extract and serialize local variables safely."""
        result = {}
        max_len = self.options.max_value_length

        # Variables to skip (internal Python/framework stuff)
        skip_prefixes = ('_', '__')
        skip_names = {'self', 'cls', 'request', 'response', 'environ'}

        for name, value in local_vars.items():
            # Skip private/internal variables
            if any(name.startswith(p) for p in skip_prefixes):
                continue
            # Skip common framework objects (too large)
            if name in skip_names:
                continue

            try:
                result[name] = self._serialize_value(value, max_len)
            except Exception:
                result[name] = "<serialization error>"

        return result if result else None

    def _serialize_value(self, value: Any, max_len: int, depth: int = 0) -> Any:
        """Serialize a value safely for JSON transport."""
        if depth > 3:  # Prevent deep recursion
            return "<max depth>"

        # Handle None
        if value is None:
            return None

        # Handle primitives
        if isinstance(value, (bool, int, float)):
            return value

        # Handle strings
        if isinstance(value, str):
            if len(value) > max_len:
                return value[:max_len] + "..."
            return value

        # Handle bytes
        if isinstance(value, bytes):
            try:
                decoded = value.decode('utf-8', errors='replace')
                if len(decoded) > max_len:
                    return decoded[:max_len] + "..."
                return decoded
            except Exception:
                return f"<bytes len={len(value)}>"

        # Handle lists/tuples
        if isinstance(value, (list, tuple)):
            if len(value) > 10:
                items = [self._serialize_value(v, max_len, depth + 1) for v in value[:10]]
                return items + [f"... and {len(value) - 10} more"]
            return [self._serialize_value(v, max_len, depth + 1) for v in value]

        # Handle dicts
        if isinstance(value, dict):
            if len(value) > 10:
                result = {k: self._serialize_value(v, max_len, depth + 1)
                          for k, v in list(value.items())[:10]}
                result["..."] = f"{len(value) - 10} more keys"
                return result
            return {str(k): self._serialize_value(v, max_len, depth + 1)
                    for k, v in value.items()}

        # Handle sets
        if isinstance(value, (set, frozenset)):
            return self._serialize_value(list(value), max_len, depth)

        # Handle objects with __dict__
        if hasattr(value, '__dict__'):
            type_name = type(value).__name__
            return f"<{type_name}>"

        # Default: try str()
        try:
            str_val = str(value)
            if len(str_val) > max_len:
                return str_val[:max_len] + "..."
            return str_val
        except Exception:
            return f"<{type(value).__name__}>"
