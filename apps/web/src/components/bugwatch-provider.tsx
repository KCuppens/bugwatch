"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { BugwatchProvider as SdkBugwatchProvider, setUser, setTag } from "@bugwatch/nextjs/client";

/**
 * BugWatch Provider Component
 *
 * This component initializes the BugWatch client SDK and sets user context
 * when the user is authenticated.
 */
export function BugwatchProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();

  // Set user context when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      setUser({
        id: user.id,
        email: user.email,
        username: user.name || undefined,
      });
      // Tag events with self-monitoring source to avoid alerting loops
      setTag("source", "bugwatch-self-monitoring");
    } else {
      setUser(null);
    }
  }, [isAuthenticated, user]);

  return (
    <SdkBugwatchProvider
      options={{
        apiKey: "bw_live_3047f2aaca22496d8f1010960cff1595",
        environment: process.env.NODE_ENV,
        debug: process.env.NODE_ENV === "development",
      }}
    >
      {children}
    </SdkBugwatchProvider>
  );
}
