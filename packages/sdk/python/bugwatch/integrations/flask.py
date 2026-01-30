"""Flask integration for Bugwatch Python SDK."""
import sys
from functools import wraps
from typing import Any, Callable, Dict, Optional

from .. import get_client, init
from ..types import Level, RequestContext, UserContext


class BugwatchFlask:
    """
    Flask extension for Bugwatch error tracking.

    Usage::

        from flask import Flask
        from bugwatch.integrations.flask import BugwatchFlask

        app = Flask(__name__)
        bugwatch = BugwatchFlask(app, api_key='your-api-key')

    Or with factory pattern::

        bugwatch = BugwatchFlask()

        def create_app():
            app = Flask(__name__)
            bugwatch.init_app(app, api_key='your-api-key')
            return app
    """

    def __init__(
        self,
        app: Optional[Any] = None,
        api_key: Optional[str] = None,
        **kwargs: Any
    ) -> None:
        self.app = app
        if app is not None and api_key is not None:
            self.init_app(app, api_key, **kwargs)

    def init_app(
        self,
        app: Any,
        api_key: str,
        endpoint: str = "https://api.bugwatch.dev",
        environment: Optional[str] = None,
        release: Optional[str] = None,
        debug: bool = False,
        **kwargs: Any
    ) -> None:
        """
        Initialize Bugwatch with a Flask app.

        Args:
            app: Flask application
            api_key: Bugwatch API key
            endpoint: Bugwatch API endpoint
            environment: Environment name
            release: Release version
            debug: Enable debug mode
            **kwargs: Additional options
        """
        # Initialize the SDK
        init(
            api_key=api_key,
            endpoint=endpoint,
            environment=environment or app.config.get('ENV'),
            release=release,
            debug=debug or app.debug,
            **kwargs
        )

        # Register error handler
        app.register_error_handler(Exception, self._handle_exception)

        # Register before/after request handlers
        app.before_request(self._before_request)
        app.after_request(self._after_request)

        # Store reference
        app.extensions = getattr(app, 'extensions', {})
        app.extensions['bugwatch'] = self

    def _before_request(self) -> None:
        """Add request breadcrumb."""
        from flask import g, request

        client = get_client()
        if client:
            client.add_breadcrumb(
                category="http",
                message=f"{request.method} {request.path}",
                level=Level.INFO,
            )

            # Set user context if available
            user = getattr(g, 'user', None) or getattr(g, 'current_user', None)
            if user and hasattr(user, 'id'):
                client.set_user(UserContext(
                    id=str(user.id),
                    email=getattr(user, 'email', None),
                    username=getattr(user, 'username', None),
                ))

    def _after_request(self, response: Any) -> Any:
        """Track response status."""
        from flask import request

        client = get_client()
        if client:
            client.add_breadcrumb(
                category="http",
                message=f"Response {response.status_code}",
                level=Level.INFO if response.status_code < 400 else Level.WARNING,
                data={
                    "url": request.url,
                    "status_code": response.status_code,
                },
            )

        return response

    def _handle_exception(self, error: Exception) -> Any:
        """Capture unhandled exceptions."""
        from flask import request

        client = get_client()
        if client:
            request_context = _extract_flask_request_context()

            client.capture_exception(
                error,
                level=Level.ERROR,
                tags={
                    "mechanism": "flask.error_handler",
                    "http.method": request.method,
                    "http.url": request.url,
                },
                extra={
                    "request": request_context.__dict__ if request_context else None,
                },
            )

        # Re-raise to let Flask handle the response
        raise error


def init_flask(
    app: Any,
    api_key: str,
    **kwargs: Any
) -> BugwatchFlask:
    """
    Convenience function to initialize Bugwatch with Flask.

    Args:
        app: Flask application
        api_key: Bugwatch API key
        **kwargs: Additional options

    Returns:
        BugwatchFlask extension instance
    """
    return BugwatchFlask(app, api_key=api_key, **kwargs)


def capture_exceptions(func: Callable) -> Callable:
    """
    Decorator to capture exceptions from a Flask view.

    Usage::

        @app.route('/api/data')
        @capture_exceptions
        def get_data():
            # ... your code
            pass
    """
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return func(*args, **kwargs)
        except Exception as e:
            from flask import request

            client = get_client()
            if client:
                client.capture_exception(
                    e,
                    level=Level.ERROR,
                    tags={
                        "mechanism": "flask.decorator",
                        "http.method": request.method,
                        "flask.endpoint": request.endpoint or "unknown",
                    },
                )
            raise

    return wrapper


def _extract_flask_request_context() -> Optional[RequestContext]:
    """Extract request context from Flask request."""
    try:
        from flask import request

        # Get headers, filtering sensitive ones
        headers = {}
        sensitive_headers = {'authorization', 'cookie', 'x-api-key', 'x-auth-token'}

        for key, value in request.headers:
            header_name = key.lower()
            if header_name in sensitive_headers:
                headers[header_name] = '[Filtered]'
            else:
                headers[header_name] = value

        # Get form data (be careful with sensitive data)
        form_data = None
        if request.form:
            form_data = dict(request.form.items())
            sensitive_fields = {'password', 'token', 'secret', 'api_key', 'credit_card'}
            for field in sensitive_fields:
                if field in form_data:
                    form_data[field] = '[Filtered]'

        return RequestContext(
            url=request.url,
            method=request.method,
            headers=headers,
            query_string=request.query_string.decode('utf-8', errors='replace'),
            data=form_data,
        )
    except Exception:
        return None
