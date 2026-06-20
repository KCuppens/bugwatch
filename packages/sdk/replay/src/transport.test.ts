import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReplayTransport } from "./transport";
import type { ReplaySegment } from "./types";

const ENDPOINT = "https://replay.example.com";
const API_KEY = "bw_test_key";

function makeSegment(overrides: Partial<ReplaySegment> = {}): ReplaySegment {
  return {
    sessionId: "sess-123",
    segmentIndex: 0,
    data: btoa('{"events":[]}'),
    startedAt: Date.now() as unknown as string,
    userAgent: "test-agent",
    screenWidth: 1920,
    screenHeight: 1080,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ReplayTransport.sendSegment", () => {
  it("sends segment with correct headers and body", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    await transport.sendSegment(makeSegment());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${ENDPOINT}/api/v1/replay/segments`);
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.session_id).toBe("sess-123");
    expect(body.segment_index).toBe(0);
  });

  it("returns immediately on 200", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    await transport.sendSegment(makeSegment());

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries once on 429 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    const sendPromise = transport.sendSegment(makeSegment());
    await vi.runAllTimersAsync();
    await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on 500 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    const sendPromise = transport.sendSegment(makeSegment());
    await vi.runAllTimersAsync();
    await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400 (client error)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("", { status: 400 }));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    await transport.sendSegment(makeSegment());

    expect(fetchMock).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("silently drops after two consecutive network errors", async () => {
    fetchMock.mockRejectedValue(new Error("Network failure"));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    const sendPromise = transport.sendSegment(makeSegment());
    await vi.runAllTimersAsync();
    await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("ReplayTransport.finish", () => {
  it("sends finish request with session id", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    await transport.finish("my-session");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${ENDPOINT}/api/v1/replay/finish`);
    const body = JSON.parse(options.body);
    expect(body.session_id).toBe("my-session");
  });

  it("swallows network errors (best-effort)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const transport = new ReplayTransport(ENDPOINT, API_KEY);
    await expect(transport.finish("sess")).resolves.toBeUndefined();
  });
});
