import { describe, expect, it } from "vitest";
import { normalizeFilename, parseReactNativeStack } from "./stacktrace";

describe("normalizeFilename", () => {
  it("reduces absolute bundle paths to app:///<basename>", () => {
    expect(normalizeFilename("/data/user/0/com.app/files/index.android.bundle")).toBe("app:///index.android.bundle");
    expect(normalizeFilename("/var/containers/Bundle/App.app/main.jsbundle")).toBe("app:///main.jsbundle");
  });

  it("drops Metro dev server hosts and query strings", () => {
    expect(normalizeFilename("http://localhost:8081/index.bundle?platform=ios&dev=true")).toBe("app:///index.bundle");
  });

  it("leaves non-bundle locations unchanged", () => {
    expect(normalizeFilename("native")).toBe("native");
    expect(normalizeFilename("/app/src/foo.js")).toBe("/app/src/foo.js");
  });
});

describe("parseReactNativeStack", () => {
  it("parses Hermes frames and keeps line/column as reported", () => {
    const stack = [
      "Error: boom",
      "    at onPress (address at /data/user/0/com.app/files/index.android.bundle:1:23456)",
      "    at anonymous (address at /data/user/0/com.app/files/index.android.bundle:1:100)",
      "    at native",
    ].join("\n");
    const frames = parseReactNativeStack(stack);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({
      filename: "app:///index.android.bundle",
      function: "onPress",
      lineno: 1,
      colno: 23456,
      in_app: true,
    });
    expect(frames[2]?.in_app).toBe(false);
  });

  it("parses V8-style frames without a function name", () => {
    const frames = parseReactNativeStack("Error: x\n    at /data/app/main.jsbundle:10:5");
    expect(frames).toEqual([
      { filename: "app:///main.jsbundle", function: "<anonymous>", lineno: 10, colno: 5, in_app: true },
    ]);
  });

  it("parses JavaScriptCore frames", () => {
    const frames = parseReactNativeStack("render@/var/App.app/main.jsbundle:5:9\nforEach@[native code]");
    expect(frames[0]).toMatchObject({ filename: "app:///main.jsbundle", function: "render", lineno: 5, colno: 9 });
    expect(frames[1]).toMatchObject({ filename: "[native code]", in_app: false });
  });

  it("does not treat an '@' in the message as a frame", () => {
    expect(parseReactNativeStack("Error: mail me@example.com")).toEqual([]);
  });

  it("returns an empty array for missing stacks", () => {
    expect(parseReactNativeStack(undefined)).toEqual([]);
  });
});
