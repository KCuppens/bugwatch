"use client";

import dynamic from "next/dynamic";
import { AuthGuard } from "@/components/auth-guard";
import { ErrorBoundary } from "@/components/error-boundary";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
const CommandPaletteProvider = dynamic(
  () => import("@/components/command-palette").then((m) => ({ default: m.CommandPaletteProvider })),
  { ssr: false }
);
import { QueryProvider } from "@/components/query-provider";
import { ProjectProvider } from "@/lib/project-context";
import { PaywallProvider } from "@/lib/paywall-context";
import { OnboardingProvider } from "@/lib/onboarding-context";

// Rarely-opened dialogs — keep them out of the initial dashboard chunk.
const PaywallModal = dynamic(() => import("@/components/paywall-modal").then((m) => m.PaywallModal), { ssr: false });
const KeyboardShortcutsDialog = dynamic(
  () => import("@/components/keyboard-shortcuts-dialog").then((m) => m.KeyboardShortcutsDialog),
  { ssr: false }
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <QueryProvider>
      <ProjectProvider>
        <PaywallProvider>
          <OnboardingProvider>
            <CommandPaletteProvider>
              <div className="min-h-screen bg-background">
                <a
                  href="#main-content"
                  className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-accent-foreground focus:rounded-lg"
                >
                  Skip to content
                </a>
                <ErrorBoundary
                  fallback={
                    <aside className="fixed left-0 top-0 z-40 h-screen w-14 border-r border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface-1))] flex flex-col p-2 gap-1">
                      <p className="text-xs text-[hsl(var(--muted-foreground))] px-2 py-1">Nav unavailable</p>
                    </aside>
                  }
                >
                  <Sidebar />
                </ErrorBoundary>
                <Topbar />
                <main id="main-content" className="ml-0 md:ml-14 pt-12">
                  <ErrorBoundary
                    fallback={
                      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8">
                        <p className="text-[hsl(var(--muted-foreground))] text-sm">
                          Something went wrong loading this page.
                        </p>
                        <button
                          onClick={() => window.location.reload()}
                          className="px-4 py-2 rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] text-sm font-medium hover:bg-[hsl(var(--accent))]/90 transition-colors"
                        >
                          Reload page
                        </button>
                      </div>
                    }
                  >
                    <div className="p-6">{children}</div>
                  </ErrorBoundary>
                </main>
              </div>
              <PaywallModal />
              <KeyboardShortcutsDialog />
            </CommandPaletteProvider>
          </OnboardingProvider>
        </PaywallProvider>
      </ProjectProvider>
      </QueryProvider>
    </AuthGuard>
  );
}
