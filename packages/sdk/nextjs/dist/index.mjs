import { init as init$1 } from '@bugwatch/node';
export { addBreadcrumb, captureException, captureMessage, getClient, setExtra, setTag, setUser } from '@bugwatch/core';

// src/index.ts
var DEFAULT_NEXTJS_OPTIONS = {
  captureServerSideErrors: true,
  captureApiErrors: true,
  captureBuildErrors: true
};
function init(options) {
  const mergedOptions = { ...DEFAULT_NEXTJS_OPTIONS, ...options };
  const client = init$1(mergedOptions);
  client.setTag("framework", "nextjs");
  client.setTag("next.runtime", getNextRuntime());
  if (mergedOptions.debug) {
    console.log("[Bugwatch] Next.js SDK initialized (server)");
  }
}
function getNextRuntime() {
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    return "edge";
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    return "nodejs";
  }
  return "nodejs";
}
function withBugwatch(bugwatchOptions) {
  return (nextConfig = {}) => {
    if (typeof window === "undefined" && bugwatchOptions.apiKey) {
      init(bugwatchOptions);
    }
    return {
      ...nextConfig,
      // Extend webpack config to add source map handling
      webpack: (config, options) => {
        if (!options.dev && !options.isServer) {
          config.devtool = "hidden-source-map";
        }
        if (typeof nextConfig.webpack === "function") {
          return nextConfig.webpack(config, options);
        }
        return config;
      }
    };
  };
}
function withBugwatchServerSideProps(getServerSideProps) {
  return async (context) => {
    try {
      return await getServerSideProps(context);
    } catch (error) {
      const { captureException: captureException2 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        captureException2(error, {
          tags: {
            mechanism: "getServerSideProps",
            "next.route": context.resolvedUrl
          },
          request: {
            url: context.resolvedUrl,
            method: context.req.method,
            headers: sanitizeHeaders(context.req.headers)
          }
        });
      }
      throw error;
    }
  };
}
function withBugwatchStaticProps(getStaticProps) {
  return async (context) => {
    try {
      return await getStaticProps(context);
    } catch (error) {
      const { captureException: captureException2 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        captureException2(error, {
          tags: {
            mechanism: "getStaticProps"
          }
        });
      }
      throw error;
    }
  };
}
function withBugwatchApi(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const { captureException: captureException2 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        const request = req;
        captureException2(error, {
          tags: {
            mechanism: "apiRoute"
          },
          request: {
            method: request.method,
            url: request.url,
            headers: sanitizeHeaders(request.headers || {})
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
    "x-csrf-token"
  ];
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[Filtered]";
    } else if (value !== void 0) {
      sanitized[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return sanitized;
}

export { init, withBugwatch, withBugwatchApi, withBugwatchServerSideProps, withBugwatchStaticProps };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map