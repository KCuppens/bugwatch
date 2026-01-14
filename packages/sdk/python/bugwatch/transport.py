"""HTTP transport for sending error events to Bugwatch."""
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import asdict
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .types import BugwatchOptions, ErrorEvent

logger = logging.getLogger("bugwatch")


class Transport(ABC):
    """Base transport class for sending events."""

    @abstractmethod
    def send(self, event: ErrorEvent) -> bool:
        """Send an event to Bugwatch."""
        pass


class HttpTransport(Transport):
    """HTTP transport using urllib (no external dependencies)."""

    def __init__(self, options: BugwatchOptions):
        self.options = options
        self.endpoint = f"{options.endpoint.rstrip('/')}/api/v1/events"

    def send(self, event: ErrorEvent) -> bool:
        """
        Send an event to the Bugwatch API.

        Args:
            event: The error event to send

        Returns:
            True if the event was sent successfully
        """
        try:
            payload = self._serialize_event(event)

            request = Request(
                self.endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.options.api_key}",
                    "User-Agent": "bugwatch-python/0.1.0",
                },
                method="POST"
            )

            with urlopen(request, timeout=10) as response:
                if response.status in (200, 201, 202):
                    if self.options.debug:
                        logger.debug(f"Event sent successfully: {event.event_id}")
                    return True
                else:
                    logger.warning(f"Failed to send event: HTTP {response.status}")
                    return False

        except HTTPError as e:
            logger.error(f"HTTP error sending event: {e.code} {e.reason}")
            return False
        except URLError as e:
            logger.error(f"URL error sending event: {e.reason}")
            return False
        except Exception as e:
            logger.error(f"Error sending event: {e}")
            return False

    def _serialize_event(self, event: ErrorEvent) -> Dict[str, Any]:
        """Serialize an event to a JSON-compatible dict."""
        from enum import Enum
        data = asdict(event)

        # Convert datetime/enum objects and remove None values
        def convert_and_clean(obj: Any) -> Any:
            if isinstance(obj, datetime):
                return obj.isoformat()
            elif isinstance(obj, Enum):
                return obj.value  # Convert enum to its string value
            elif isinstance(obj, dict):
                # Remove None values and recursively process
                return {k: convert_and_clean(v) for k, v in obj.items() if v is not None}
            elif isinstance(obj, list):
                return [convert_and_clean(item) for item in obj]
            return obj

        return convert_and_clean(data)


class AsyncHttpTransport(Transport):
    """Async HTTP transport using httpx (optional dependency)."""

    def __init__(self, options: BugwatchOptions):
        self.options = options
        self.endpoint = f"{options.endpoint.rstrip('/')}/api/v1/events"
        self._client: Optional[Any] = None

    async def _get_client(self) -> Any:
        """Get or create the httpx client."""
        if self._client is None:
            try:
                import httpx
                self._client = httpx.AsyncClient(timeout=10.0)
            except ImportError:
                raise ImportError(
                    "httpx is required for async transport. "
                    "Install it with: pip install bugwatch-sdk[async]"
                )
        return self._client

    async def send_async(self, event: ErrorEvent) -> bool:
        """
        Send an event asynchronously.

        Args:
            event: The error event to send

        Returns:
            True if the event was sent successfully
        """
        try:
            client = await self._get_client()
            payload = HttpTransport(self.options)._serialize_event(event)

            response = await client.post(
                self.endpoint,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self.options.api_key}",
                    "User-Agent": "bugwatch-python/0.1.0",
                }
            )

            if response.status_code in (200, 201):
                if self.options.debug:
                    logger.debug(f"Event sent successfully: {event.event_id}")
                return True
            else:
                logger.warning(f"Failed to send event: HTTP {response.status_code}")
                return False

        except Exception as e:
            logger.error(f"Error sending event: {e}")
            return False

    def send(self, event: ErrorEvent) -> bool:
        """Sync wrapper for send_async."""
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If we're in an async context, schedule as a task
                future = asyncio.ensure_future(self.send_async(event))
                return True  # Optimistic return
            else:
                return loop.run_until_complete(self.send_async(event))
        except RuntimeError:
            # No event loop, create one
            return asyncio.run(self.send_async(event))

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None


class NoopTransport(Transport):
    """Transport that does nothing (for testing)."""

    def send(self, event: ErrorEvent) -> bool:
        return True


class ConsoleTransport(Transport):
    """Transport that logs events to console (for debugging)."""

    def __init__(self, options: BugwatchOptions):
        self.options = options

    def send(self, event: ErrorEvent) -> bool:
        print(f"[Bugwatch] Event {event.event_id}")
        print(f"  Level: {event.level.value}")
        if event.exception:
            print(f"  Exception: {event.exception.type}: {event.exception.value}")
        if event.message:
            print(f"  Message: {event.message}")
        print(f"  Tags: {event.tags}")
        return True
