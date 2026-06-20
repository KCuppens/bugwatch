import { describe, it, expect, vi, beforeEach } from "vitest";

// Use regular functions (not arrow functions) so they can be called with `new`
vi.mock("./recorder", () => ({
  ReplayRecorder: vi.fn().mockImplementation(function () {
    return {
      start: vi.fn(() => Promise.resolve()),
      flush: vi.fn(),
      stop: vi.fn(),
    };
  }),
}));
vi.mock("./transport", () => ({
  ReplayTransport: vi.fn().mockImplementation(function () {
    return {
      sendSegment: vi.fn(() => Promise.resolve()),
      finish: vi.fn(() => Promise.resolve()),
    };
  }),
}));

import { ReplayRecorder } from "./recorder";
import { ReplayTransport } from "./transport";
import { BugwatchReplay } from "./index";

function getRecorderInstance() {
  return vi.mocked(ReplayRecorder).mock.results[0]?.value as {
    start: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
}

function getTransportInstance() {
  return vi.mocked(ReplayTransport).mock.results[0]?.value as {
    sendSegment: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BugwatchReplay", () => {
  const makeReplay = (opts = {}) =>
    new BugwatchReplay({ endpoint: "https://replay.example.com", apiKey: "bw_key", ...opts });

  it("creates a transport with the provided endpoint and apiKey", () => {
    makeReplay();
    expect(ReplayTransport).toHaveBeenCalledWith("https://replay.example.com", "bw_key");
  });

  it("creates a recorder with the session id", () => {
    const replay = makeReplay();
    expect(ReplayRecorder).toHaveBeenCalledWith(
      replay.getSessionId(),
      expect.any(Function),
      expect.objectContaining({ endpoint: "https://replay.example.com" })
    );
  });

  it("getSessionId returns a non-empty string", () => {
    const replay = makeReplay();
    expect(replay.getSessionId()).toBeTypeOf("string");
    expect(replay.getSessionId().length).toBeGreaterThan(0);
  });

  it("each instance gets a unique session id", () => {
    const a = makeReplay();
    const b = makeReplay();
    expect(a.getSessionId()).not.toBe(b.getSessionId());
  });

  it("start() delegates to recorder.start()", async () => {
    const replay = makeReplay();
    const recorder = getRecorderInstance();
    await replay.start();
    expect(recorder.start).toHaveBeenCalledOnce();
  });

  it("flush() delegates to recorder.flush()", () => {
    const replay = makeReplay();
    const recorder = getRecorderInstance();
    replay.flush();
    expect(recorder.flush).toHaveBeenCalledOnce();
  });

  it("stop() stops recorder and calls transport.finish(sessionId)", () => {
    const replay = makeReplay();
    const recorder = getRecorderInstance();
    const transport = getTransportInstance();
    replay.stop();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(transport.finish).toHaveBeenCalledWith(replay.getSessionId());
  });

  it("the send callback passed to recorder invokes transport.sendSegment", () => {
    makeReplay();
    const transport = getTransportInstance();
    const sendCallback = vi.mocked(ReplayRecorder).mock.calls[0]![1] as (seg: any) => void;
    const seg = { sessionId: "x", segmentIndex: 0, data: "", startedAt: 0 };
    sendCallback(seg);
    expect(transport.sendSegment).toHaveBeenCalledWith(seg);
  });
});
