"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { authApi, type User, ApiError } from "./api";

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

const TOKEN_REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes (tokens expire in 5)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearTokens = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setUser(null);
  }, []);

  const saveTokens = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);
  }, []);

  const refreshAccessToken = useCallback(async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return false;

    try {
      const response = await authApi.refresh(refreshToken);
      saveTokens(response.data.access_token, response.data.refresh_token);
      return true;
    } catch (error) {
      // Only clear tokens on actual auth failure (401)
      // Network errors or server errors should not log the user out
      if (error instanceof ApiError && error.status === 401) {
        clearTokens();
      }
      return false;
    }
  }, [saveTokens, clearTokens]);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await authApi.me();
      setUser(response.data);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Try to refresh the token
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          try {
            const response = await authApi.me();
            setUser(response.data);
            return true;
          } catch (retryError) {
            // Only clear tokens if retry also fails with 401
            if (retryError instanceof ApiError && retryError.status === 401) {
              clearTokens();
            }
          }
        }
      }
      // For network errors or server errors, keep existing user state
      // User stays "logged in" visually but API calls may fail temporarily
      return false;
    }
  }, [refreshAccessToken, clearTokens]);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      const accessToken = localStorage.getItem("access_token");
      if (accessToken) {
        await fetchCurrentUser();
      }
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
