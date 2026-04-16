/**
 * Regression tests for the auth retry/re-fetch loop bug.
 *
 * BUG: GET /api/v1/auth/me → 401, then POST /api/v1/auth/refresh → 401
 * appears 3 times because:
 *   1. initAuth (mount) calls fetchCurrentUser() → me() 401 → refresh 401
 *   2. visibilitychange fires with user=null → fetchCurrentUser() again → me() 401 → refresh 401
 *   3. bugwatch-auth-expired event → setUser(null) triggers effect re-subscribe →
 *      if visibilitychange fires again in the same tick, a third fetch is issued
 *
 * Root causes under test:
 *   A. visibilitychange effect re-runs fetchCurrentUser when user is already null
 *      and a fetch is already in flight (no in-flight deduplication guard).
 *   B. Multiple rapid visibilitychange events each independently call fetchCurrentUser
 *      with no concurrent-call guard.
 *   C. The 3-call sequence is observable: me() called 3×, refresh attempted 3×.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth, type AuthContextType } from "../auth-context";

// ---------------------------------------------------------------------------
// API mock — every test controls return values via vi.mocked(authApi.me) etc.
// ---------------------------------------------------------------------------
vi.mock("../api", () => {
  const ApiError = class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  };

  return {
    ApiError,
    clearTokens: vi.fn(),
    refreshTokens: vi.fn(),
    authApi: {
      me: vi.fn(),
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Helper: expose auth context value via a mutable ref
// ---------------------------------------------------------------------------
function AuthConsumer({ onRender }: { onRender: (ctx: AuthContextType) => void }) {
  const ctx = useAuth();
  onRender(ctx);
  return null;
}

// ---------------------------------------------------------------------------
// Inline ApiError class matching the mock shape
// ---------------------------------------------------------------------------
class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("AuthProvider — visibilitychange retry loop regression", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authApiMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../api");
    authApiMock = mod.authApi;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Core regression: visibilitychange does NOT trigger a second fetch when user=null ──

  it("does not call authApi.me a second time when visibilitychange fires while user is null", async () => {
    // Arrange: me() always rejects with 401 (no valid session)
    authApiMock.me.mockRejectedValue(new ApiError(401, "unauthorized", "Missing authentication"));

    let capturedCtx!: AuthContextType;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer
            onRender={(ctx) => {
              capturedCtx = ctx;
            }}
          />
        </AuthProvider>
      );
    });

    // After mount, me() is called once by initAuth and user stays null
    expect(capturedCtx.user).toBeNull();
    const callsAfterMount = authApiMock.me.mock.calls.length;
    expect(callsAfterMount).toBe(1);

    // Act: simulate the user returning to the tab (tab becomes visible)
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Assert: me() must NOT be called again — user=null means unauthenticated,
    // not "needs a re-check". Re-checking on every tab-focus when already logged
    // out is the source of the 3-call loop.
    expect(authApiMock.me).toHaveBeenCalledTimes(callsAfterMount);
  });

  // ── 2. visibilitychange SHOULD re-check when user is authenticated ──

  it("calls authApi.me when visibilitychange fires while user IS authenticated", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    // First call (initAuth) succeeds
    authApiMock.me.mockResolvedValueOnce({ data: mockUser });
    // Second call (visibilitychange) also succeeds
    authApiMock.me.mockResolvedValueOnce({ data: mockUser });

    let capturedCtx!: AuthContextType;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer
            onRender={(ctx) => {
              capturedCtx = ctx;
            }}
          />
        </AuthProvider>
      );
    });

    expect(capturedCtx.user).not.toBeNull();
    expect(authApiMock.me).toHaveBeenCalledTimes(1);

    // Act: tab becomes visible — should re-validate the session
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The re-check IS expected when the user is logged in (cross-tab sync)
    expect(authApiMock.me).toHaveBeenCalledTimes(2);
  });

  // ── 3. Concurrent visibilitychange bursts deduplicate to a single in-flight fetch ──

  it("deduplicates concurrent fetchCurrentUser calls from rapid visibilitychange events", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    // Slow me() — stays pending so we can fire multiple events before it resolves
    let resolveMeFirst!: (val: { data: typeof mockUser }) => void;
    const firstMePromise = new Promise<{ data: typeof mockUser }>((resolve) => {
      resolveMeFirst = resolve;
    });

    authApiMock.me.mockReturnValueOnce(firstMePromise);
    authApiMock.me.mockResolvedValue({ data: mockUser }); // subsequent calls resolve immediately

    let capturedCtx!: AuthContextType;

    // Start render — initAuth fires fetchCurrentUser, which is now in-flight
    render(
      <AuthProvider>
        <AuthConsumer
          onRender={(ctx) => {
            capturedCtx = ctx;
          }}
        />
      </AuthProvider>
    );

    // At this point initAuth has called me() once (pending). User is still null.
    // Fire two rapid visibilitychange events BEFORE the first fetch resolves.
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Now resolve the initial me() call
    await act(async () => {
      resolveMeFirst({ data: mockUser });
    });

    // Only the 1 call from initAuth should have been made.
    // The two visibilitychange events with user=null and an in-flight fetch
    // must NOT trigger additional me() calls.
    expect(authApiMock.me).toHaveBeenCalledTimes(1);
    void capturedCtx; // suppress unused-variable lint
  });

  // ── 4. The exact 3-call pattern is NOT reproduced after the fix ──

  it("authApi.me is called at most once on mount even if visibilitychange fires during init", async () => {
    // Arrange: me() rejects with 401 (unauthenticated)
    authApiMock.me.mockRejectedValue(new ApiError(401, "unauthorized", "Missing authentication"));

    // Simulate tab being visible the whole time
    Object.defineProperty(document, "hidden", { value: false, configurable: true });

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onRender={() => {}} />
        </AuthProvider>
      );

      // Fire visibilitychange synchronously during the same tick as mount
      // This is the exact sequence that triggers the 3-call bug: mount fires
      // initAuth, then visibilitychange fires before it resolves, then the
      // bugwatch-auth-expired event causes another effect re-register.
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // After the fix: exactly 1 call (from initAuth). The two visibility events
    // during the unauthenticated state must be no-ops.
    expect(authApiMock.me).toHaveBeenCalledTimes(1);
  });

  // ── 5. bugwatch-auth-expired event does not trigger a re-fetch ──

  it("bugwatch-auth-expired event clears user but does not trigger another fetchCurrentUser", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    // initAuth succeeds — user is set
    authApiMock.me.mockResolvedValueOnce({ data: mockUser });

    let capturedCtx!: AuthContextType;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer
            onRender={(ctx) => {
              capturedCtx = ctx;
            }}
          />
        </AuthProvider>
      );
    });

    expect(capturedCtx.user).not.toBeNull();
    expect(authApiMock.me).toHaveBeenCalledTimes(1);

    // Simulate fetchWithAuth dispatching the session-expired event
    await act(async () => {
      window.dispatchEvent(new Event("bugwatch-auth-expired"));
    });

    // user must be cleared
    expect(capturedCtx.user).toBeNull();

    // The event handler must NOT call fetchCurrentUser — it only clears state
    expect(authApiMock.me).toHaveBeenCalledTimes(1);
  });

  // ── 6. visibilitychange after bugwatch-auth-expired does not re-fetch ──

  it("visibilitychange after session expiry does not trigger a new authApi.me call", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    authApiMock.me.mockResolvedValueOnce({ data: mockUser });

    let capturedCtx!: AuthContextType;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer
            onRender={(ctx) => {
              capturedCtx = ctx;
            }}
          />
        </AuthProvider>
      );
    });

    // Session expires
    await act(async () => {
      window.dispatchEvent(new Event("bugwatch-auth-expired"));
    });

    expect(capturedCtx.user).toBeNull();
    const callCountAfterExpiry = authApiMock.me.mock.calls.length; // should be 1

    // User switches back to the tab
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // This is the key regression assertion: switching to the tab while logged out
    // must NOT re-trigger an authApi.me call, which would start the 401 → refresh
    // → 401 → refresh chain all over again.
    expect(authApiMock.me).toHaveBeenCalledTimes(callCountAfterExpiry);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authApiMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../api");
    authApiMock = mod.authApi;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Edge 1: tab hidden → becomes visible while user is set → me() called (normal cross-tab sync) ──

  it("calls me() when tab becomes visible while user is authenticated (normal cross-tab sync)", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    // First call (initAuth) succeeds, second (visibility re-check) also succeeds
    authApiMock.me.mockResolvedValueOnce({ data: mockUser });
    authApiMock.me.mockResolvedValueOnce({ data: mockUser });

    let capturedCtx!: AuthContextType;

    // Start with the tab hidden
    Object.defineProperty(document, "hidden", { value: true, configurable: true });

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer
            onRender={(ctx) => {
              capturedCtx = ctx;
            }}
          />
        </AuthProvider>
      );
    });

    expect(capturedCtx.user).not.toBeNull();
    expect(authApiMock.me).toHaveBeenCalledTimes(1);

    // Tab becomes visible — should trigger a re-check for cross-tab sync
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(authApiMock.me).toHaveBeenCalledTimes(2);
  });

  // ── Edge 2: visibilitychange fires while fetchCurrentUser is in-flight → second call skipped ──

  it("skips second visibilitychange fetch when one is already in-flight (isFetchingRef guard)", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    // Slow first me() — stays pending until we manually resolve it
    let resolveMeFirst!: (val: { data: typeof mockUser }) => void;
    const firstMePromise = new Promise<{ data: typeof mockUser }>((resolve) => {
      resolveMeFirst = resolve;
    });

    authApiMock.me.mockReturnValueOnce(firstMePromise);
    // Any subsequent call would resolve immediately — but it must NOT be reached
    authApiMock.me.mockResolvedValue({ data: mockUser });

    let capturedCtx!: AuthContextType;

    // Render — initAuth calls me() (now in-flight / pending)
    render(
      <AuthProvider>
        <AuthConsumer
          onRender={(ctx) => {
            capturedCtx = ctx;
          }}
        />
      </AuthProvider>
    );

    // Resolve initial fetch so user is set and isInitializedRef = true
    await act(async () => {
      resolveMeFirst({ data: mockUser });
    });

    expect(capturedCtx.user).not.toBeNull();
    expect(authApiMock.me).toHaveBeenCalledTimes(1);

    // Set up a new slow me() for the visibility re-check
    let resolveMeSecond!: (val: { data: typeof mockUser }) => void;
    const secondMePromise = new Promise<{ data: typeof mockUser }>((resolve) => {
      resolveMeSecond = resolve;
    });
    authApiMock.me.mockReturnValueOnce(secondMePromise);
    authApiMock.me.mockResolvedValue({ data: mockUser });

    // Fire visibility event — me() starts (in-flight)
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Fire a second visibility event while the first me() is still in-flight
    // The isFetchingRef guard must block this second call
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Resolve the in-flight call
    await act(async () => {
      resolveMeSecond({ data: mockUser });
    });

    // Only 1 additional me() call (the first visibility event), not 2
    expect(authApiMock.me).toHaveBeenCalledTimes(2);
    void capturedCtx; // suppress unused-variable lint
  });

  // ── Edge 3: logout() then immediate visibilitychange → me() is NOT called ──

  it("does not call me() on visibilitychange immediately after logout (user is null)", async () => {
    const mockUser = { id: "u1", email: "a@b.com", name: "A", created_at: "", organization: null };

    // initAuth succeeds — user is set
    authApiMock.me.mockResolvedValueOnce({ data: mockUser });
    // logout API call succeeds
    const { authApi: authApiModule } = await import("../api");
    vi.mocked(authApiModule.logout).mockResolvedValue(undefined as never);

    let capturedCtx!: AuthContextType;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer
            onRender={(ctx) => {
              capturedCtx = ctx;
            }}
          />
        </AuthProvider>
      );
    });

    expect(capturedCtx.user).not.toBeNull();
    expect(authApiMock.me).toHaveBeenCalledTimes(1);

    // Perform logout — user becomes null
    await act(async () => {
      await capturedCtx.logout();
    });

    expect(capturedCtx.user).toBeNull();
    const callsAfterLogout = authApiMock.me.mock.calls.length; // still 1

    // Immediately fire visibilitychange — must NOT trigger me() since user is null
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(authApiMock.me).toHaveBeenCalledTimes(callsAfterLogout);
  });
});
