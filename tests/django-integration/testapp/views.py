"""
Test views for Bugwatch Django integration testing.

Each view tests a different aspect of the Bugwatch SDK:
- Error capture (various exception types)
- Context data (user, tags, breadcrumbs, extra)
- Manual capture (capture_exception, capture_message)
- Logging integration
- Thread/async error capture
"""
import logging
import threading
import asyncio
from django.http import HttpResponse, JsonResponse

import bugwatch
from bugwatch import Level, UserContext

logger = logging.getLogger(__name__)


def index(request):
    """Home page with links to all test endpoints."""
    return HttpResponse("""
<!DOCTYPE html>
<html>
<head>
    <title>Bugwatch Django Integration Test</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               max-width: 900px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 3px solid #007bff; padding-bottom: 10px; }
        h2 { color: #555; margin-top: 30px; }
        ul { list-style: none; padding: 0; }
        li { margin: 8px 0; }
        a { color: #007bff; text-decoration: none; padding: 8px 16px;
            display: inline-block; background: white; border-radius: 4px;
            border: 1px solid #ddd; transition: all 0.2s; }
        a:hover { background: #007bff; color: white; border-color: #007bff; }
        .section { background: white; padding: 20px; border-radius: 8px;
                   margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .success { border-left: 4px solid #28a745; }
        .error { border-left: 4px solid #dc3545; }
        .context { border-left: 4px solid #ffc107; }
        .manual { border-left: 4px solid #17a2b8; }
        .async { border-left: 4px solid #6f42c1; }
        code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Bugwatch Django Integration Test</h1>
    <p>Click any link below and watch the console for captured events.</p>

    <div class="section success">
        <h2>Working Endpoints (No Errors)</h2>
        <ul>
            <li><a href="/success">Success Response</a> - Returns 200 OK</li>
            <li><a href="/json">JSON Response</a> - Returns JSON data</li>
        </ul>
    </div>

    <div class="section error">
        <h2>Error Triggers (Various Exception Types)</h2>
        <ul>
            <li><a href="/error/value">ValueError</a> - Basic value error</li>
            <li><a href="/error/key">KeyError</a> - Missing dictionary key</li>
            <li><a href="/error/zero">ZeroDivisionError</a> - Division by zero</li>
            <li><a href="/error/type">TypeError</a> - Type mismatch</li>
            <li><a href="/error/attribute">AttributeError</a> - Missing attribute</li>
            <li><a href="/error/nested">Nested Exception</a> - Exception with <code>__cause__</code></li>
            <li><a href="/error/deep">Deep Stacktrace</a> - 10-level recursive call</li>
        </ul>
    </div>

    <div class="section context">
        <h2>Context Data Tests</h2>
        <ul>
            <li><a href="/error/with-user">Error with User Context</a> - Includes user ID, email, username</li>
            <li><a href="/error/with-tags">Error with Tags</a> - Custom key-value tags</li>
            <li><a href="/error/with-breadcrumbs">Error with Breadcrumbs</a> - User journey trail</li>
            <li><a href="/error/with-extra">Error with Extra Data</a> - Additional context object</li>
        </ul>
    </div>

    <div class="section manual">
        <h2>Manual Capture</h2>
        <ul>
            <li><a href="/capture/exception">capture_exception()</a> - Manually capture handled exception</li>
            <li><a href="/capture/message">capture_message()</a> - Capture a message/event</li>
        </ul>
    </div>

    <div class="section manual">
        <h2>Logging Integration</h2>
        <ul>
            <li><a href="/log/error">Log ERROR</a> - <code>logger.error()</code></li>
            <li><a href="/log/exception">Log Exception</a> - <code>logger.exception()</code></li>
        </ul>
    </div>

    <div class="section async">
        <h2>Thread/Async Tests</h2>
        <ul>
            <li><a href="/error/thread">Error in Thread</a> - Background thread exception</li>
            <li><a href="/error/async">Error in Async Task</a> - Asyncio task exception</li>
        </ul>
    </div>
</body>
</html>
    """)


def success(request):
    """Successful response - no errors."""
    return HttpResponse("Success! No errors here. Check the console - no Bugwatch events should appear.")


def json_response(request):
    """JSON response - no errors."""
    return JsonResponse({
        "status": "ok",
        "message": "Everything is working correctly",
        "bugwatch": "No events captured for successful requests"
    })


