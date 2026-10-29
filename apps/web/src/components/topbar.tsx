"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { billingApi, projectsApi, overviewApi, type BillingDashboard } from "@/lib/api";
import { type Tier } from "@/hooks/use-feature";
import { Search, HelpCircle, LogOut, User, Settings, BookOpen, Keyboard, Bug, Mail, ExternalLink, CreditCard, Users, FolderOpen, Activity } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useCommandPalette } from "@/components/command-palette";
import { NotificationCenter } from "@/components/notification-center";
import { ProjectSelector } from "@/components/project-selector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PROJECT_LIMIT: Record<Tier, number | null> = {
  free: 1,
  pro: null,
  team: null,
  enterprise: null,
};

const MONITOR_LIMIT: Record<Tier, number | null> = {
  free: 1,
  pro: 10,
  team: 25,
  enterprise: null,
};

const TIER_CONFIG: Record<Tier, { label: string; className: string }> = {
  free: { label: "Free", className: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]" },
  pro: { label: "Pro", className: "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]" },
  team: { label: "Team", className: "bg-purple-500/20 text-purple-400" },
  enterprise: { label: "Enterprise", className: "bg-amber-500/20 text-amber-400" },
};

export function Topbar() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { setOpen: openCommandPalette } = useCommandPalette();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [projectTotal, setProjectTotal] = useState<number | null>(null);
  const [monitorTotal, setMonitorTotal] = useState<number | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [isMac, setIsMac] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return false;
    const platform = navigator.platform || "";
    return /mac|iphone|ipad|ipod/i.test(platform);
  });

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.platform || nav.userAgentData?.platform || "";
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);

  useEffect(() => {
    if (menuOpen && !dashboard) {
      setLimitsLoading(true);
      Promise.all([
        billingApi.getBillingDashboard(),
        projectsApi.list(1, 1),
        overviewApi.getMonitorsAcrossProjects(),
      ])
        .then(([dash, proj, monitors]) => {
          setDashboard(dash);
          setProjectTotal(proj.pagination.total);
          setMonitorTotal(monitors.summary.total);
        })
        .catch(() => {})
        .finally(() => setLimitsLoading(false));
    }
  }, [menuOpen, dashboard]);

  const tier = (user?.organization?.tier ?? "free") as Tier;
  const tierConfig = TIER_CONFIG[tier];
  const projectLimit = PROJECT_LIMIT[tier];
  const monitorLimit = MONITOR_LIMIT[tier];
  const seatsUsed = dashboard?.seats_used ?? 0;
  const seatsTotal = dashboard?.seats_total ?? 1;
  const seatsPercent = Math.min((seatsUsed / seatsTotal) * 100, 100);
  const projectsPercent = projectLimit !== null && projectTotal !== null
    ? Math.min((projectTotal / projectLimit) * 100, 100) : 0;
  const monitorsPercent = monitorLimit !== null && monitorTotal !== null
    ? Math.min((monitorTotal / monitorLimit) * 100, 100) : 0;

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Logout failed — still navigate to login so the user is not stuck
    }
    router.push("/login");
  }, [logout, router]);

  return (
    <header className="fixed left-0 md:left-14 right-0 top-0 z-30 flex h-12 items-center border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface-1))] px-4">
      {/* Left: Project selector */}
      <div className="flex items-center gap-3 min-w-0 py-1.5">
        <ProjectSelector />
      </div>

      {/* Center: Search */}
      <div className="flex-1 flex items-center justify-center px-4">
        <button
          onClick={() => openCommandPalette(true)}
          aria-label="Open search and command palette (Ctrl+K or ⌘K)"
          className="flex items-center gap-2 h-8 w-full max-w-[480px] px-3 rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border-subtle))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border-strong))] hover:text-[hsl(var(--foreground))] transition-all duration-150 text-sm"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left text-sm">Search issues...</span>
          <kbd className="shrink-0 inline-flex h-5 items-center gap-0.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border-subtle))] px-1.5 font-mono text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            {isMac ? (
              <>
                <span className="text-xs">⌘</span>K
              </>
            ) : (
              <>Ctrl K</>
            )}
          </kbd>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-0.5">
        <NotificationCenter />

        {/* Help menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Help"
              className="h-8 w-8 rounded-md flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-3))] hover:text-[hsl(var(--foreground))] transition-colors duration-150"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push("/docs")}>
              <BookOpen className="mr-2 h-4 w-4" />
              Documentation
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
              }}
            >
              <Keyboard className="mr-2 h-4 w-4" />
              Keyboard Shortcuts
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="https://github.com/KCuppens/bugwatch/issues" target="_blank" rel="noopener noreferrer">
                <Bug className="mr-2 h-4 w-4" />
                Report a Bug
                <ExternalLink className="ml-auto h-3 w-3 text-[hsl(var(--muted-foreground))]" />
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="mailto:support@bugwatch.dev">
                <Mail className="mr-2 h-4 w-4" />
                Contact Support
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="User menu"
              className="flex items-center gap-2 h-8 px-2 rounded-md hover:bg-[hsl(var(--surface-3))] transition-colors duration-150 ml-0.5"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[10px] font-bold font-mono text-[hsl(var(--accent-foreground))]">
                {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
              </div>
              <span className="max-w-20 truncate text-sm text-[hsl(var(--foreground))] hidden sm:block">
                {user?.name || user?.email?.split("@")[0]}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* Identity */}
            <DropdownMenuLabel className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium font-sans truncate">{user?.name || "User"}</p>
                  <p className="text-xs font-normal text-[hsl(var(--muted-foreground))] truncate">{user?.email}</p>
                </div>
                <span className={`shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${tierConfig.className}`}>
                  {tierConfig.label}
                </span>
              </div>
            </DropdownMenuLabel>

            {/* Usage */}
            <div className="px-2 pb-2">
              <div className="rounded-md bg-[hsl(var(--surface-3))] p-2.5 space-y-3">
                {/* Projects */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                      <FolderOpen className="h-3 w-3" />
                      Projects
                    </span>
                    {limitsLoading ? (
                      <span className="text-[hsl(var(--muted-foreground))]">—</span>
                    ) : projectLimit !== null ? (
                      <span className="tabular-nums text-[hsl(var(--foreground))]">
                        {projectTotal ?? 0} <span className="text-[hsl(var(--muted-foreground))]">/ {projectLimit}</span>
                      </span>
                    ) : (
                      <span className="tabular-nums text-[hsl(var(--foreground))]">
                        {projectTotal ?? 0} <span className="text-[hsl(var(--muted-foreground))]">/ ∞</span>
                      </span>
                    )}
                  </div>
                  {projectLimit !== null && (
                    <Progress
                      value={limitsLoading ? 0 : projectsPercent}
                      className="h-1"
                      aria-label={`${projectTotal ?? 0} of ${projectLimit} projects used`}
                    />
                  )}
                </div>

                {/* Monitors */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                      <Activity className="h-3 w-3" />
                      Monitors
                    </span>
                    {limitsLoading ? (
                      <span className="text-[hsl(var(--muted-foreground))]">—</span>
                    ) : monitorLimit !== null ? (
                      <span className="tabular-nums text-[hsl(var(--foreground))]">
                        {monitorTotal ?? 0} <span className="text-[hsl(var(--muted-foreground))]">/ {monitorLimit}</span>
                      </span>
                    ) : (
                      <span className="tabular-nums text-[hsl(var(--foreground))]">
                        {monitorTotal ?? 0} <span className="text-[hsl(var(--muted-foreground))]">/ ∞</span>
                      </span>
                    )}
                  </div>
                  {monitorLimit !== null && (
                    <Progress
                      value={limitsLoading ? 0 : monitorsPercent}
                      className="h-1"
                      aria-label={`${monitorTotal ?? 0} of ${monitorLimit} monitors used`}
                    />
                  )}
                </div>

                {/* Seats */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                      <Users className="h-3 w-3" />
                      Seats
                    </span>
                    {limitsLoading ? (
                      <span className="text-[hsl(var(--muted-foreground))]">—</span>
                    ) : (
                      <span className="tabular-nums text-[hsl(var(--foreground))]">
                        {seatsUsed} <span className="text-[hsl(var(--muted-foreground))]">/ {seatsTotal}</span>
                      </span>
                    )}
                  </div>
                  <Progress
                    value={limitsLoading ? 0 : seatsPercent}
                    className="h-1"
                    aria-label={`${seatsUsed} of ${seatsTotal} seats used`}
                  />
                </div>
              </div>
              {tier === "free" && (
                <button
                  onClick={() => { setMenuOpen(false); router.push("/dashboard/settings?tab=billing"); }}
                  className="mt-1.5 w-full text-xs font-medium text-center py-1.5 rounded-md bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-2))] transition-colors"
                >
                  Upgrade to Pro
                </button>
              )}
            </div>

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings?tab=profile")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings?tab=billing")}>
              <CreditCard className="mr-2 h-4 w-4" />
              Billing
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
