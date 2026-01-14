"""Tests for exception hooks and plug-and-play features."""
import logging
import os
import sys
import threading
from unittest.mock import MagicMock, patch

import pytest

import bugwatch
from bugwatch import Level
from bugwatch.integrations.logging import BugwatchHandler, setup_logging
from bugwatch.transport import NoopTransport


class TestEnvironmentVariables:
    """Tests for environment variable configuration."""

    def teardown_method(self):
        """Clean up after each test."""
        bugwatch.close()
        # Clean up env vars
        for key in ["BUGWATCH_API_KEY", "BUGWATCH_ENVIRONMENT", "BUGWATCH_RELEASE"]:
            if key in os.environ:
                del os.environ[key]

    def test_init_from_env_var(self) -> None:
        """Should initialize from BUGWATCH_API_KEY environment variable."""
        os.environ["BUGWATCH_API_KEY"] = "test-key-from-env"

        client = bugwatch.init()

        assert client is not None
        assert client.options.api_key == "test-key-from-env"

    def test_init_without_api_key_raises(self) -> None:
        """Should raise ValueError if no API key provided."""
        with pytest.raises(ValueError) as exc_info:
            bugwatch.init()

        assert "api_key is required" in str(exc_info.value)
        assert "BUGWATCH_API_KEY" in str(exc_info.value)

    def test_explicit_api_key_overrides_env(self) -> None:
        """Explicit api_key should override environment variable."""
        os.environ["BUGWATCH_API_KEY"] = "env-key"

        client = bugwatch.init(api_key="explicit-key")

        assert client.options.api_key == "explicit-key"

    def test_environment_from_env_var(self) -> None:
        """Should read environment from BUGWATCH_ENVIRONMENT."""
        os.environ["BUGWATCH_API_KEY"] = "test-key"
        os.environ["BUGWATCH_ENVIRONMENT"] = "production"

        client = bugwatch.init()

        assert client.options.environment == "production"

    def test_release_from_env_var(self) -> None:
        """Should read release from BUGWATCH_RELEASE."""
        os.environ["BUGWATCH_API_KEY"] = "test-key"
        os.environ["BUGWATCH_RELEASE"] = "1.0.0"

        client = bugwatch.init()

        assert client.options.release == "1.0.0"


class TestExceptHook:
    """Tests for sys.excepthook integration."""

    def setup_method(self):
        """Store original excepthook."""
        self.original_excepthook = sys.excepthook

    def teardown_method(self):
        """Restore original excepthook and clean up."""
        sys.excepthook = self.original_excepthook
        bugwatch.close()

    def test_excepthook_installed_by_default(self) -> None:
        """init() should install sys.excepthook by default."""
        bugwatch.init(api_key="test-key")

        assert sys.excepthook is not self.original_excepthook

    def test_excepthook_not_installed_when_disabled(self) -> None:
        """Should not install excepthook when install_excepthook=False."""
        bugwatch.init(api_key="test-key", install_excepthook=False)

        assert sys.excepthook is self.original_excepthook

    def test_excepthook_captures_exception(self) -> None:
        """Excepthook should capture exceptions."""
        captured_events = []

        class MockTransport:
            def send(self, event):
                captured_events.append(event)

        client = bugwatch.init(api_key="test-key")
        client.transport = MockTransport()

        # Simulate uncaught exception
        try:
            raise ValueError("Test uncaught exception")
        except ValueError:
            exc_info = sys.exc_info()
            sys.excepthook(exc_info[0], exc_info[1], exc_info[2])

        assert len(captured_events) == 1
        assert captured_events[0].exception.type == "ValueError"
        assert captured_events[0].level == Level.FATAL

    def test_close_restores_original_excepthook(self) -> None:
        """close() should restore the original excepthook."""
        bugwatch.init(api_key="test-key")
        assert sys.excepthook is not self.original_excepthook

        bugwatch.close()

        assert sys.excepthook is self.original_excepthook


class TestThreadingHook:
    """Tests for threading.excepthook integration."""

    def setup_method(self):
        """Store original threading hook if available."""
        # Make sure any previous bugwatch is closed first
        bugwatch.close()
        if sys.version_info >= (3, 8):
            self.original_threading_hook = threading.excepthook
        else:
            self.original_threading_hook = None

    def teardown_method(self):
        """Restore original hook and clean up."""
        bugwatch.close()
        if sys.version_info >= (3, 8) and self.original_threading_hook:
            threading.excepthook = self.original_threading_hook

    @pytest.mark.skipif(sys.version_info < (3, 8), reason="Requires Python 3.8+")
    def test_threading_hook_installed_by_default(self) -> None:
        """init() should install threading.excepthook on Python 3.8+."""
        bugwatch.init(api_key="test-key")

        assert threading.excepthook is not self.original_threading_hook

    @pytest.mark.skipif(sys.version_info < (3, 8), reason="Requires Python 3.8+")
    def test_threading_hook_not_installed_when_disabled(self) -> None:
        """Should not install threading hook when disabled."""
        # Store current hook before init (since setup already restored it)
        current_hook = threading.excepthook
        bugwatch.init(api_key="test-key", install_threading_hook=False)

        # Hook should not have changed
        assert threading.excepthook is current_hook


