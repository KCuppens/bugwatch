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
        apiKey: process.env.NEXT_PUBLIC_BUGWATCH_API_KEY || "",
        endpoint: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
        environment: process.env.NODE_ENV,
        debug: process.env.NODE_ENV === "development",
      }}
    >
      {children as Parameters<typeof SdkBugwatchProvider>[0]["children"]}
    </SdkBugwatchProvider>
  );
}
