"""Tests for Bugwatch client."""
import pytest

from bugwatch import init, get_client, capture_exception, capture_message
from bugwatch.client import BugwatchClient
from bugwatch.transport import NoopTransport
from bugwatch.types import BugwatchOptions, Level, UserContext


class MockTransport(NoopTransport):
    """Mock transport that records sent events."""

    def __init__(self) -> None:
        self.events: list = []

    def send(self, event) -> bool:
        self.events.append(event)
        return True


class TestBugwatchClient:
    """Tests for BugwatchClient class."""

    def setup_method(self) -> None:
        """Set up test fixtures."""
        self.options = BugwatchOptions(
            api_key="test-api-key",
            environment="test",
        )
        self.transport = MockTransport()
        self.client = BugwatchClient(self.options, self.transport)

    def test_capture_exception(self) -> None:
        """Should capture and send exception."""
        try:
            raise ValueError("test error")
        except ValueError:
            event_id = self.client.capture_exception()

        assert event_id != ""
        assert len(self.transport.events) == 1

        event = self.transport.events[0]
        assert event.exception is not None
        assert event.exception.type == "ValueError"
        assert event.exception.value == "test error"
        assert event.level == Level.ERROR

    def test_capture_exception_with_error(self) -> None:
        """Should capture passed exception."""
        error = RuntimeError("explicit error")
        error.__traceback__ = None  # Simulate no traceback

        event_id = self.client.capture_exception(error)

        # Even without traceback, it should capture
        assert len(self.transport.events) == 1
        event = self.transport.events[0]
        assert event.exception.type == "RuntimeError"
        assert event.exception.value == "explicit error"

    def test_capture_message(self) -> None:
        """Should capture and send message."""
        event_id = self.client.capture_message("test message", Level.INFO)

        assert event_id != ""
        assert len(self.transport.events) == 1

        event = self.transport.events[0]
        assert event.message == "test message"
        assert event.level == Level.INFO

    def test_breadcrumbs(self) -> None:
        """Should track breadcrumbs."""
        self.client.add_breadcrumb("http", "GET /api/users", Level.INFO)
        self.client.add_breadcrumb("ui", "Button clicked", Level.DEBUG)

        self.client.capture_message("test")

        event = self.transport.events[0]
        assert len(event.breadcrumbs) == 2
        assert event.breadcrumbs[0].category == "http"
        assert event.breadcrumbs[1].category == "ui"

    def test_max_breadcrumbs(self) -> None:
        """Should limit breadcrumbs to max_breadcrumbs."""
        self.options.max_breadcrumbs = 5
        self.client = BugwatchClient(self.options, self.transport)

        for i in range(10):
            self.client.add_breadcrumb("test", f"breadcrumb {i}")

        self.client.capture_message("test")

        event = self.transport.events[0]
        assert len(event.breadcrumbs) == 5
        # Should keep the last 5
        assert event.breadcrumbs[0].message == "breadcrumb 5"

    def test_user_context(self) -> None:
        """Should include user context in events."""
        self.client.set_user(UserContext(
            id="user-123",
            email="test@example.com",
            username="testuser",
        ))

        self.client.capture_message("test")

        event = self.transport.events[0]
        assert event.user is not None
        assert event.user.id == "user-123"
        assert event.user.email == "test@example.com"

    def test_tags(self) -> None:
        """Should include tags in events."""
        self.client.set_tag("version", "1.0.0")
        self.client.set_tag("feature", "checkout")

        self.client.capture_message("test")

        event = self.transport.events[0]
        assert event.tags["version"] == "1.0.0"
        assert event.tags["feature"] == "checkout"

    def test_extra_context(self) -> None:
        """Should include extra context in events."""
        self.client.set_extra("request_id", "abc-123")
        self.client.set_extra("order", {"id": 1, "total": 100})

        self.client.capture_message("test")

        event = self.transport.events[0]
        assert event.extra["request_id"] == "abc-123"
        assert event.extra["order"]["id"] == 1

    def test_sample_rate(self) -> None:
        """Should respect sample_rate."""
        self.options.sample_rate = 0.0  # Never sample
        self.client = BugwatchClient(self.options, self.transport)

        for _ in range(10):
            self.client.capture_message("test")

        assert len(self.transport.events) == 0

    def test_before_send_hook(self) -> None:
        """Should call before_send hook."""
        def before_send(event):
            event.tags["modified"] = "true"
            return event

        self.options.before_send = before_send
        self.client = BugwatchClient(self.options, self.transport)

        self.client.capture_message("test")

        event = self.transport.events[0]
        assert event.tags["modified"] == "true"

    def test_before_send_can_drop_event(self) -> None:
        """before_send returning None should drop event."""
        def before_send(event):
            return None

        self.options.before_send = before_send
        self.client = BugwatchClient(self.options, self.transport)

        event_id = self.client.capture_message("test")

        assert event_id == ""
        assert len(self.transport.events) == 0


class TestGlobalFunctions:
    """Tests for global convenience functions."""

    def setup_method(self) -> None:
        """Reset global client."""
        import bugwatch
        bugwatch._client = None

    def test_init_returns_client(self) -> None:
        """init should return a client."""
        client = init(api_key="test-key")
        assert isinstance(client, BugwatchClient)

    def test_get_client_returns_initialized_client(self) -> None:
        """get_client should return the initialized client."""
        init(api_key="test-key")
        client = get_client()
        assert client is not None

    def test_capture_without_init_returns_empty(self) -> None:
        """capture_exception without init should return empty string."""
        result = capture_exception(ValueError("test"))
        assert result == ""

    def test_capture_message_without_init_returns_empty(self) -> None:
        """capture_message without init should return empty string."""
        result = capture_message("test")
        assert result == ""
