/**
 * Tests for the fetchWithAuth session-expiry event dispatch.
 *
 * Regression: when a 401 persists after refresh also fails, the
 * 'bugwatch-auth-expired' event must be dispatched so AuthProvider
 * can clear local state and redirect the user to /login.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../api";

// Helper: build a minimal Response-like object for jsdom
function makeResponse(body: string | null, status: number): Response {
  return new Response(body, { status });
}

describe("fetchWithAuth — session expiry event", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── regression ────────────────────────────────────────────────────────────

  it("dispatches bugwatch-auth-expired when 401 persists after refresh fails", async () => {
    const fetchMock = vi.mocked(fetch);

    // First call: original API request → 401
    fetchMock.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          error: {
            code: "unauthorized",
            message: "Authentication required. Provide a JWT token or agent API key.",
          },
        }),
        401
      )
    );
    // Second call: refresh endpoint → 401 (refresh token also expired)
    fetchMock.mockResolvedValueOnce(
      makeResponse(JSON.stringify({ error: { code: "unauthorized", message: "Unauthorized" } }), 401)
    );

    const listener = vi.fn();
    window.addEventListener("bugwatch-auth-expired", listener);

    try {
      await api.get("/test");
    } catch {
      // ApiError is expected — we only care about the event
    }

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("bugwatch-auth-expired", listener);
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  it("does NOT dispatch event when refresh succeeds and retry returns 200", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock
      .mockResolvedValueOnce(makeResponse(null, 401)) // original → 401
      .mockResolvedValueOnce(makeResponse("{}", 200)) // refresh → ok
      .mockResolvedValueOnce(makeResponse("{}", 200)); // retry → ok

    const listener = vi.fn();
    window.addEventListener("bugwatch-auth-expired", listener);

    await api.get("/test");

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("bugwatch-auth-expired", listener);
  });

  it("does NOT dispatch event for non-401 server errors", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(
      makeResponse(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), 404)
    );

    const listener = vi.fn();
    window.addEventListener("bugwatch-auth-expired", listener);

    try {
      await api.get("/test");
    } catch {
      // ApiError(404) expected
    }

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("bugwatch-auth-expired", listener);
  });

  it("does NOT dispatch event when refresh fails but original was NOT a 401", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(
      makeResponse(JSON.stringify({ error: { code: "forbidden", message: "Forbidden" } }), 403)
    );

    const listener = vi.fn();
    window.addEventListener("bugwatch-auth-expired", listener);

    try {
      await api.get("/test");
    } catch {
      // ApiError(403) expected
    }

    // fetchWithAuth only branches for 401 — 403 must not trigger event
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("bugwatch-auth-expired", listener);
  });
});
