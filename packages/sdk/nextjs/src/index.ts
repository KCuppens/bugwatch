import type { NextConfig } from "next";
import { init as nodeInit, type NodeOptions } from "@bugwatch/node";

// Re-export from core
export {
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
  getClient,
} from "@bugwatch/core";

export type { BugwatchOptions, ErrorEvent, UserContext } from "@bugwatch/core";

/**
 * Next.js specific SDK options
 */
export interface NextjsOptions extends NodeOptions {
  /** Capture errors from getServerSideProps */
  captureServerSideErrors?: boolean;
  /** Capture errors from API routes */
  captureApiErrors?: boolean;
  /** Capture build-time errors */
  captureBuildErrors?: boolean;
}

const DEFAULT_NEXTJS_OPTIONS: Partial<NextjsOptions> = {
  captureServerSideErrors: true,
  captureApiErrors: true,
  captureBuildErrors: true,
};

/**
 * Initialize the Bugwatch SDK for Next.js server-side
 */
export function init(options: NextjsOptions): void {
  const mergedOptions = { ...DEFAULT_NEXTJS_OPTIONS, ...options };

  // Initialize Node.js SDK (server-side)
  const client = nodeInit(mergedOptions);

  // Add Next.js specific tags
  client.setTag("framework", "nextjs");
  client.setTag("next.runtime", getNextRuntime());

  if (mergedOptions.debug) {
    console.log("[Bugwatch] Next.js SDK initialized (server)");
  }
}

/**
 * Detect Next.js runtime environment
 */
function getNextRuntime(): string {
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

declare const EdgeRuntime: string | undefined;

/**
 * Higher-order function to wrap Next.js config with Bugwatch
 */
export function withBugwatch(
  bugwatchOptions: NextjsOptions
): (nextConfig?: NextConfig) => NextConfig {
  return (nextConfig: NextConfig = {}) => {
    // Initialize on server
    if (typeof window === "undefined") {
      init(bugwatchOptions);
    }

    return {
      ...nextConfig,

      // Extend webpack config to add source map handling
      webpack: (config, options) => {
        // Add hidden source maps for production
        if (!options.dev && !options.isServer) {
          config.devtool = "hidden-source-map";
        }

        // Call original webpack function if it exists
        if (typeof nextConfig.webpack === "function") {
          return nextConfig.webpack(config, options);
        }

        return config;
      },
    };
  };
}

/**
 * Wrapper for getServerSideProps that captures errors
 */
export function withBugwatchServerSideProps<
  P extends Record<string, unknown> = Record<string, unknown>,
  Q extends Record<string, string> = Record<string, string>
>(
  getServerSideProps: (
    context: import("next").GetServerSidePropsContext<Q>
  ) => Promise<import("next").GetServerSidePropsResult<P>>
): (
  context: import("next").GetServerSidePropsContext<Q>
) => Promise<import("next").GetServerSidePropsResult<P>> {
  return async (context) => {
    try {
      return await getServerSideProps(context);
    } catch (error) {
      const { captureException } = await import("@bugwatch/core");

      if (error instanceof Error) {
        captureException(error, {
          tags: {
            mechanism: "getServerSideProps",
            "next.route": context.resolvedUrl,
          },
          request: {
            url: context.resolvedUrl,
            method: context.req.method,
            headers: sanitizeHeaders(context.req.headers),
          },
        });
      }

      throw error;
    }
  };
}

/**
 * Wrapper for getStaticProps that captures errors
 */
export function withBugwatchStaticProps<
  P extends Record<string, unknown> = Record<string, unknown>
>(
  getStaticProps: (
    context: import("next").GetStaticPropsContext
  ) => Promise<import("next").GetStaticPropsResult<P>>
): (
  context: import("next").GetStaticPropsContext
) => Promise<import("next").GetStaticPropsResult<P>> {
  return async (context) => {
    try {
      return await getStaticProps(context);
    } catch (error) {
      const { captureException } = await import("@bugwatch/core");

      if (error instanceof Error) {
        captureException(error, {
          tags: {
            mechanism: "getStaticProps",
          },
        });
      }

      throw error;
    }
  };
}

/**
 * Wrapper for API route handlers
 */
export function withBugwatchApi<Req, Res>(
  handler: (req: Req, res: Res) => Promise<void> | void
): (req: Req, res: Res) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const { captureException } = await import("@bugwatch/core");

      if (error instanceof Error) {
        const request = req as {
          method?: string;
          url?: string;
          headers?: Record<string, string | string[] | undefined>;
        };

        captureException(error, {
          tags: {
            mechanism: "apiRoute",
          },
          request: {
            method: request.method,
            url: request.url,
            headers: sanitizeHeaders(request.headers || {}),
          },
        });
      }

      throw error;
    }
  };
}

/**
 * Sanitize headers to remove sensitive information
 */
function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
  ];

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[Filtered]";
    } else if (value !== undefined) {
      sanitized[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }

  return sanitized;
}
