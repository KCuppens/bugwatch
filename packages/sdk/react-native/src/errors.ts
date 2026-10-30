import { captureException as coreCaptureException, getClient, type ErrorEvent } from "@bugwatch/core";
import { parseReactNativeStack } from "./stacktrace";

/** Coerce anything that can be thrown or used to reject into an Error. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return new Error(`Non-Error exception captured with value: ${text}`);
}

/**
 * Capture an error with its stack parsed for Hermes / JavaScriptCore, so
 * bundle frames are reported as `app:///<bundle>` for source map lookup.
 */
export function captureException(error: unknown, context?: Partial<ErrorEvent>): string {
  const err = toError(error);
  return coreCaptureException(err, {
    exception: {
      type: err.name || "Error",
      value: err.message,
      stacktrace: parseReactNativeStack(err.stack),
    },
    ...context,
  });
}

/**
 * Replace React Native's global JS error handler. Every error is captured,
 * then the previous handler runs. For fatal errors the previous handler (which
 * terminates the app in release builds) is deferred until pending events are
 * flushed or `flushTimeoutMs` elapses.
 */
export function setupGlobalErrorHandler(flushTimeoutMs: number): () => void {
  const utils = globalThis.ErrorUtils;
  if (!utils?.setGlobalHandler) return () => {};

  const previous = utils.getGlobalHandler?.();
  let fatalInFlight = false;

  const handler = (error: unknown, isFatal?: boolean): void => {
    try {
      captureException(error, {
        level: isFatal ? "fatal" : "error",
        tags: { mechanism: "onerror", handled: "false" },
      });
    } catch {
      // Never let SDK failures mask the original error.
    }

    const client = getClient();
    if (!isFatal || !client || fatalInFlight) {
      previous?.(error, isFatal);
      return;
    }
    fatalInFlight = true;
    let timer: number | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, flushTimeoutMs);
    });
    const proceed = (): void => {
      clearTimeout(timer);
      fatalInFlight = false;
      previous?.(error, isFatal);
    };
    Promise.race([client.flush(), timeout]).then(proceed, proceed);
  };

  utils.setGlobalHandler(handler);

  return () => {
    if (utils.getGlobalHandler?.() === handler && previous) {
      utils.setGlobalHandler?.(previous);
    }
  };
}

/**
 * Track unhandled promise rejections through Hermes' native tracker. JavaScriptCore
 * builds (no `HermesInternal`) are not covered: the `promise` polyfill's tracker is
 * only reachable through a Metro-resolved `require` that a prebuilt package cannot
 * emit, and Hermes has been React Native's default engine since 0.70.
 */
export function setupUnhandledRejectionHandler(): () => void {
  const onUnhandled = (_id: number, rejection: unknown): void => {
    try {
      captureException(rejection, {
        tags: { mechanism: "onunhandledrejection", handled: "false" },
      });
    } catch {
      // ignore
    }
  };
  const options = { allRejections: true, onUnhandled, onHandled: () => {} };

  const hermes = globalThis.HermesInternal;
  if (hermes?.enablePromiseRejectionTracker && hermes.hasPromise?.()) {
    hermes.enablePromiseRejectionTracker(options);
    return () => hermes.enablePromiseRejectionTracker?.({ allRejections: false });
  }
  return () => {};
}
