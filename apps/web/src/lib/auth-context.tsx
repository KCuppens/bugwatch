"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import { authApi, type User, ApiError, clearTokens as apiClearTokens, refreshTokens } from "./api";

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Refresh 2 minutes before expiry. Backend default: 15 minutes / 900 s (keep in
// sync with apps/server/src/config.rs jwt_access_expiration). Refresh at 13 min.
const TOKEN_REFRESH_INTERVAL = 13 * 60 * 1000; // 13 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isFetchingRef = useRef(false);
  const isInitializedRef = useRef(false);
  // Keep a ref in sync with user state — event handlers read this to avoid
  // stale-closure issues without re-registering listeners on every state change.
  const userRef = useRef<User | null>(user);
  userRef.current = user;

  const clearTokens = useCallback(() => {
    apiClearTokens();
    setUser(null);
  }, []);

  // Use the deduplicated refresh from api.ts
  const refreshAccessToken = useCallback(async () => {
    const success = await refreshTokens();
    if (!success) {
      setUser(null);
    }
    return success;
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    if (isFetchingRef.current) return false;
    isFetchingRef.current = true;
    try {
      const response = await authApi.me();
      setUser(response.data);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearTokens();
      } else {
        console.debug("[Auth] Failed to fetch current user:", error);
      }
      return false;
    } finally {
      isFetchingRef.current = false;
    }
  }, [clearTokens]);

  // Initialize auth state on mount.
  // httpOnly cookies are opaque to JS, so we try to fetch the current user
  // directly — the browser sends cookies automatically.
  useEffect(() => {
    let cancelled = false;
    const initAuth = async () => {
      // Clean up any legacy localStorage tokens from before httpOnly migration
      apiClearTokens();

      // Try to fetch the current user — cookies are sent automatically.
      // If no valid session cookie exists, this returns 401 and we stay logged out.
      await fetchCurrentUser();
      if (!cancelled) {
        isInitializedRef.current = true;
        setIsLoading(false);
      }
    };

    initAuth();
    return () => {
      cancelled = true;
    };
  }, [fetchCurrentUser]);

  // Stable boolean — dep array uses this instead of `!!user` inline to satisfy
  // exhaustive-deps while preventing the interval from resetting on every
  // refreshUser() call that returns a new object reference.
  const isAuthenticated = !!user;

  // Set up token refresh interval.
  // If refresh fails, refreshAccessToken calls setUser(null), which triggers the
  // effect cleanup (clearInterval) — so the interval self-cancels on first failure.
  // No explicit backoff needed: a failed refresh means the session is gone.
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      void refreshAccessToken().catch((e) => console.debug("[Auth] Token refresh failed:", e));
    }, TOKEN_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [isAuthenticated, refreshAccessToken]);

  // When fetchWithAuth gets a persistent 401 (refresh failed — session fully
  // expired), it dispatches this event so the auth context can clear local state
  // and let AuthGuard redirect to /login instead of showing a raw auth error.
  useEffect(() => {
    const handleSessionExpired = () => {
      // Re-check the session before clearing — another tab may have already
      // refreshed the httpOnly cookies, making this session still valid.
      // fetchCurrentUser handles both outcomes: on success it updates the user
      // state; on 401 it calls clearTokens() internally. The isFetchingRef guard
      // prevents re-entrant calls if this event fires while a fetch is in flight.
      void fetchCurrentUser();
    };
    window.addEventListener("bugwatch-auth-expired", handleSessionExpired);
    return () => window.removeEventListener("bugwatch-auth-expired", handleSessionExpired);
  }, [fetchCurrentUser]);

  // Cross-tab synchronization: httpOnly cookies are shared across tabs automatically.
  // Listen for visibility changes to re-check auth state when user returns to tab.
  // userRef avoids stale closure — the handler reads the latest value without
  // needing `user` in deps, which would re-register the listener on every login/logout.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) return;
      if (!isInitializedRef.current) return;
      if (userRef.current === null) return;
      void fetchCurrentUser().catch((e) => console.debug("[Auth] Visibility re-check failed:", e));
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchCurrentUser]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await authApi.login(email, password);
      setUser(response.data.user);
    } catch (error) {
      if (error instanceof ApiError) throw error; // Pass through — callers handle specific codes
      throw new ApiError(0, "network_error", "Unable to connect. Please check your connection and try again.");
    }
  }, []);

  const signup = useCallback(async (email: string, password: string, name?: string) => {
    try {
      const response = await authApi.signup(email, password, name);
      setUser(response.data.user);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, "network_error", "Unable to connect. Please check your connection and try again.");
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (e) {
      // Ignore logout errors — clear local session regardless
      console.debug("Logout API call failed:", e);
    }
    clearTokens();
  }, [clearTokens]);

  const refreshUser = useCallback(async () => {
    await fetchCurrentUser();
  }, [fetchCurrentUser]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      signup,
      logout,
      refreshUser,
    }),
    [user, isLoading, login, signup, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