class TestLoggingHandler:
    """Tests for BugwatchHandler logging integration."""

    def setup_method(self):
        """Set up test logger."""
        self.logger = logging.getLogger("test_bugwatch")
        self.logger.handlers = []
        self.logger.setLevel(logging.DEBUG)

    def teardown_method(self):
        """Clean up logger and bugwatch."""
        self.logger.handlers = []
        bugwatch.close()

    def test_handler_captures_error_logs(self) -> None:
        """Handler should capture ERROR level logs."""
        captured_events = []

        class MockTransport:
            def send(self, event):
                captured_events.append(event)

        bugwatch.init(api_key="test-key")
        bugwatch.get_client().transport = MockTransport()

        handler = BugwatchHandler(level=logging.ERROR)
        self.logger.addHandler(handler)

        self.logger.error("Test error message")

        assert len(captured_events) == 1
        assert "Test error message" in captured_events[0].message

    def test_handler_ignores_below_level(self) -> None:
        """Handler should ignore logs below its level."""
        captured_events = []

        class MockTransport:
            def send(self, event):
                captured_events.append(event)

        bugwatch.init(api_key="test-key")
        bugwatch.get_client().transport = MockTransport()

        handler = BugwatchHandler(level=logging.ERROR)
        self.logger.addHandler(handler)

        self.logger.warning("Test warning")
        self.logger.info("Test info")

        assert len(captured_events) == 0

    def test_handler_captures_exception_with_traceback(self) -> None:
        """Handler should capture exceptions with full traceback."""
        captured_events = []

        class MockTransport:
            def send(self, event):
                captured_events.append(event)

        bugwatch.init(api_key="test-key")
        bugwatch.get_client().transport = MockTransport()

        handler = BugwatchHandler(level=logging.ERROR)
        self.logger.addHandler(handler)

        try:
            raise ValueError("Test exception")
        except ValueError:
            self.logger.exception("Caught an exception")

        assert len(captured_events) == 1
        assert captured_events[0].exception is not None
        assert captured_events[0].exception.type == "ValueError"

    def test_handler_adds_breadcrumbs(self) -> None:
        """Handler should add logs as breadcrumbs when enabled."""
        bugwatch.init(api_key="test-key")
        client = bugwatch.get_client()

        handler = BugwatchHandler(
            level=logging.ERROR,
            capture_breadcrumbs=True,
            breadcrumb_level=logging.INFO,
        )
        self.logger.addHandler(handler)

        # This should be added as breadcrumb, not event
        self.logger.info("Info breadcrumb")
        self.logger.warning("Warning breadcrumb")

        # Check breadcrumbs were added
        assert len(client._breadcrumbs) >= 2

    def test_setup_logging_convenience_function(self) -> None:
        """setup_logging() should set up handler correctly."""
        bugwatch.init(api_key="test-key")

        handler = setup_logging(
            level=logging.WARNING,
            logger=self.logger,
        )

        assert handler in self.logger.handlers
        assert handler.event_level == logging.WARNING


class TestFlushAndClose:
    """Tests for flush() and close() functions."""

    def teardown_method(self):
        """Clean up."""
        bugwatch.close()

    def test_flush_calls_transport_flush(self) -> None:
        """flush() should call transport.flush() if available."""
        flush_called = False

        class MockTransport:
            def send(self, event):
                pass

            def flush(self):
                nonlocal flush_called
                flush_called = True

        bugwatch.init(api_key="test-key")
        bugwatch.get_client().transport = MockTransport()

        bugwatch.flush()

        assert flush_called

    def test_close_cleans_up(self) -> None:
        """close() should clean up client and hooks."""
        bugwatch.init(api_key="test-key")
        assert bugwatch.get_client() is not None

        bugwatch.close()

        assert bugwatch.get_client() is None


class TestNewPublicAPI:
    """Tests for new public API functions (flush, close)."""

    def teardown_method(self):
        """Clean up."""
        bugwatch.close()

    def test_flush_exported(self) -> None:
        """flush should be exported in __all__."""
        assert "flush" in bugwatch.__all__

    def test_close_exported(self) -> None:
        """close should be exported in __all__."""
        assert "close" in bugwatch.__all__