# =============================================================================
# ERROR TRIGGERS
# =============================================================================

def error_value(request):
    """Trigger ValueError."""
    raise ValueError("This is a test ValueError from Django")


def error_key(request):
    """Trigger KeyError."""
    data = {"name": "test", "id": 123}
    # Accessing missing key
    return HttpResponse(data["missing_key"])


def error_zero(request):
    """Trigger ZeroDivisionError."""
    numerator = 100
    denominator = 0
    result = numerator / denominator
    return HttpResponse(f"Result: {result}")


def error_type(request):
    """Trigger TypeError."""
    text = "The answer is: "
    number = 42
    # Can't concatenate str and int
    result = text + number
    return HttpResponse(f"Result: {result}")


def error_attribute(request):
    """Trigger AttributeError."""
    obj = None
    # None has no method 'process'
    return HttpResponse(obj.process())


def error_nested(request):
    """Trigger nested exception with cause."""
    try:
        users = {"admins": [], "guests": []}
        # IndexError - list is empty
        first_admin = users["admins"][0]
    except IndexError as original_error:
        # Re-raise with context
        raise ValueError("Failed to retrieve admin user from database") from original_error


def _recursive_call(depth, max_depth):
    """Helper for deep stacktrace."""
    local_var = f"depth_{depth}"
    if depth >= max_depth:
        raise RuntimeError(f"Maximum recursion depth reached at level {depth}")
    return _recursive_call(depth + 1, max_depth)


def error_deep(request):
    """Trigger error with deep stacktrace (10 levels)."""
    initial_value = "starting"
    _recursive_call(0, 10)


# =============================================================================
# CONTEXT TESTS
# =============================================================================

def error_with_user(request):
    """Error with user context attached."""
    bugwatch.set_user(UserContext(
        id="user-12345",
        email="testuser@example.com",
        username="testuser",
    ))
    raise ValueError("Error with user context - check User section in output")


def error_with_tags(request):
    """Error with custom tags."""
    bugwatch.set_tag("feature", "checkout")
    bugwatch.set_tag("plan", "premium")
    bugwatch.set_tag("region", "us-west-2")
    bugwatch.set_tag("version", "2.1.0")
    raise ValueError("Error with custom tags - check Tags section in output")


def error_with_breadcrumbs(request):
    """Error with breadcrumbs showing user journey."""
    bugwatch.add_breadcrumb("navigation", "User visited homepage", Level.INFO)
    bugwatch.add_breadcrumb("navigation", "User clicked 'Products' menu", Level.INFO)
    bugwatch.add_breadcrumb("ui", "User added 'Widget Pro' to cart", Level.INFO, {"item_id": 42, "price": 29.99})
    bugwatch.add_breadcrumb("navigation", "User navigated to cart", Level.INFO)
    bugwatch.add_breadcrumb("ui", "User clicked 'Proceed to Checkout'", Level.INFO)
    bugwatch.add_breadcrumb("http", "POST /api/payment/process", Level.INFO, {"amount": 29.99, "currency": "USD"})
    bugwatch.add_breadcrumb("payment", "Payment gateway timeout", Level.WARNING, {"gateway": "stripe"})
    raise ValueError("Payment processing failed after timeout - check Breadcrumbs section")


def error_with_extra(request):
    """Error with extra context data."""
    bugwatch.set_extra("cart", {
        "items": [
            {"id": 1, "name": "Widget Pro", "price": 29.99, "quantity": 2},
            {"id": 2, "name": "Gadget Plus", "price": 49.99, "quantity": 1},
        ],
        "subtotal": 109.97,
        "tax": 9.90,
        "total": 119.87
    })
    bugwatch.set_extra("customer", {
        "lifetime_value": 1250.00,
        "orders_count": 15,
        "member_since": "2022-03-15"
    })
    bugwatch.set_extra("payment_attempt", {
        "method": "credit_card",
        "last_four": "4242",
        "attempt_number": 3
    })
    raise ValueError("Order processing failed - check Extra Data section")


# =============================================================================
# MANUAL CAPTURE
# =============================================================================

