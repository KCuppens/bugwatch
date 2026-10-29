/**
 * Tests for AuthProvider responding to the 'bugwatch-auth-expired' event.
 *
 * When fetchWithAuth dispatches this event (refresh failed), AuthProvider
 * must clear local user state so AuthGuard can redirect to /login.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth, type AuthContextType } from "../auth-context";

// Mock the API so no real HTTP calls are made
vi.mock("../api", () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  },
  clearTokens: vi.fn(),
  refreshTokens: vi.fn().mockResolvedValue(false),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  },
}));

// Helper component that exposes the auth context value via a ref-style callback
function AuthConsumer({ onRender }: { onRender: (ctx: AuthContextType) => void }) {
  const ctx = useAuth();
  onRender(ctx);
  return null;
}

describe("AuthProvider — bugwatch-auth-expired event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears user state when bugwatch-auth-expired fires and the session has truly expired", async () => {
    const { authApi, ApiError } = await import("../api");

    // Simulate a logged-in user returned by /auth/me on mount
    vi.mocked(authApi.me).mockResolvedValueOnce({
      data: { id: "user-1", email: "test@example.com", name: "Test User" },
    } as never);

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

    // Auth should now be established
    expect(capturedCtx.isAuthenticated).toBe(true);

    // The event handler re-checks the session before clearing (another tab may
    // have refreshed the cookies). Here the session is genuinely gone, so the
    // re-check 401s and the user is cleared.
    vi.mocked(authApi.me).mockRejectedValueOnce(
      new ApiError(401, "unauthorized", "Session expired")
    );

    // Fire the session-expired event (as fetchWithAuth would on failed refresh)
    await act(async () => {
      window.dispatchEvent(new Event("bugwatch-auth-expired"));
    });

    // User state must be cleared so AuthGuard can redirect to /login
    expect(capturedCtx.isAuthenticated).toBe(false);
    expect(capturedCtx.user).toBeNull();
  });

  it("is a no-op when user is already null (unauthenticated)", async () => {
    const { authApi } = await import("../api");

    // Simulate no session cookie — me() rejects so user stays null
    vi.mocked(authApi.me).mockRejectedValue(new Error("Unauthorized"));

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

    expect(capturedCtx.isAuthenticated).toBe(false);

    // Firing the event when already logged out should not throw or change state
    await act(async () => {
      window.dispatchEvent(new Event("bugwatch-auth-expired"));
    });

    expect(capturedCtx.isAuthenticated).toBe(false);
    expect(capturedCtx.user).toBeNull();
  });
});
