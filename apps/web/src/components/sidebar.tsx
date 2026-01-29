"use client";

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
} from "lucide-react";
import { ProjectSelector } from "@/components/project-selector";
import { useTier, getTierDisplayName, getTierRateLimit } from "@/hooks/use-feature";
import { usePaywall } from "@/lib/paywall-context";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: "Issues", href: "/dashboard", icon: <Bug className="h-4 w-4" /> },
  { label: "Uptime", href: "/dashboard/uptime", icon: <Activity className="h-4 w-4" /> },
  { label: "Alerts", href: "/dashboard/alerts", icon: <Bell className="h-4 w-4" /> },
  { label: "Projects", href: "/dashboard/projects", icon: <FolderOpen className="h-4 w-4" /> },
  { label: "Settings", href: "/dashboard/settings", icon: <Settings className="h-4 w-4" /> },
];

export function Sidebar() {
  const pathname = usePathname();
  const { tier, isPro } = useTier();
  const { openPaywall } = usePaywall();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-white/10 bg-background/80 backdrop-blur-xl">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-white/10 px-4">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-xl group-hover:scale-110 transition-transform">🐛</span>
            <span className="font-bold text-lg">BugWatch</span>
          </Link>
        </div>

        {/* Project Selector */}
        <div className="border-b border-white/10 p-4">
          <ProjectSelector />
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                  isActive
                    ? "bg-accent/15 text-accent font-medium shadow-sm shadow-accent/10"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <span className={isActive ? "text-accent" : ""}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 p-4">
          <div className={cn(
            "rounded-lg p-3 transition-all",
            isPro
              ? "bg-accent/10 border border-accent/20"
              : "bg-white/5 border border-white/10"
          )}>
            <div className="flex items-center gap-1.5">
              {isPro && <Crown className="h-3.5 w-3.5 text-accent" />}
              <p className="text-xs font-medium">{getTierDisplayName(tier)} Plan</p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {getTierRateLimit(tier).toLocaleString()} events/min
            </p>
            {!isPro && (
              <button
                onClick={() => {
                  console.log('Upgrade to Pro clicked - opening paywall');
                  openPaywall();
                }}
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
      </div>
    </aside>
  );
}
