import { describe, it, expect } from "vitest";
import { parseStackTrace, extractErrorInfo, isBrowserExtensionError } from "./stacktrace";

/**
 * Build an Error with a deterministic stack string so tests don't depend on
 * the runtime's actual stack-capture format.
 */
function makeError(stack: string | undefined, message = "test"): Error {
  const e = new Error(message);
  Object.defineProperty(e, "stack", { value: stack, configurable: true });
  return e;
}

describe("parseStackTrace", () => {
  it("returns [] when error.stack is undefined", () => {
    const err = makeError(undefined);
    expect(parseStackTrace(err)).toEqual([]);
  });

  it("returns [] when error.stack is an empty string", () => {
    const err = makeError("");
    expect(parseStackTrace(err)).toEqual([]);
  });

  it("parses Chrome/Node multi-line stack and marks node: frames as not in_app", () => {
    const stack = [
      "Error: oops",
      "    at Object.handleClick (/app/src/click.ts:42:10)",
      "    at processQueue (node:internal/process/task_queues:96:5)",
    ].join("\n");

    const frames = parseStackTrace(makeError(stack));

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      filename: "/app/src/click.ts",
      function: "Object.handleClick",
      lineno: 42,
      colno: 10,
      in_app: true,
    });
    expect(frames[1]).toMatchObject({
      filename: "node:internal/process/task_queues",
      function: "processQueue",
      lineno: 96,
      colno: 5,
      in_app: false,
    });
  });

  it("parses Firefox/Safari format and normalizes webpack:// prefix", () => {
    const stack = ["handleClick@file:///app/src/click.ts:42:10", "processQueue@webpack://app/src/queue.ts:5:3"].join(
      "\n"
    );

    const frames = parseStackTrace(makeError(stack));

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      // file:// prefix stripped (becomes "/app/src/click.ts")
      filename: "/app/src/click.ts",
      function: "handleClick",
      lineno: 42,
      colno: 10,
      in_app: true,
    });
    // webpack://app/ stripped, leaving "src/queue.ts"
    expect(frames[1]!.filename).toBe("src/queue.ts");
    expect(frames[1]!.function).toBe("processQueue");
    expect(frames[1]!.lineno).toBe(5);
    expect(frames[1]!.colno).toBe(3);
    expect(frames[1]!.in_app).toBe(true);
  });

  it("skips invalid lines (Error: prefix, blanks) and keeps only valid frames", () => {
    const stack = [
      "Error: oops",
      "",
      "    at handleClick (/app/src/click.ts:1:1)",
      "   ",
      "this line has no @ and no at",
      "    at processQueue (/app/src/queue.ts:2:2)",
    ].join("\n");

    const frames = parseStackTrace(makeError(stack));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.function).toBe("handleClick");
    expect(frames[1]!.function).toBe("processQueue");
  });

  it("treats anonymous Chrome frames (no function before paren) as <anonymous>", () => {
    const stack = "    at /app/index.js:10:5";
    const frames = parseStackTrace(makeError(stack));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.function).toBe("<anonymous>");
    expect(frames[0]!.filename).toBe("/app/index.js");
    expect(frames[0]!.lineno).toBe(10);
    expect(frames[0]!.colno).toBe(5);
  });

  it("handles native-code frames", () => {
    const stack = "    at native code";
    const frames = parseStackTrace(makeError(stack));
    expect(frames).toHaveLength(1);
    // function defaults to <anonymous>; filename is the leftover token.
    expect(frames[0]!.function).toBe("<anonymous>");
    // "native code" is the unmatched fallback group; both branches treat it as
    // a non-app frame (browser built-in / native).
    expect(frames[0]!.in_app).toBe(false);
  });

  it("strips file:// prefix in Chrome frames", () => {
    const stack = "    at fn (file:///app/src/x.ts:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.filename).toBe("/app/src/x.ts");
  });

  it("strips leading ./ from filenames", () => {
    const stack = "    at fn (./src/x.ts:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.filename).toBe("src/x.ts");
  });

  it("strips ?query strings from filenames", () => {
    const stack = "    at fn (/app/x.ts?v=123:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.filename).toBe("/app/x.ts");
  });

  it("marks node_modules frames as not in_app", () => {
    const stack = "    at fn (/app/node_modules/lodash/index.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks internal/ frames as not in_app", () => {
    const stack = "    at fn (internal/modules/cjs/loader.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks (native) frames as not in_app", () => {
    // The trailing fallback group captures "(native)" verbatim when there is
    // no space before the opening paren (so the optional func+'(' group is
    // skipped). isInAppFrame matches via filename.includes("(native)").
    const stack = "    at (native)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.filename).toContain("(native)");
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks <anonymous> filenames as not in_app (browser built-ins)", () => {
    const stack = "    at fn (<anonymous>:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.filename.startsWith("<")).toBe(true);
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks webpack/runtime frames as not in_app", () => {
    const stack = "    at fn (webpack/runtime/something.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks turbopack frames as not in_app", () => {
    const stack = "    at fn (/app/turbopack-foo.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks __next frames as not in_app", () => {
    const stack = "    at fn (/__next/static/chunks/main.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks next/dist frames as not in_app", () => {
    const stack = "    at fn (/app/next/dist/something.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks react-dom frames as not in_app", () => {
    const stack = "    at fn (/app/react-dom/cjs/react-dom.development.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks react/cjs frames as not in_app", () => {
    const stack = "    at fn (/app/react/cjs/react.development.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks scheduler frames as not in_app", () => {
    const stack = "    at fn (/app/scheduler/cjs/scheduler.development.js:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(false);
  });

  it("marks plain application code as in_app", () => {
    const stack = "    at fn (/app/src/components/Button.tsx:1:1)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames[0]!.in_app).toBe(true);
  });

  it("parses Chrome frames with file:line (no col) via the second alternation", () => {
    // The regex has a "(.+?):(\d+)" alternation for line-only matches.
    const stack = "    at fn (/app/src/x.ts:42)";
    const frames = parseStackTrace(makeError(stack));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.filename).toBe("/app/src/x.ts");
    expect(frames[0]!.lineno).toBe(42);
    // col falls back to 0
    expect(frames[0]!.colno).toBe(0);
  });
});

describe("extractErrorInfo", () => {
  it("returns name and message for a standard TypeError", () => {
    const err = new TypeError("oops");
    expect(extractErrorInfo(err)).toEqual({ type: "TypeError", value: "oops" });
  });

  it("defaults type to 'Error' when name is empty", () => {
    const err = new Error("hi");
    Object.defineProperty(err, "name", { value: "", configurable: true });
    expect(extractErrorInfo(err).type).toBe("Error");
  });

  it("falls back to String(error) when message is empty", () => {
    const err = new Error("");
    const info = extractErrorInfo(err);
    expect(info.type).toBe("Error");
    // String(new Error("")) is "Error"
    expect(info.value).toBe("Error");
  });

  it("handles error with no message at all (object without message)", () => {
    // Build a duck-typed Error-like object whose message is undefined.
    const err = {
      name: "WeirdError",
      message: undefined as unknown as string,
      toString() {
        return "WeirdError: stringified";
      },
    } as unknown as Error;
    const info = extractErrorInfo(err);
    expect(info.type).toBe("WeirdError");
    expect(info.value).toBe("WeirdError: stringified");
  });

  it("unminifies a known React error code (#185) into a readable message", () => {
    const err = new Error("Minified React error #185");
    const info = extractErrorInfo(err);
    expect(info.value).toBe(
      "React Error #185: Maximum update depth exceeded: Component calls setState inside useEffect without dependencies"
    );
  });

  it("falls back to 'React Error #N: <original>' for unknown React codes", () => {
    const err = new Error("Minified React error #999");
    const info = extractErrorInfo(err);
    expect(info.value).toBe("React Error #999: Minified React error #999");
  });

  it("decodes args[N]= URL params for known React codes", () => {
    // The regex requires \d+ between the brackets, so use args[0]=, args[1]=.
    const err = new Error("Minified React error #418; visit https://react.dev/errors/418?args[0]=foo&args[1]=bar");
    const info = extractErrorInfo(err);
    expect(info.value).toContain("React Error #418:");
    expect(info.value).toContain("Hydration failed");
    expect(info.value).toContain("[foo, bar]");
  });

  it("URL-decodes percent-encoded args", () => {
    const err = new Error("Minified React error #418?args[0]=hello%20world");
    const info = extractErrorInfo(err);
    expect(info.value).toContain("[hello world]");
  });

  it("leaves non-React error messages untouched", () => {
    const err = new Error("regular error");
    expect(extractErrorInfo(err).value).toBe("regular error");
  });
});

describe("isBrowserExtensionError", () => {
  it("detects chrome-extension:// in stack", () => {
    const err = makeError("Error\n    at fn (chrome-extension://abc/content.js:1:1)");
    expect(isBrowserExtensionError(err)).toBe(true);
  });

  it("detects moz-extension:// in stack", () => {
    const err = makeError("Error\n    at fn (moz-extension://abc/content.js:1:1)");
    expect(isBrowserExtensionError(err)).toBe(true);
  });

  it("detects safari-extension:// in stack", () => {
    const err = makeError("Error\n    at fn (safari-extension://abc/content.js:1:1)");
    expect(isBrowserExtensionError(err)).toBe(true);
  });

  it("detects safari-web-extension:// in stack", () => {
    const err = makeError("Error\n    at fn (safari-web-extension://abc/content.js:1:1)");
    expect(isBrowserExtensionError(err)).toBe(true);
  });

  it("detects webkit-masked-url:// in stack", () => {
    const err = makeError("Error\n    at fn (webkit-masked-url://hidden/blah:1:1)");
    expect(isBrowserExtensionError(err)).toBe(true);
  });

  it("returns false for normal application stacks", () => {
    const err = makeError("Error\n    at fn (/app/src/index.ts:1:1)");
    expect(isBrowserExtensionError(err)).toBe(false);
  });

  it("returns false when error has no stack", () => {
    const err = makeError(undefined);
    expect(isBrowserExtensionError(err)).toBe(false);
  });
});
