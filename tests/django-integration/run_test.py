#!/usr/bin/env python
"""Quick test script that runs Django and makes test requests."""
import subprocess
import time
import sys
import requests
import threading
import os

# Force unbuffered output
os.environ['PYTHONUNBUFFERED'] = '1'

def run_server():
    """Run Django server and print output."""
    process = subprocess.Popen(
        [sys.executable, '-u', 'manage.py', 'runserver', '--noreload', '127.0.0.1:8000'],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )

    # Print output in real-time
    for line in process.stdout:
        print(line, end='', flush=True)

    return process

def make_requests():
    """Make test requests after server starts."""
    # Wait for server to start
    time.sleep(3)

    print("\n" + "=" * 60)
    print("Making test requests...")
    print("=" * 60 + "\n")

    endpoints = [
        ('/', 'Home page'),
        ('/error/value', 'ValueError'),
        ('/error/with-breadcrumbs', 'Error with breadcrumbs'),
        ('/capture/message', 'Manual message capture'),
    ]

    for path, desc in endpoints:
        try:
            print(f"\n>>> Testing: {desc} ({path})")
            resp = requests.get(f'http://127.0.0.1:8000{path}', timeout=10)
            print(f"    Status: {resp.status_code}")
            time.sleep(0.5)
        except Exception as e:
            print(f"    Error: {e}")

    print("\n" + "=" * 60)
    print("Test requests complete. Check output above for Bugwatch events.")
    print("Press Ctrl+C to stop the server.")
    print("=" * 60 + "\n")

if __name__ == '__main__':
    # Start request thread
    request_thread = threading.Thread(target=make_requests, daemon=True)
    request_thread.start()

    # Run server (blocks until Ctrl+C)
    try:
        run_server()
    except KeyboardInterrupt:
        print("\nServer stopped.")
