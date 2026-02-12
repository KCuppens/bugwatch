import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserContext, BugwatchClient } from "@bugwatch/core";

/**
 * Options for the Bugwatch Fastify plugin
 */
export interface BugwatchFastifyOptions {
  /**
   * Extract user context from the request.
   * Return null to skip user context extraction.
   */
  extractUser?: (request: FastifyRequest) => UserContext | null;

  /**
   * Filter headers before sending to Bugwatch.
   * Return true to include the header, false to exclude.
   * By default, sensitive headers are excluded.
   */
  filterHeaders?: (name: string, value: string) => boolean;

  /**
   * Filter body fields before sending to Bugwatch.
   * Return true to include the field, false to exclude.
   */
  filterBody?: (key: string, value: unknown) => boolean;

  /**
   * Whether to include request body in error context.
   * @default false
   */
  includeBody?: boolean;

  /**
   * Whether to add breadcrumbs for requests.
   * @default true
   */
  addBreadcrumbs?: boolean;

  /**
   * Whether to automatically capture unhandled errors.
   * @default true
   */
  captureErrors?: boolean;

  /**
   * Whether to flush events before sending error response.
   * Useful for serverless environments.
   * @default false
   */
  flushOnError?: boolean;
}

/**
 * Bugwatch decorator interface for Fastify
 */
export interface BugwatchDecorator {
  /**
   * Capture an error with request context
   */
  captureError: (error: Error) => string;

  /**
   * Capture a message with request context
   */
  captureMessage: (message: string, level?: "debug" | "info" | "warning" | "error") => string;

  /**
   * Get the current event ID if an error was captured
   */
  getEventId: () => string | undefined;

  /**
   * Access the underlying Bugwatch client
   */
  client: BugwatchClient | null;
}

declare module "fastify" {
  interface FastifyRequest {
    bugwatch: BugwatchDecorator;
  }
}
