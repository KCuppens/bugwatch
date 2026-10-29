"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Bug, Activity, Settings, FolderOpen, Bell, LayoutGrid, Server, Gauge, Video, ScrollText } from "lucide-react";
import { ActivationChecklist } from "@/components/onboarding/ActivationChecklist";
import { useFeature, getFeatureTier, type Tier } from "@/hooks/use-feature";
import { usePaywall } from "@/lib/paywall-context";
import { useSidebarCounts } from "@/hooks/useSidebarCounts";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactElement;
  badgeCount?: number;
  badgeVariant?: "red" | "default";
  gatedTier?: Tier;
}

// BW logomark SVG
function BWMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="4" y="6" width="16" height="14" rx="5" />
      <path d="M4 13h16" />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { openPaywall } = usePaywall();
  const { unresolvedCount, monitorsDownCount, limitsWarningCount } = useSidebarCounts();
  const hasPerformance = useFeature("performance_monitoring");
  const hasReplay = useFeature("session_replay");
  const hasLogs = useFeature("log_monitoring");

  const issueCount = Math.max(0, Number(unresolvedCount) || 0);
  const monitorDownCount = Math.max(0, Number(monitorsDownCount) || 0);

  const navItems = useMemo((): NavItem[] => {
    const items: NavItem[] = [
      {
        label: "Overview",
        href: "/overview",
        icon: <LayoutGrid className="h-5 w-5" />,
      },
      {
        label: "Issues",
        href: "/dashboard",
        icon: <Bug className="h-5 w-5" />,
        badgeCount: issueCount,
        badgeVariant: "red",
      },
      {
        label: "Uptime",
        href: "/dashboard/uptime",
        icon: <Activity className="h-5 w-5" />,
        badgeCount: monitorDownCount,
        badgeVariant: "red",
      },
      {
        label: "Server",
        href: "/dashboard/server",
        icon: <Server className="h-5 w-5" />,
      },
    ];

    items.push({
      label: "Performance",
      href: "/dashboard/performance",
      icon: <Gauge className="h-5 w-5" />,
      ...(!hasPerformance && { gatedTier: getFeatureTier("performance_monitoring") }),
    });

    items.push({
      label: "Replays",
      href: "/dashboard/replay",
      icon: <Video className="h-5 w-5" />,
      ...(!hasReplay && { gatedTier: getFeatureTier("session_replay") }),
    });

    items.push({
      label: "Logs",
      href: "/dashboard/logs",
      icon: <ScrollText className="h-5 w-5" />,
      ...(!hasLogs && { gatedTier: getFeatureTier("log_monitoring") }),
    });

    items.push(
      {
        label: "Alerts",
        href: "/dashboard/alerts",
        icon: <Bell className="h-5 w-5" />,
      },
      {
        label: "Projects",
        href: "/dashboard/projects",
        icon: <FolderOpen className="h-5 w-5" />,
      }
    );

    return items;
  }, [hasPerformance, hasReplay, hasLogs, issueCount, monitorDownCount]);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside
      aria-label="Main navigation"
      className="fixed left-0 top-0 z-40 h-screen w-14 flex flex-col border-r border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface-1))] group hover:w-48 focus-within:w-48 transition-[width] duration-150 ease-out overflow-hidden"
    >
      {/* Logo */}
      <Link
        href="/dashboard"
        aria-label="BugWatch home"
        className="flex h-12 w-14 shrink-0 items-center justify-center border-b border-[hsl(var(--border-subtle))] hover:bg-[hsl(var(--surface-3))] transition-colors"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
          <BWMark className="h-4 w-4" />
        </span>
        <span className="ml-2.5 font-sans font-semibold text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          BugWatch
        </span>
      </Link>

      {/* Nav items */}
      <nav aria-label="Dashboard" className="flex-1 flex flex-col gap-0.5 py-3 px-1.5">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const showBadge = item.badgeCount !== undefined && item.badgeCount > 0;
          const tierLabel = item.gatedTier ? item.gatedTier.charAt(0).toUpperCase() + item.gatedTier.slice(1) : null;
          const tierBadgeChar = item.gatedTier === "team" ? "T" : item.gatedTier === "enterprise" ? "E" : "P";
          const itemClassName = cn(
            "group/item relative flex items-center h-9 rounded-md px-2 text-sm font-medium transition-all duration-150 w-full text-left",
            active
              ? "bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] border-l-[3px] border-[hsl(var(--accent))] pl-[5px]"
              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-3))] hover:text-[hsl(var(--foreground))] border-l-[3px] border-transparent"
          );
          const itemContent = (
            <>
              {/* Icon — always visible, fixed width */}
              <span className="shrink-0 flex items-center justify-center w-5 h-5 relative" aria-hidden="true">
                {item.icon}
                {showBadge && (
                  <span
                    className="absolute -top-1 -right-1.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-mono font-bold flex items-center justify-center leading-none"
                    aria-label={`${item.badgeCount} ${item.label === "Issues" ? "unresolved" : "down"}`}
                  >
                    {(item.badgeCount ?? 0) > 99 ? "99+" : item.badgeCount}
                  </span>
                )}
                {item.gatedTier && (
                  <span className="absolute -top-1 -right-1.5 h-3 w-3 rounded-full bg-[hsl(var(--accent))]/20 border border-[hsl(var(--accent))]/40 flex items-center justify-center">
                    <span className="text-[7px] text-[hsl(var(--accent))] font-bold leading-none">{tierBadgeChar}</span>
                  </span>
                )}
              </span>

              {/* Label — visible on hover-expand */}
              <span className="ml-2.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 font-sans">
                {item.label}
                {tierLabel && <span className="ml-1.5 text-[10px] text-[hsl(var(--accent))] font-medium">{tierLabel}</span>}
              </span>
            </>
          );

          return item.gatedTier ? (
            <button
              key={item.href}
              onClick={() => openPaywall()}
              aria-label={`${item.label} — requires ${tierLabel} plan`}
              className={itemClassName}
            >
              {itemContent}
            </button>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={itemClassName}
            >
              {itemContent}
            </Link>
          );
        })}
      </nav>

      {/* Onboarding checklist — above Settings */}
      <ActivationChecklist />

      {/* Settings — pinned to bottom */}
      <div className="py-3 px-1.5 border-t border-[hsl(var(--border-subtle))]">
        <Link
          href="/dashboard/settings"
          title="Settings"
          className={cn(
            "flex items-center h-9 rounded-md px-2 text-sm font-medium transition-all duration-150 border-l-[3px]",
            isActive("/dashboard/settings")
              ? "bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] border-[hsl(var(--accent))] pl-[5px]"
              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-3))] hover:text-[hsl(var(--foreground))] border-transparent"
          )}
        >
          <span className="shrink-0 flex items-center justify-center w-5 h-5 relative" aria-hidden="true">
            <Settings className="h-5 w-5" />
            {limitsWarningCount > 0 && (
              <span
                className="absolute -top-1 -right-1.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-mono font-bold flex items-center justify-center leading-none"
                aria-label={`${limitsWarningCount} subscription limit${limitsWarningCount > 1 ? "s" : ""} near capacity`}
              >
                {limitsWarningCount}
              </span>
            )}
          </span>
          <span className="ml-2.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 font-sans">
            Settings
          </span>
        </Link>
      </div>
    </aside>
  );
}
