"""Django integration for Bugwatch Python SDK."""
import sys
from typing import Any, Callable, Dict, Optional

from .. import get_client, init
from ..types import Level, RequestContext, UserContext


class BugwatchMiddleware:
    """
    Django middleware for capturing unhandled exceptions.

    Add to your MIDDLEWARE setting::

        MIDDLEWARE = [
            'bugwatch.integrations.django.BugwatchMiddleware',
            # ... other middleware
        ]

    Configure in settings.py::

        BUGWATCH = {
            'api_key': 'your-api-key',
            'environment': 'production',
            'release': '1.0.0',
        }
    """

    def __init__(self, get_response: Callable) -> None:
        self.get_response = get_response
        self._initialized = False

    def __call__(self, request: Any) -> Any:
        # Initialize on first request
        if not self._initialized:
            self._initialize()
            self._initialized = True

        # Add request breadcrumb
        client = get_client()
        if client:
            client.add_breadcrumb(
                category="http",
                message=f"{request.method} {request.path}",
                level=Level.INFO,
                breadcrumb_type="http",
            )

        # Set user context - always capture IP, add user info if authenticated
        if client:
            ip_address = _get_client_ip(request)
            if hasattr(request, 'user') and request.user.is_authenticated:
                client.set_user(UserContext(
                    id=str(request.user.pk),
                    email=getattr(request.user, 'email', None),
                    username=getattr(request.user, 'username', None),
                    ip_address=ip_address,
                ))
            else:
                # Anonymous user - still capture IP
                client.set_user(UserContext(
                    ip_address=ip_address,
                ))

        response = self.get_response(request)

        return response

    def _initialize(self) -> None:
        """Initialize Bugwatch from Django settings."""
        try:
            from django.conf import settings

            bugwatch_settings = getattr(settings, 'BUGWATCH', {})
            if not bugwatch_settings.get('api_key'):
                print("[Bugwatch] No API key configured in BUGWATCH settings")
                return

            client = init(
                api_key=bugwatch_settings['api_key'],
                endpoint=bugwatch_settings.get('endpoint', 'https://api.bugwatch.io'),
                environment=bugwatch_settings.get('environment'),
                release=bugwatch_settings.get('release'),
                debug=bugwatch_settings.get('debug', False),
                sample_rate=bugwatch_settings.get('sample_rate', 1.0),
            )

            # Support custom transport from settings
            transport_setting = bugwatch_settings.get('transport')
            if transport_setting and client:
                try:
                    if isinstance(transport_setting, str):
                        # Import from string path
                        module_path, class_name = transport_setting.rsplit('.', 1)
                        import importlib
                        module = importlib.import_module(module_path)
                        transport_class = getattr(module, class_name)
                        client.transport = transport_class()
                    else:
                        client.transport = transport_setting()
                except Exception as te:
                    print(f"[Bugwatch] Failed to load transport: {te}")
        except Exception as e:
            print(f"[Bugwatch] Failed to initialize: {e}")

    def process_exception(self, request: Any, exception: Exception) -> None:
        """Capture unhandled exceptions."""
        client = get_client()
        if client is None:
            return None

        # Extract request context and set it on the client
        request_context = _extract_request_context(request)
        if request_context:
            client.set_request(request_context)

        # Capture the exception
        client.capture_exception(
            exception,
            level=Level.ERROR,
            tags={
                "mechanism": "django.middleware",
                "http.method": request.method,
                "http.url": request.build_absolute_uri(),
            },
        )

        return None


def bugwatch_error_handler(request: Any, exception: Exception) -> None:
    """
    Django error handler for use with handler500.

    In your urls.py::

        from bugwatch.integrations.django import bugwatch_error_handler

        def custom_500_handler(request):
            bugwatch_error_handler(request, sys.exc_info()[1])
            # Return your custom 500 response
            return render(request, '500.html', status=500)

        handler500 = custom_500_handler
    """
    client = get_client()
    if client is None:
        return

    request_context = _extract_request_context(request)
    if request_context:
        client.set_request(request_context)

    client.capture_exception(
        exception,
        level=Level.ERROR,
        tags={
            "mechanism": "django.handler500",
            "http.method": request.method,
        },
    )


def _get_client_ip(request: Any) -> Optional[str]:
    """Extract client IP address from Django request."""
    try:
        # Check for forwarded headers (behind proxy/load balancer)
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            # Take the first IP (client IP)
            return x_forwarded_for.split(',')[0].strip()

        x_real_ip = request.META.get('HTTP_X_REAL_IP')
        if x_real_ip:
            return x_real_ip

        # Fall back to REMOTE_ADDR
        return request.META.get('REMOTE_ADDR')
    except Exception:
        return None


def _extract_request_context(request: Any) -> Optional[RequestContext]:
    """Extract request context from Django request."""
    try:
        # Get headers, filtering sensitive ones
        headers = {}
        sensitive_headers = {'authorization', 'cookie', 'x-api-key', 'x-auth-token'}

        for key, value in request.META.items():
            if key.startswith('HTTP_'):
                header_name = key[5:].lower().replace('_', '-')
                if header_name in sensitive_headers:
                    headers[header_name] = '[Filtered]'
                else:
                    headers[header_name] = value

        # Get query string
        query_string = request.META.get('QUERY_STRING', '')

        # Get POST data (be careful with sensitive data)
        post_data = None
        if request.method == 'POST':
            try:
                post_data = dict(request.POST.items())
                # Filter sensitive fields
                sensitive_fields = {'password', 'token', 'secret', 'api_key', 'credit_card'}
                for field in sensitive_fields:
                    if field in post_data:
                        post_data[field] = '[Filtered]'
            except Exception:
                pass

        return RequestContext(
            url=request.build_absolute_uri(),
            method=request.method,
            headers=headers,
            query_string=query_string,
            data=post_data,
        )
    except Exception:
        return None


# Django Celery integration
class CeleryIntegration:
    """
    Celery integration for Django.

    Usage::

        from bugwatch.integrations.django import CeleryIntegration

        # In celery.py after creating the app
        CeleryIntegration.setup(app)
    """

    @staticmethod
    def setup(celery_app: Any) -> None:
        """Set up Celery task error tracking."""
        from celery.signals import task_failure, task_retry

        @task_failure.connect
        def handle_task_failure(
            sender: Any = None,
            task_id: str = None,
            exception: Exception = None,
            args: Any = None,
            kwargs: Any = None,
            traceback: Any = None,
            einfo: Any = None,
            **kw: Any
        ) -> None:
            client = get_client()
            if client and exception:
                client.capture_exception(
                    exception,
                    level=Level.ERROR,
                    tags={
                        "mechanism": "celery.task_failure",
                        "celery.task_name": sender.name if sender else "unknown",
                        "celery.task_id": task_id or "unknown",
                    },
                    extra={
                        "celery.args": args,
                        "celery.kwargs": kwargs,
                    },
                )

        @task_retry.connect
        def handle_task_retry(
            sender: Any = None,
            reason: Any = None,
            request: Any = None,
            **kw: Any
        ) -> None:
            client = get_client()
            if client:
                client.add_breadcrumb(
                    category="celery",
                    message=f"Task {sender.name if sender else 'unknown'} retrying",
                    level=Level.WARNING,
                    data={"reason": str(reason) if reason else None},
                )
