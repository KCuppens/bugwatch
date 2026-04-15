"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
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
    try {
      // The api.ts fetchWithAuth will automatically handle 401 retry
      const response = await authApi.me();
      setUser(response.data);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Token refresh already attempted by fetchWithAuth and failed
        clearTokens();
      } else {
        // Network errors or 5xx — keep existing user state, log for observability
        console.debug("[Auth] Failed to fetch current user:", error);
      }
      return false;
    }
  }, [clearTokens]);

  // Initialize auth state on mount.
  // httpOnly cookies are opaque to JS, so we try to fetch the current user
  // directly — the browser sends cookies automatically.
  useEffect(() => {
    const initAuth = async () => {
      // Clean up any legacy localStorage tokens from before httpOnly migration
      apiClearTokens();

      // Try to fetch the current user — cookies are sent automatically.
      // If no valid session cookie exists, this returns 401 and we stay logged out.
      await fetchCurrentUser();
      setIsLoading(false);
    };

    initAuth();
  }, [fetchCurrentUser]);

  // Set up token refresh interval
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      void refreshAccessToken().catch((e) => console.debug("[Auth] Token refresh failed:", e));
    }, TOKEN_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [user, refreshAccessToken]);

  // When fetchWithAuth gets a persistent 401 (refresh failed — session fully
  // expired), it dispatches this event so the auth context can clear local state
  // and let AuthGuard redirect to /login instead of showing a raw auth error.
  useEffect(() => {
    const handleSessionExpired = () => {
      clearTokens();
    };
    window.addEventListener("bugwatch-auth-expired", handleSessionExpired);
    return () => window.removeEventListener("bugwatch-auth-expired", handleSessionExpired);
  }, [clearTokens]);

  // Cross-tab synchronization: httpOnly cookies are shared across tabs automatically.
  // Listen for visibility changes to re-check auth state when user returns to tab.
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && !user) {
        void fetchCurrentUser().catch((e) => console.debug("[Auth] Visibility re-check failed:", e));
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [user, fetchCurrentUser]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setUser(response.data.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, name?: string) => {
    const response = await authApi.signup(email, password, name);
    setUser(response.data.user);
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
