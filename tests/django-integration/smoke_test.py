#!/usr/bin/env python
"""
Smoke test script for Bugwatch Django integration.

Run the Django server first:
    python manage.py runserver

Then in another terminal:
    python smoke_test.py

This will hit all test endpoints and verify they respond correctly.
"""

import sys
import time

try:
    import requests
except ImportError:
    print("Error: requests library not installed")
    print("Install with: pip install requests")
    sys.exit(1)


BASE_URL = "http://127.0.0.1:8000"

# (path, expected_status, description)
ENDPOINTS = [
    # Success endpoints
    ("/", 200, "Home page"),
    ("/success", 200, "Success endpoint"),
    ("/json", 200, "JSON endpoint"),

    # Error triggers - all should return 500
    ("/error/value", 500, "ValueError"),
    ("/error/key", 500, "KeyError"),
    ("/error/zero", 500, "ZeroDivisionError"),
    ("/error/type", 500, "TypeError"),
    ("/error/attribute", 500, "AttributeError"),
    ("/error/nested", 500, "Nested exception"),
    ("/error/deep", 500, "Deep stacktrace (10 levels)"),

    # Context tests - all should return 500
    ("/error/with-user", 500, "Error with user context"),
    ("/error/with-tags", 500, "Error with tags"),
    ("/error/with-breadcrumbs", 500, "Error with breadcrumbs"),
    ("/error/with-extra", 500, "Error with extra data"),

    # Manual capture - returns 200 (handled exceptions)
    ("/capture/exception", 200, "Manual capture_exception()"),
    ("/capture/message", 200, "Manual capture_message()"),

    # Logging - returns 200 (logged, not raised)
    ("/log/error", 200, "Log ERROR"),
    ("/log/exception", 200, "Log exception with traceback"),

    # Thread/Async - returns 200 (background errors)
    ("/error/thread", 200, "Error in background thread"),
    ("/error/async", 200, "Error in async task"),
]


def main():
    print("=" * 60)
    print("Bugwatch Django Integration Smoke Test")
    print("=" * 60)
    print(f"Target: {BASE_URL}")
    print()

    # Check if server is running
    try:
        requests.get(BASE_URL, timeout=2)
    except requests.exceptions.ConnectionError:
        print("ERROR: Cannot connect to Django server!")
        print(f"Make sure the server is running at {BASE_URL}")
        print()
        print("Start the server with:")
        print("    python manage.py runserver")
        sys.exit(1)

    passed = 0
    failed = 0
    errors = []

    print("Running tests...\n")

    for path, expected_status, description in ENDPOINTS:
        try:
            resp = requests.get(f"{BASE_URL}{path}", timeout=10)
            status = resp.status_code

            if status == expected_status:
                print(f"  PASS  {description}")
                print(f"        {path} -> {status}")
                passed += 1
            else:
                print(f"  FAIL  {description}")
                print(f"        {path} -> {status} (expected {expected_status})")
                failed += 1
                errors.append((path, description, f"Got {status}, expected {expected_status}"))

        except requests.exceptions.Timeout:
            print(f"  FAIL  {description}")
            print(f"        {path} -> TIMEOUT")
            failed += 1
            errors.append((path, description, "Request timed out"))

        except Exception as e:
            print(f"  FAIL  {description}")
            print(f"        {path} -> ERROR: {e}")
            failed += 1
            errors.append((path, description, str(e)))

        # Small delay between requests
        time.sleep(0.1)

    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)

    if errors:
        print("\nFailed tests:")
        for path, desc, error in errors:
            print(f"  - {desc}: {error}")

    # Wait for background tasks
    print("\nWaiting 2 seconds for background thread/async errors...")
    time.sleep(2)

    print()
    print("=" * 60)
    print("Check the Django console for captured Bugwatch events!")
    print("=" * 60)

    # Summary of what to look for
    print("""
What to verify in the Django console:

1. ERROR TRIGGERS (7 events)
   - Each should show exception type, message, and stacktrace
   - Deep stacktrace should show 10+ frames

2. CONTEXT TESTS (4 events)
   - User context: Should show user ID, email, username
   - Tags: Should show feature, plan, region, version
   - Breadcrumbs: Should show 7 breadcrumbs with user journey
   - Extra: Should show cart items, customer info, payment attempt

3. MANUAL CAPTURE (2 events)
   - capture_exception: Should show KeyError with handled=true tag
   - capture_message: Should show WARNING level message

4. LOGGING (2 events)
   - Log ERROR: Should capture the error message
   - Log exception: Should capture with full traceback

5. BACKGROUND ERRORS (2 events, appear after ~1 second)
   - Thread error: Should show thread name in tags
   - Async error: Should show asyncio context

Total expected events: ~17 (some may vary based on timing)
""")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
