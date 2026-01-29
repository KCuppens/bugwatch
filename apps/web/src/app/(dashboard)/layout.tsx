"use client";

import { AuthGuard } from "@/components/auth-guard";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ProjectProvider } from "@/lib/project-context";
import { PaywallProvider } from "@/lib/paywall-context";
import { PaywallModal } from "@/components/paywall-modal";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ProjectProvider>
        <PaywallProvider>
          <CommandPaletteProvider>
            <div className="min-h-screen bg-background bg-gradient-mesh">
              <Sidebar />
              <Topbar />
              <main className="pl-64 pt-14">
                <div className="p-6">{children}</div>
              </main>
            </div>
            <PaywallModal />
          </CommandPaletteProvider>
        </PaywallProvider>
      </ProjectProvider>
    </AuthGuard>
  );
}
