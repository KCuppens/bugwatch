"""Logging integration for Bugwatch.

This module provides a logging.Handler that captures log records and sends
them to Bugwatch.

Usage::

    import logging
    from bugwatch.integrations.logging import BugwatchHandler

    # Add handler to root logger
    handler = BugwatchHandler(level=logging.ERROR)
    logging.getLogger().addHandler(handler)

    # Now logged errors will be captured by Bugwatch
    logging.error("Something went wrong")

    # Exceptions are captured with full traceback
    try:
        1 / 0
    except ZeroDivisionError:
        logging.exception("Division failed")
"""
import logging
from typing import Optional

import bugwatch
from bugwatch.types import Level


class BugwatchHandler(logging.Handler):
    """
    A logging handler that sends log records to Bugwatch.

    Log records at ERROR level or above are captured as exceptions (if exc_info
    is present) or messages. The handler respects the logging level set on it.

    Attributes:
        level_mapping: Maps Python logging levels to Bugwatch levels

    Example::

        import logging
        from bugwatch.integrations.logging import BugwatchHandler

        # Capture ERROR and above
        handler = BugwatchHandler(level=logging.ERROR)
        logging.getLogger().addHandler(handler)

        # Capture WARNING and above for a specific logger
        logger = logging.getLogger("myapp")
        logger.addHandler(BugwatchHandler(level=logging.WARNING))
    """

    level_mapping = {
        logging.DEBUG: Level.DEBUG,
        logging.INFO: Level.INFO,
        logging.WARNING: Level.WARNING,
        logging.ERROR: Level.ERROR,
        logging.CRITICAL: Level.FATAL,
    }

    def __init__(
        self,
        level: int = logging.ERROR,
        capture_breadcrumbs: bool = True,
        breadcrumb_level: int = logging.INFO,
    ):
        """
        Initialize the Bugwatch logging handler.

        Args:
            level: Minimum level for sending events to Bugwatch (default: ERROR)
            capture_breadcrumbs: If True, logs below the event level are
                                 captured as breadcrumbs
            breadcrumb_level: Minimum level for breadcrumb capture (default: INFO)
        """
        # Set handler level to breadcrumb level if capturing breadcrumbs,
        # so that emit() receives all logs we care about
        effective_level = breadcrumb_level if capture_breadcrumbs else level
        super().__init__(level=effective_level)
        self.event_level = level
        self.capture_breadcrumbs = capture_breadcrumbs
        self.breadcrumb_level = breadcrumb_level

    def emit(self, record: logging.LogRecord) -> None:
        """
        Emit a log record to Bugwatch.

        Args:
            record: The log record to emit
        """
        try:
            # Get Bugwatch level
            bugwatch_level = self._get_bugwatch_level(record.levelno)

            # If below event level, capture as breadcrumb
            if record.levelno < self.event_level:
                if self.capture_breadcrumbs and record.levelno >= self.breadcrumb_level:
                    self._add_breadcrumb(record, bugwatch_level)
                return

            # Build extra context
            extra = {
                "logger": record.name,
                "pathname": record.pathname,
                "lineno": record.lineno,
                "funcName": record.funcName,
            }

            # Add any extra attributes from the record
            if hasattr(record, "__dict__"):
                for key, value in record.__dict__.items():
                    if key not in (
                        "name", "msg", "args", "created", "filename",
                        "funcName", "levelname", "levelno", "lineno",
                        "module", "msecs", "pathname", "process",
                        "processName", "relativeCreated", "stack_info",
                        "exc_info", "exc_text", "thread", "threadName",
                        "message", "asctime",
                    ):
                        extra[key] = value

            # Build tags
            tags = {
                "logger.name": record.name,
                "logger.level": record.levelname,
            }

            # Capture exception if present
            if record.exc_info and record.exc_info[1] is not None:
                exc = record.exc_info[1]
                exc.__traceback__ = record.exc_info[2]
                bugwatch.capture_exception(
                    error=exc,
                    level=bugwatch_level,
                    tags=tags,
                    extra=extra,
                )
            else:
                # Capture as message
                message = self.format(record)
                bugwatch.capture_message(
                    message=message,
                    level=bugwatch_level,
                    tags=tags,
                    extra=extra,
                )

        except Exception:
            # Don't let logging errors crash the application
            self.handleError(record)

    def _add_breadcrumb(self, record: logging.LogRecord, level: Level) -> None:
        """Add a log record as a breadcrumb."""
        try:
            message = self.format(record) if self.formatter else record.getMessage()
            bugwatch.add_breadcrumb(
                category="logging",
                message=message,
                level=level,
                data={
                    "logger": record.name,
                    "level": record.levelname,
                },
            )
        except Exception:
            pass

    def _get_bugwatch_level(self, levelno: int) -> Level:
        """Map Python logging level to Bugwatch level."""
        if levelno >= logging.CRITICAL:
            return Level.FATAL
        elif levelno >= logging.ERROR:
            return Level.ERROR
        elif levelno >= logging.WARNING:
            return Level.WARNING
        elif levelno >= logging.INFO:
            return Level.INFO
        else:
            return Level.DEBUG


def setup_logging(
    level: int = logging.ERROR,
    capture_breadcrumbs: bool = True,
    breadcrumb_level: int = logging.INFO,
    logger: Optional[logging.Logger] = None,
) -> BugwatchHandler:
    """
    Convenience function to set up Bugwatch logging integration.

    Args:
        level: Minimum level for sending events to Bugwatch
        capture_breadcrumbs: Capture logs below level as breadcrumbs
        breadcrumb_level: Minimum level for breadcrumbs
        logger: Logger to attach to (default: root logger)

    Returns:
        The created handler

    Example::

        from bugwatch.integrations.logging import setup_logging

        # Quick setup - captures ERROR and above
        setup_logging()

        # Custom setup
        setup_logging(
            level=logging.WARNING,
            capture_breadcrumbs=True,
            breadcrumb_level=logging.DEBUG,
        )
    """
    handler = BugwatchHandler(
        level=level,
        capture_breadcrumbs=capture_breadcrumbs,
        breadcrumb_level=breadcrumb_level,
    )

    if logger is None:
        logger = logging.getLogger()

    logger.addHandler(handler)
    return handler
