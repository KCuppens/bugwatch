"""FastAPI integration for Bugwatch Python SDK."""
import sys
from functools import wraps
from typing import Any, Callable, Dict, Optional

from .. import get_client, init
from ..types import Level, RequestContext, UserContext


class BugwatchFastAPI:
    """
    FastAPI integration for Bugwatch error tracking.

    Usage::

        from fastapi import FastAPI
        from bugwatch.integrations.fastapi import BugwatchFastAPI

        app = FastAPI()
        BugwatchFastAPI(app, api_key='your-api-key')

    Or with lifespan::

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            BugwatchFastAPI(app, api_key='your-api-key')
            yield

        app = FastAPI(lifespan=lifespan)
    """

    def __init__(
        self,
        app: Any,
        api_key: str,
        endpoint: str = "https://api.bugwatch.io",
        environment: Optional[str] = None,
        release: Optional[str] = None,
        debug: bool = False,
        **kwargs: Any
    ) -> None:
        """
        Initialize Bugwatch with a FastAPI app.

        Args:
            app: FastAPI application
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
            environment=environment,
            release=release,
            debug=debug,
            **kwargs
        )

        # Add middleware
        self._add_middleware(app)

        # Add exception handlers
        self._add_exception_handlers(app)

    def _add_middleware(self, app: Any) -> None:
        """Add request tracking middleware."""
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.requests import Request
        from starlette.responses import Response

        class BugwatchMiddleware(BaseHTTPMiddleware):
            async def dispatch(
                self, request: Request, call_next: Callable
            ) -> Response:
                client = get_client()

                # Add request breadcrumb
                if client:
                    client.add_breadcrumb(
                        category="http",
                        message=f"{request.method} {request.url.path}",
                        level=Level.INFO,
                    )

                try:
                    response = await call_next(request)

                    # Add response breadcrumb
                    if client:
                        client.add_breadcrumb(
                            category="http",
                            message=f"Response {response.status_code}",
                            level=Level.INFO if response.status_code < 400 else Level.WARNING,
                            data={
                                "url": str(request.url),
                                "status_code": response.status_code,
                            },
                        )

                    return response

                except Exception as e:
                    # Capture unhandled exceptions
                    if client:
                        request_context = await _extract_fastapi_request_context(request)

                        client.capture_exception(
                            e,
                            level=Level.ERROR,
                            tags={
                                "mechanism": "fastapi.middleware",
                                "http.method": request.method,
                                "http.url": str(request.url),
                            },
                            extra={
                                "request": request_context.__dict__ if request_context else None,
                            },
                        )
                    raise

        app.add_middleware(BugwatchMiddleware)

    def _add_exception_handlers(self, app: Any) -> None:
        """Add exception handlers."""
        from fastapi import Request
        from fastapi.responses import JSONResponse

        @app.exception_handler(Exception)
        async def bugwatch_exception_handler(
            request: Request, exc: Exception
        ) -> JSONResponse:
            client = get_client()
            if client:
                request_context = await _extract_fastapi_request_context(request)

                client.capture_exception(
                    exc,
                    level=Level.ERROR,
                    tags={
                        "mechanism": "fastapi.exception_handler",
                        "http.method": request.method,
                        "http.url": str(request.url),
                    },
                    extra={
                        "request": request_context.__dict__ if request_context else None,
                    },
                )

            # Re-raise to let FastAPI handle it
            raise exc


def init_fastapi(
    app: Any,
    api_key: str,
    **kwargs: Any
) -> BugwatchFastAPI:
    """
    Convenience function to initialize Bugwatch with FastAPI.

    Args:
        app: FastAPI application
        api_key: Bugwatch API key
        **kwargs: Additional options

    Returns:
        BugwatchFastAPI instance
    """
    return BugwatchFastAPI(app, api_key=api_key, **kwargs)


def capture_exceptions(func: Callable) -> Callable:
    """
    Decorator to capture exceptions from a FastAPI route.

    Usage::

        @app.get('/api/data')
        @capture_exceptions
        async def get_data():
            # ... your code
            pass
    """
    @wraps(func)
    async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            client = get_client()
            if client:
                client.capture_exception(
                    e,
                    level=Level.ERROR,
                    tags={
                        "mechanism": "fastapi.decorator",
                        "fastapi.endpoint": func.__name__,
                    },
                )
            raise

    @wraps(func)
    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return func(*args, **kwargs)
        except Exception as e:
            client = get_client()
            if client:
                client.capture_exception(
                    e,
                    level=Level.ERROR,
                    tags={
                        "mechanism": "fastapi.decorator",
                        "fastapi.endpoint": func.__name__,
                    },
                )
            raise

    import asyncio
    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


async def _extract_fastapi_request_context(request: Any) -> Optional[RequestContext]:
    """Extract request context from FastAPI/Starlette request."""
    try:
        # Get headers, filtering sensitive ones
        headers = {}
        sensitive_headers = {'authorization', 'cookie', 'x-api-key', 'x-auth-token'}

        for key, value in request.headers.items():
            header_name = key.lower()
            if header_name in sensitive_headers:
                headers[header_name] = '[Filtered]'
            else:
                headers[header_name] = value

        # Get query params
        query_string = str(request.query_params)

        # Get body data (be careful with sensitive data)
        body_data = None
        if request.method in ('POST', 'PUT', 'PATCH'):
            try:
                body_data = await request.json()
                if isinstance(body_data, dict):
                    sensitive_fields = {'password', 'token', 'secret', 'api_key', 'credit_card'}
                    for field in sensitive_fields:
                        if field in body_data:
                            body_data[field] = '[Filtered]'
            except Exception:
                pass

        return RequestContext(
            url=str(request.url),
            method=request.method,
            headers=headers,
            query_string=query_string,
            data=body_data,
        )
    except Exception:
        return None


# Dependency injection helper
def get_bugwatch_user(user_getter: Callable) -> Callable:
    """
    Create a dependency that sets the Bugwatch user context.

    Usage::

        from bugwatch.integrations.fastapi import get_bugwatch_user

        async def get_current_user(token: str = Depends(oauth2_scheme)):
            # ... validate token and get user
            return user

        @app.get('/api/data')
        async def get_data(user = Depends(get_bugwatch_user(get_current_user))):
            # user context is now set in Bugwatch
            pass
    """
    async def dependency(*args: Any, **kwargs: Any) -> Any:
        user = await user_getter(*args, **kwargs)

        client = get_client()
        if client and user:
            client.set_user(UserContext(
                id=str(getattr(user, 'id', None)),
                email=getattr(user, 'email', None),
                username=getattr(user, 'username', None),
            ))

        return user

    return dependency
