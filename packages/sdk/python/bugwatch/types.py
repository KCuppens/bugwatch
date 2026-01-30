"""Type definitions for Bugwatch Python SDK."""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class Level(str, Enum):
    """Error severity level."""
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    FATAL = "fatal"


@dataclass
class StackFrame:
    """Represents a single frame in a stack trace."""
    filename: str
    function: str
    lineno: int
    colno: Optional[int] = None
    context_line: Optional[str] = None
    pre_context: Optional[List[str]] = None
    post_context: Optional[List[str]] = None
    in_app: bool = True
    module: Optional[str] = None
    vars: Optional[Dict[str, Any]] = None  # Local variables at this frame


@dataclass
class ExceptionInfo:
    """Information about an exception."""
    type: str
    value: str
    stacktrace: List[StackFrame] = field(default_factory=list)
    module: Optional[str] = None


@dataclass
class Breadcrumb:
    """A breadcrumb for tracking user actions and events."""
    category: str
    message: str
    type: str = "default"  # Breadcrumb type: default, http, navigation, error, etc.
    level: Level = Level.INFO
    timestamp: datetime = field(default_factory=datetime.utcnow)
    data: Optional[Dict[str, Any]] = None


@dataclass
class UserContext:
    """User information for error context."""
    id: Optional[str] = None
    email: Optional[str] = None
    username: Optional[str] = None
    ip_address: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


@dataclass
class RequestContext:
    """HTTP request information for error context."""
    url: Optional[str] = None
    method: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    query_string: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    cookies: Optional[Dict[str, str]] = None
    env: Optional[Dict[str, str]] = None


@dataclass
class RuntimeInfo:
    """Runtime environment information."""
    name: str
    version: str


@dataclass
class SdkInfo:
    """SDK information."""
    name: str
    version: str


@dataclass
class ErrorEvent:
    """Complete error event to send to Bugwatch."""
    event_id: str
    timestamp: datetime
    level: Level
    exception: Optional[ExceptionInfo] = None
    message: Optional[str] = None
    platform: str = "python"
    sdk: Optional[SdkInfo] = None
    runtime: Optional[RuntimeInfo] = None
    request: Optional[RequestContext] = None
    user: Optional[UserContext] = None
    tags: Dict[str, str] = field(default_factory=dict)
    extra: Dict[str, Any] = field(default_factory=dict)
    breadcrumbs: List[Breadcrumb] = field(default_factory=list)
    fingerprint: Optional[str] = None
    environment: Optional[str] = None
    release: Optional[str] = None
    server_name: Optional[str] = None


@dataclass
class BugwatchOptions:
    """Configuration options for the Bugwatch client."""
    api_key: str
    endpoint: str = "https://api.bugwatch.dev"
    environment: Optional[str] = None
    release: Optional[str] = None
    server_name: Optional[str] = None
    debug: bool = False
    max_breadcrumbs: int = 100
    sample_rate: float = 1.0
    attach_stacktrace: bool = True
    send_default_pii: bool = False
    before_send: Optional[callable] = None
    capture_locals: bool = False  # Capture local variables (may include sensitive data)
    max_value_length: int = 1024  # Max length for serialized variable values
