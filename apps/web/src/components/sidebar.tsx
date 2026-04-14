"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Bug,
  Activity,
  Settings,
  FolderOpen,
  Bell,
  Crown,
  Sparkles,
  LayoutGrid,
  Server,
  Gauge,
  Video,
} from "lucide-react";
import { ProjectSelector } from "@/components/project-selector";
import { useTier, useFeature, getTierDisplayName, getTierRateLimit, isSelfHosted } from "@/hooks/use-feature";
import { usePaywall } from "@/lib/paywall-context";
import { useSidebarCounts } from "@/hooks/useSidebarCounts";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactElement;
}

const baseNavItems: NavItem[] = [
  { label: "Overview", href: "/overview", icon: <LayoutGrid className="h-4 w-4" /> },
  { label: "Issues", href: "/dashboard", icon: <Bug className="h-4 w-4" /> },
  { label: "Uptime", href: "/dashboard/uptime", icon: <Activity className="h-4 w-4" /> },
  { label: "Server", href: "/dashboard/server", icon: <Server className="h-4 w-4" /> },
  { label: "Alerts", href: "/dashboard/alerts", icon: <Bell className="h-4 w-4" /> },
  { label: "Projects", href: "/dashboard/projects", icon: <FolderOpen className="h-4 w-4" /> },
  { label: "Settings", href: "/dashboard/settings", icon: <Settings className="h-4 w-4" /> },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { tier, isPro } = useTier();
  const { openPaywall } = usePaywall();
  const { unresolvedCount, monitorsDownCount } = useSidebarCounts();
  const hasPerformance = useFeature("performance_monitoring");
  const hasReplay = useFeature("session_replay");

  // Memoized so nav items are stable across renders triggered by pathname/count changes
  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (hasPerformance) {
      const serverIndex = items.findIndex((item) => item.label === "Server");
      if (serverIndex >= 0) {
        items.splice(serverIndex + 1, 0, {
          label: "Performance",
          href: "/dashboard/performance",
          icon: <Gauge className="h-4 w-4" />,
        });
      }
    }
    if (hasReplay) {
      const insertAfter = items.findIndex((item) => item.label === "Performance");
      const idx =
        insertAfter >= 0 ? insertAfter + 1 : items.findIndex((item) => item.label === "Server") + 1 || items.length;
      items.splice(idx, 0, {
        label: "Replays",
        href: "/dashboard/replay",
        icon: <Video className="h-4 w-4" />,
      });
    }
    return items;
  }, [hasPerformance, hasReplay]);

  // Coerce to safe integer to guard against unexpected API response shapes
  const safeUnresolved = Math.max(0, Math.floor(Number(unresolvedCount) || 0));
  const safeDownCount = Math.max(0, Math.floor(Number(monitorsDownCount) || 0));

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "fixed left-0 top-0 z-40 h-screen w-64 border-r border-white/8 liquid-glass transition-transform md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-border-subtle px-4">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm shadow-accent/25 group-hover:scale-105 transition-transform">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M8 2v3" />
                <path d="M16 2v3" />
                <rect x="4" y="6" width="16" height="14" rx="5" />
                <path d="M4 13h16" />
              </svg>
            </span>
            <span className="font-display font-bold text-lg tracking-tight">BugWatch</span>
          </Link>
        </div>

        {/* Project Selector */}
        <div className="border-b border-border-subtle p-4">
          <ProjectSelector />
        </div>

        {/* Navigation */}
        <nav aria-label="Dashboard" className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 h-9 text-sm font-medium tracking-tight transition-all",
                  isActive
                    ? "bg-accent-2/12 text-accent-2 shadow-sm shadow-accent-2/10"
                    : "text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                )}
              >
                <span className={isActive ? "text-accent-2" : ""}>{item.icon}</span>
                {item.label}
                {item.label === "Issues" && safeUnresolved > 0 && (
                  <span
                    className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground"
                    aria-label={`${safeUnresolved > 99 ? "99+" : safeUnresolved} unresolved issues`}
                  >
                    <span aria-hidden="true">{safeUnresolved > 99 ? "99+" : safeUnresolved}</span>
                  </span>
                )}
                {item.label === "Uptime" && safeDownCount > 0 && (
                  <span
                    className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-500"
                    aria-label={`${safeDownCount} monitors down`}
                  >
                    <span aria-hidden="true">{safeDownCount} down</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        {!isSelfHosted() && (
          <div className="border-t border-border-subtle p-4">
            <div
              className={cn(
                "rounded-lg p-3 transition-all",
                isPro ? "bg-accent/10 border border-accent/20" : "bg-surface-3 border border-border-subtle"
              )}
            >
              <div className="flex items-center gap-1.5">
                {isPro && <Crown className="h-3.5 w-3.5 text-accent" />}
                <p className="text-xs font-medium">{getTierDisplayName(tier)} Plan</p>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {getTierRateLimit(tier).toLocaleString()} events/min
              </p>
              {!isPro && (
                <button
                  onClick={() => openPaywall()}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <Sparkles className="h-3 w-3" />
                  Upgrade to Pro
                </button>
              )}
              {isPro && (
                <Link
                  href="/dashboard/settings?tab=billing"
                  className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground"
                >
                  Manage subscription
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
