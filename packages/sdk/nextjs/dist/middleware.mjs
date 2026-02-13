// src/middleware.ts
function withBugwatchMiddleware(handler) {
  return async (request) => {
    const { addBreadcrumb, captureException } = await import('@bugwatch/core');
    addBreadcrumb({
      category: "middleware",
      message: `${request.method} ${request.nextUrl.pathname}`,
      level: "info",
      data: {
        url: request.url,
        method: request.method,
        pathname: request.nextUrl.pathname,
        search: request.nextUrl.search || void 0
      }
    });
    try {
      const response = await handler(request);
      return response;
    } catch (error) {
      if (error instanceof Error) {
        captureException(error, {
          tags: {
            mechanism: "nextjs-middleware",
            "http.method": request.method,
            "http.route": request.nextUrl.pathname
          },
          request: {
            url: request.url,
            method: request.method,
            headers: sanitizeHeaders(request.headers)
          }
        });
      }
      throw error;
    }
  };
}
function sanitizeHeaders(headers) {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
    "x-forwarded-for"
  ];
  const sanitized = {};
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[Filtered]";
    } else {
      sanitized[key] = value;
    }
  });
  return sanitized;
}
function bugwatchMiddleware() {
  return withBugwatchMiddleware(async () => {
    const { NextResponse } = await import('next/server');
    return NextResponse.next();
  });
}

export { bugwatchMiddleware, withBugwatchMiddleware };
//# sourceMappingURL=middleware.mjs.map
//# sourceMappingURL=middleware.mjs.map