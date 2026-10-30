import type { StackFrame } from "@bugwatch/core";

const BUNDLE_FILE = /\.(?:jsbundle|bundle|hbc)$/;

/**
 * Reduce a script location to `app:///<bundle basename>`. Release builds
 * report absolute on-device paths (`/data/.../index.android.bundle`), dev
 * builds report Metro URLs (`http://host:8081/index.bundle?platform=ios`);
 * neither is stable, but the basename is what source maps are uploaded under.
 * Non-bundle locations (`native`, `[native code]`) are returned unchanged.
 */
export function normalizeFilename(location: string): string {
  const withoutQuery = location.split(/[?#]/)[0] ?? location;
  const basename = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  return BUNDLE_FILE.test(basename) ? `app:///${basename}` : location;
}

const NATIVE_LOCATIONS = new Set(["native", "[native code]", "anonymous", "unknown"]);

/** `file:line:col` with optional Hermes `address at ` prefix. */
const LOCATION = /^(?:address at )?(.+?):(\d+)(?::(\d+))?$/;

function buildFrame(fn: string, location: string): StackFrame {
  const loc = LOCATION.exec(location);
  if (!loc) {
    return { filename: location, function: fn, lineno: 0, colno: 0, in_app: false };
  }
  const filename = normalizeFilename(loc[1] ?? location);
  return {
    filename,
    function: fn,
    lineno: Number.parseInt(loc[2] ?? "0", 10),
    colno: loc[3] ? Number.parseInt(loc[3], 10) : 0,
    in_app: filename.startsWith("app:///"),
  };
}

/**
 * Parse a Hermes (V8-style) or JavaScriptCore (`fn@location`) stack string.
 * Line and column numbers are passed through unchanged: both engines report
 * them 1-based, and for Hermes they are the composed-map coordinates that
 * uploaded source maps resolve.
 */
export function parseReactNativeStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];

  const push = (fn: string, location: string): void => {
    if (NATIVE_LOCATIONS.has(location)) {
      frames.push({ filename: location, function: fn, lineno: 0, colno: 0, in_app: false });
    } else if (LOCATION.test(location)) {
      frames.push(buildFrame(fn, location));
    }
  };

  for (const raw of stack.split("\n")) {
    const line = raw.trim();

    if (line.startsWith("at ")) {
      const body = line.slice(3);
      const open = body.indexOf(" (");
      if (open !== -1 && body.endsWith(")")) {
        push(body.slice(0, open) || "<anonymous>", body.slice(open + 2, -1));
      } else {
        push("<anonymous>", body);
      }
      continue;
    }

    // JavaScriptCore: `fn@location`. Message lines that merely contain an "@"
    // are rejected because their tail is not a location.
    const at = line.indexOf("@");
    if (at !== -1) push(line.slice(0, at) || "<anonymous>", line.slice(at + 1));
  }

  return frames;
}
