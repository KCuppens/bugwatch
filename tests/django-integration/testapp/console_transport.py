"""
Console transport for Bugwatch testing.
Prints events in a readable format to the console.
"""
import json
import sys
from bugwatch.transport import Transport


class ConsoleTransport(Transport):
    """Transport that prints events to console for testing."""

    def _print(self, text=""):
        """Print with explicit flush."""
        print(text, flush=True)
        sys.stdout.flush()

    def send(self, event):
        self._print()
        self._print("=" * 70)
        self._print("BUGWATCH EVENT CAPTURED")
        self._print("=" * 70)
        self._print(f"Event ID:  {event.event_id}")
        self._print(f"Timestamp: {event.timestamp}")
        self._print(f"Level:     {event.level.value.upper()}")

        if event.exception:
            self._print()
            self._print("[EXCEPTION]")
            self._print(f"  Type:    {event.exception.type}")
            self._print(f"  Message: {event.exception.value}")

            if event.exception.stacktrace:
                self._print()
                self._print(f"[STACKTRACE] ({len(event.exception.stacktrace)} frames)")
                # Show last 8 frames (most relevant)
                frames_to_show = event.exception.stacktrace[-8:]
                for i, frame in enumerate(frames_to_show):
                    in_app = " [APP]" if frame.in_app else ""
                    self._print(f"  {i+1}. {frame.filename}:{frame.lineno} in {frame.function}{in_app}")
                    if frame.context_line:
                        self._print(f"       > {frame.context_line.strip()}")

        if event.message:
            self._print()
            self._print("[MESSAGE]")
            self._print(f"  {event.message}")

        if event.user:
            self._print()
            self._print("[USER]")
            self._print(f"  ID:       {event.user.id}")
            if event.user.email:
                self._print(f"  Email:    {event.user.email}")
            if event.user.username:
                self._print(f"  Username: {event.user.username}")

        if event.tags:
            self._print()
            self._print("[TAGS]")
            for key, value in event.tags.items():
                self._print(f"  {key}: {value}")

        if event.extra:
            self._print()
            self._print("[EXTRA DATA]")
            self._print(f"  {json.dumps(event.extra, indent=4, default=str)}")

        if event.breadcrumbs:
            self._print()
            self._print(f"[BREADCRUMBS] ({len(event.breadcrumbs)} total)")
            # Show last 5 breadcrumbs
            for bc in event.breadcrumbs[-5:]:
                self._print(f"  [{bc.level.value.upper():7}] {bc.category}: {bc.message}")
                if bc.data:
                    self._print(f"            Data: {bc.data}")

        if event.request:
            self._print()
            self._print("[REQUEST]")
            self._print(f"  Method: {event.request.method}")
            self._print(f"  URL:    {event.request.url}")
            if event.request.headers:
                self._print(f"  Headers: {list(event.request.headers.keys())}")

        if event.runtime:
            self._print()
            self._print("[RUNTIME]")
            self._print(f"  Python {event.runtime.version}")

        self._print("=" * 70)
        self._print()

    def flush(self):
        """Flush is a no-op for console transport."""
        sys.stdout.flush()
