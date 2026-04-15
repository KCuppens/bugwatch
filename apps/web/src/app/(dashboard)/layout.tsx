"use client";

import dynamic from "next/dynamic";
import { AuthGuard } from "@/components/auth-guard";
import { ErrorBoundary } from "@/components/error-boundary";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ProjectProvider } from "@/lib/project-context";
import { PaywallProvider } from "@/lib/paywall-context";

// Rarely-opened dialogs — keep them out of the initial dashboard chunk.
const PaywallModal = dynamic(() => import("@/components/paywall-modal").then((m) => m.PaywallModal), { ssr: false });
const KeyboardShortcutsDialog = dynamic(
  () => import("@/components/keyboard-shortcuts-dialog").then((m) => m.KeyboardShortcutsDialog),
  { ssr: false }
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ProjectProvider>
        <PaywallProvider>
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
                <div className="p-6 animate-fade-in-up">{children}</div>
              </main>
            </div>
            <PaywallModal />
            <KeyboardShortcutsDialog />
          </CommandPaletteProvider>
        </PaywallProvider>
      </ProjectProvider>
    </AuthGuard>
  );
}
