import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from "express";
import type { UserContext } from "@bugwatch/core";

/**
 * Options for the Bugwatch Express middleware
 */
export interface BugwatchExpressOptions {
  /**
   * Extract user context from the request.
   * Return null to skip user context extraction.
   */
  extractUser?: (req: Request) => UserContext | null;

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
   * Whether to flush events before sending error response.
   * Useful for serverless environments.
   * @default false
   */
  flushOnError?: boolean;
}

/**
 * Extended Express Request with Bugwatch context
 */
export interface BugwatchRequest extends Request {
  bugwatch?: {
    eventId?: string;
    startTime: number;
    /** Per-request correlation ID included in all breadcrumbs and error events */
    requestId?: string;
  };
}

/**
 * Async request handler type
 */
export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;