def capture_exception_manual(request):
    """Manually capture an exception (exception is handled, not raised)."""
    try:
        # Simulate some operation that fails
        config = {"database": "postgres", "host": "localhost"}
        password = config["password"]  # KeyError
    except KeyError as e:
        # Capture but don't crash
        event_id = bugwatch.capture_exception(
            tags={"source": "manual_capture", "handled": "true"},
            extra={"config_keys": list(config.keys()), "missing_key": str(e)}
        )
        return HttpResponse(f"""
        <h2>Exception Captured Manually</h2>
        <p>The exception was caught and reported to Bugwatch without crashing.</p>
        <p><strong>Event ID:</strong> <code>{event_id}</code></p>
        <p>Check the console for the captured event.</p>
        <p><a href="/">Back to Home</a></p>
        """)


def capture_message_manual(request):
    """Manually capture a message (not an exception)."""
    event_id = bugwatch.capture_message(
        message="User completed critical action: Account deletion requested",
        level=Level.WARNING,
        tags={
            "action": "account_deletion",
            "source": "manual_capture"
        },
        extra={
            "user_id": "user-789",
            "account_age_days": 365,
            "reason": "No longer needed",
            "data_export_requested": True
        }
    )
    return HttpResponse(f"""
    <h2>Message Captured</h2>
    <p>A warning-level message was sent to Bugwatch.</p>
    <p><strong>Event ID:</strong> <code>{event_id}</code></p>
    <p>Check the console for the captured event (Level: WARNING).</p>
    <p><a href="/">Back to Home</a></p>
    """)


# =============================================================================
# LOGGING INTEGRATION
# =============================================================================

def log_error(request):
    """Log an error message via Python logging."""
    logger.info("This INFO log will NOT be captured by Bugwatch")
    logger.warning("This WARNING log will NOT be captured by Bugwatch")
    logger.error("This ERROR log WILL be captured by Bugwatch via logging handler")

    return HttpResponse("""
    <h2>Error Logged</h2>
    <p>An ERROR level log was written. The Bugwatch logging handler should capture it.</p>
    <p>Check the console for the captured event.</p>
    <p><a href="/">Back to Home</a></p>
    """)


def log_exception(request):
    """Log an exception with traceback via logger.exception()."""
    try:
        data = [1, 2, 3]
        value = data[10]  # IndexError
    except IndexError:
        logger.exception("Failed to access list element - this exception was logged, not raised")

    return HttpResponse("""
    <h2>Exception Logged</h2>
    <p>An exception was caught and logged via <code>logger.exception()</code>.</p>
    <p>The Bugwatch logging handler captures it with full traceback.</p>
    <p>Check the console for the captured event.</p>
    <p><a href="/">Back to Home</a></p>
    """)


# =============================================================================
# THREAD/ASYNC TESTS
# =============================================================================

def error_in_thread(request):
    """Trigger error in a background thread."""
    def background_task():
        import time
        time.sleep(0.5)  # Simulate some work
        # This will be caught by threading.excepthook
        raise RuntimeError("Exception occurred in background thread 'BackgroundWorker'!")

    thread = threading.Thread(target=background_task, name="BackgroundWorker")
    thread.start()

    return HttpResponse("""
    <h2>Background Thread Started</h2>
    <p>A background thread was started that will raise an exception in ~0.5 seconds.</p>
    <p>The exception will be captured by <code>threading.excepthook</code>.</p>
    <p><strong>Watch the console</strong> - the event should appear shortly.</p>
    <p><a href="/">Back to Home</a></p>
    """)


def error_in_async(request):
    """Trigger error in an async task."""
    def run_async_loop():
        async def failing_task():
            await asyncio.sleep(0.5)
            raise RuntimeError("Exception occurred in async task!")

        async def main():
            # Create task that will fail
            task = asyncio.create_task(failing_task())
            await asyncio.sleep(1)  # Wait for task to fail

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(main())
        finally:
            loop.close()

    thread = threading.Thread(target=run_async_loop, name="AsyncRunner")
    thread.start()

    return HttpResponse("""
    <h2>Async Task Started</h2>
    <p>An async task was started that will raise an exception in ~0.5 seconds.</p>
    <p>The exception will be captured by the asyncio exception handler.</p>
    <p><strong>Watch the console</strong> - the event should appear shortly.</p>
    <p><a href="/">Back to Home</a></p>
    """)
