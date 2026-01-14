"""Framework integrations for Bugwatch Python SDK."""
from .django import BugwatchMiddleware as DjangoBugwatchMiddleware
from .django import bugwatch_error_handler as django_error_handler
from .flask import BugwatchFlask, init_flask
from .fastapi import BugwatchFastAPI, init_fastapi
from .logging import BugwatchHandler, setup_logging

__all__ = [
    # Django
    "DjangoBugwatchMiddleware",
    "django_error_handler",
    # Flask
    "BugwatchFlask",
    "init_flask",
    # FastAPI
    "BugwatchFastAPI",
    "init_fastapi",
    # Logging
    "BugwatchHandler",
    "setup_logging",
]
