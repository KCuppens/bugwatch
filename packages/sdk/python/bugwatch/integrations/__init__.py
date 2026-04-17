"""Framework integrations for Bugwatch Python SDK."""
from .celery import CeleryIntegration, init_celery
from .django import BugwatchMiddleware as DjangoBugwatchMiddleware
from .django import bugwatch_error_handler as django_error_handler
from .fastapi import BugwatchFastAPI, init_fastapi
from .flask import BugwatchFlask, init_flask
from .logging import BugwatchHandler, setup_logging

__all__ = [
    # Celery
    "CeleryIntegration",
    "init_celery",
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
