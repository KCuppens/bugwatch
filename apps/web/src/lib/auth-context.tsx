"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  authApi,
  type User,
  ApiError,
  saveTokens as apiSaveTokens,
  clearTokens as apiClearTokens,
  refreshTokens,
  isTokenExpired,
} from "./api";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Refresh 5 minutes before expiry (backend default is 1 hour = 3600s)
// Refresh at 55 minutes to be safe
const TOKEN_REFRESH_INTERVAL = 55 * 60 * 1000; // 55 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearTokens = useCallback(() => {
    apiClearTokens();
    setUser(null);
  }, []);

  const saveTokens = useCallback((accessToken: string, refreshToken: string) => {
    apiSaveTokens(accessToken, refreshToken);
  }, []);

  // Use the deduplicated refresh from api.ts
  const refreshAccessToken = useCallback(async () => {
    const success = await refreshTokens();
    if (!success) {
      // If refresh failed due to invalid token, user state will be cleared
      // by the clearTokens call in refreshTokens
      const hasRefreshToken = localStorage.getItem("refresh_token");
      if (!hasRefreshToken) {
        setUser(null);
      }
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
      }
      // For network errors or server errors, keep existing user state
      return false;
    }
  }, [clearTokens]);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      const accessToken = localStorage.getItem("access_token");
      const refreshToken = localStorage.getItem("refresh_token");

      if (!accessToken && !refreshToken) {
        setIsLoading(false);
        return;
      }

      // If access token is expired but refresh token exists, try refresh first
      if (!accessToken || isTokenExpired(accessToken)) {
        if (refreshToken) {
          // Try to refresh - if it fails due to network error, we'll still try
          // to fetch the user (the API might come back online).
          // If it fails due to 401, refreshTokens() already cleared tokens.
          const refreshed = await refreshTokens();
          if (!refreshed) {
            // Check if tokens were cleared by refreshTokens (401 case)
            const stillHasRefreshToken = localStorage.getItem("refresh_token");
            if (!stillHasRefreshToken) {
              // Token was invalid, already cleared
              setIsLoading(false);
              return;
            }
            // Network error - tokens still exist, try to proceed anyway
            // The user might see a brief loading state while server starts
          }
        } else {
          // No refresh token - clear any stale access token
          apiClearTokens();
          setIsLoading(false);
          return;
        }
      }

      await fetchCurrentUser();
      setIsLoading(false);
    };

    initAuth();
  }, [fetchCurrentUser]);

  // Set up token refresh interval
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      refreshAccessToken();
    }, TOKEN_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [user, refreshAccessToken]);

  // Cross-tab synchronization via storage events
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "access_token") {
        if (!e.newValue) {
          // Token removed in another tab - logout
          setUser(null);
        } else if (!user) {
          // Token added in another tab - fetch user
          fetchCurrentUser();
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [user, fetchCurrentUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login(email, password);
      saveTokens(
        response.data.tokens.access_token,
        response.data.tokens.refresh_token
      );
      setUser(response.data.user);
    },
    [saveTokens]
  );

  const signup = useCallback(
    async (email: string, password: string, name?: string) => {
      const response = await authApi.signup(email, password, name);
      saveTokens(
        response.data.tokens.access_token,
        response.data.tokens.refresh_token
      );
      setUser(response.data.user);
    },
    [saveTokens]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors - clear tokens anyway
    }
    clearTokens();
  }, [clearTokens]);

  const refreshUser = useCallback(async () => {
    await fetchCurrentUser();
  }, [fetchCurrentUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
