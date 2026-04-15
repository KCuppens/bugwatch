"use client";

import { AuthGuard } from "@/components/auth-guard";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-[hsl(var(--background))]">{children}</div>
    </AuthGuard>
  );
}
