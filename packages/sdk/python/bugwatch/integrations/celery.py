"""Standalone Celery integration for Bugwatch Python SDK.

This integration works with any Python/Celery project (Flask, FastAPI, Django, etc.).
"""
from typing import Any, Dict, Optional, Set

from .. import get_client
from ..types import Level


# Track if integration has been set up to prevent duplicate handlers
_celery_integration_setup: bool = False

# Sensitive parameter names to filter from args/kwargs
SENSITIVE_KEYS: Set[str] = {
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_token",
    "auth_token",
    "credentials",
    "private_key",
    "credit_card",
    "card_number",
    "cvv",
    "ssn",
}


def _filter_sensitive_data(data: Any, depth: int = 0) -> Any:
    """Filter sensitive data from task arguments.

    Args:
        data: The data to filter (can be dict, list, or primitive).
        depth: Current recursion depth to prevent infinite loops.

    Returns:
        Filtered data with sensitive values replaced by '[Filtered]'.
    """
    if depth > 10:
        return "[Truncated - max depth]"

    if isinstance(data, dict):
        filtered = {}
        for key, value in data.items():
            key_lower = str(key).lower()
            if any(sensitive in key_lower for sensitive in SENSITIVE_KEYS):
                filtered[key] = "[Filtered]"
            else:
                filtered[key] = _filter_sensitive_data(value, depth + 1)
        return filtered
    elif isinstance(data, (list, tuple)):
        return [_filter_sensitive_data(item, depth + 1) for item in data]
    else:
        return data


def _safe_repr(value: Any, max_length: int = 200) -> str:
    """Safely convert a value to string representation.

    Args:
        value: Value to convert.
        max_length: Maximum length of the resulting string.

    Returns:
        String representation, truncated if necessary.
    """
    try:
        result = repr(value)
        if len(result) > max_length:
            return result[: max_length - 3] + "..."
        return result
    except Exception:
        return "<unrepresentable>"


class CeleryIntegration:
    """
    Standalone Celery integration for any Python project.

    This integration captures task failures, retries, and adds breadcrumbs
    for task lifecycle events.

    Usage::

        from celery import Celery
        from bugwatch import init
        from bugwatch.integrations.celery import CeleryIntegration

        app = Celery('myapp')
        init(api_key='your-api-key', environment='production')
        CeleryIntegration.setup(app)

    Note:
        Celery signals are global and not tied to a specific app instance.
        The celery_app parameter is accepted for API consistency but the
        integration will capture events from all Celery apps in the process.
    """

    @staticmethod
    def setup(celery_app: Any = None) -> None:
        """Set up Celery signal handlers for error tracking.

        Args:
            celery_app: The Celery application instance (optional, kept for
                       API consistency). Celery signals are global, so the
                       integration captures events from all apps.

        Note:
            This method is idempotent - calling it multiple times will only
            register the signal handlers once.
        """
        global _celery_integration_setup

        if _celery_integration_setup:
            return

        from celery.signals import (
            task_failure,
            task_postrun,
            task_prerun,
            task_retry,
        )

        @task_failure.connect
        def handle_task_failure(
            sender: Any = None,
            task_id: Optional[str] = None,
            exception: Optional[Exception] = None,
            args: Optional[tuple] = None,
            kwargs: Optional[Dict[str, Any]] = None,
            traceback: Any = None,
            einfo: Any = None,
            **kw: Any,
        ) -> None:
            """Capture failed task exceptions."""
            try:
                client = get_client()
                if client is None or exception is None:
                    return

                # Get task metadata
                task_name = sender.name if sender else "unknown"
                task_id_str = task_id or "unknown"

                # Extract additional task info
                extra_data: Dict[str, Any] = {}

                # Filter and include task arguments
                if args:
                    extra_data["celery.args"] = _filter_sensitive_data(list(args))
                if kwargs:
                    extra_data["celery.kwargs"] = _filter_sensitive_data(kwargs)

                # Get queue and retry info from request if available
                if sender and hasattr(sender, "request"):
                    request = sender.request
                    if hasattr(request, "delivery_info"):
                        delivery_info = request.delivery_info
                        if delivery_info and "routing_key" in delivery_info:
                            extra_data["celery.queue"] = delivery_info.get("routing_key")
                    if hasattr(request, "retries"):
                        extra_data["celery.retries"] = request.retries

                client.capture_exception(
                    exception,
                    level=Level.ERROR,
                    tags={
                        "mechanism": "celery.task_failure",
                        "celery.task_name": task_name,
                        "celery.task_id": task_id_str,
                    },
                    extra=extra_data,
                )
            except Exception:
                # Never let our handler cause task issues
                pass

        @task_retry.connect
        def handle_task_retry(
            sender: Any = None,
            reason: Any = None,
            request: Any = None,
            **kw: Any,
        ) -> None:
            """Add breadcrumb when task is retried."""
            try:
                client = get_client()
                if client is None:
                    return

                task_name = sender.name if sender else "unknown"
                task_id = request.id if request and hasattr(request, "id") else "unknown"
                retries = request.retries if request and hasattr(request, "retries") else 0

                client.add_breadcrumb(
                    category="celery",
                    message=f"Task {task_name} retrying (attempt {retries + 1})",
                    level=Level.WARNING,
                    breadcrumb_type="task",
                    data={
                        "task_id": task_id,
                        "task_name": task_name,
                        "reason": _safe_repr(reason) if reason else None,
                        "retry_count": retries,
                    },
                )
            except Exception:
                # Never let our handler cause task issues
                pass

        @task_prerun.connect
        def handle_task_prerun(
            sender: Any = None,
            task_id: Optional[str] = None,
            task: Any = None,
            args: Optional[tuple] = None,
            kwargs: Optional[Dict[str, Any]] = None,
            **kw: Any,
        ) -> None:
            """Add breadcrumb when task starts."""
            try:
                client = get_client()
                if client is None:
                    return

                task_name = sender.name if sender else "unknown"

                client.add_breadcrumb(
                    category="celery",
                    message=f"Task {task_name} started",
                    level=Level.INFO,
                    breadcrumb_type="task",
                    data={
                        "task_id": task_id or "unknown",
                        "task_name": task_name,
                    },
                )
            except Exception:
                # Never let our handler cause task issues
                pass

        @task_postrun.connect
        def handle_task_postrun(
            sender: Any = None,
            task_id: Optional[str] = None,
            task: Any = None,
            args: Optional[tuple] = None,
            kwargs: Optional[Dict[str, Any]] = None,
            retval: Any = None,
            state: Optional[str] = None,
            **kw: Any,
        ) -> None:
            """Add breadcrumb when task completes."""
            try:
                client = get_client()
                if client is None:
                    return

                task_name = sender.name if sender else "unknown"

                # Determine log level based on task state
                level = Level.INFO if state == "SUCCESS" else Level.WARNING

                client.add_breadcrumb(
                    category="celery",
                    message=f"Task {task_name} completed with state: {state or 'unknown'}",
                    level=level,
                    breadcrumb_type="task",
                    data={
                        "task_id": task_id or "unknown",
                        "task_name": task_name,
                        "state": state,
                    },
                )
            except Exception:
                # Never let our handler cause task issues
                pass

        _celery_integration_setup = True


def init_celery(celery_app: Any) -> None:
    """Convenience function to set up Celery integration.

    This is an alias for CeleryIntegration.setup().

    Args:
        celery_app: The Celery application instance.

    Usage::

        from bugwatch.integrations.celery import init_celery
        init_celery(app)
    """
    CeleryIntegration.setup(celery_app)
