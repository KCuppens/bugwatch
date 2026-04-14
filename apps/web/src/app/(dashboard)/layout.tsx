"use client";

import { useState } from "react";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <AuthGuard>
      <ProjectProvider>
        <PaywallProvider>
          <CommandPaletteProvider>
            <div className="min-h-screen bg-background bg-gradient-mesh">
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-accent-foreground focus:rounded-lg"
              >
                Skip to content
              </a>
              <ErrorBoundary
                fallback={
                  <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-white/8 liquid-glass md:translate-x-0 hidden md:flex flex-col p-4 gap-2">
                    <p className="text-xs text-muted-foreground px-2 py-1">Navigation unavailable</p>
                  </aside>
                }
              >
                <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
              </ErrorBoundary>
              {/* Mobile sidebar overlay */}
              {sidebarOpen && (
                <div
                  className="fixed inset-0 z-30 bg-black/50 md:hidden"
                  onClick={() => setSidebarOpen(false)}
                  aria-hidden="true"
                />
              )}
              <Topbar onMenuClick={() => setSidebarOpen((prev) => !prev)} />
              <main
                id="main-content"
                className="md:pl-64 pt-14"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...(sidebarOpen ? ({ inert: "" } as any) : {})}
              >
                <div className="p-6">{children}</div>
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
