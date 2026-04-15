"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Search, HelpCircle, LogOut, User, Settings, BookOpen, Keyboard, Bug, Mail, ExternalLink } from "lucide-react";
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

export function Topbar() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { setOpen: openCommandPalette } = useCommandPalette();
  const [isMac, setIsMac] = useState<boolean | null>(null);

  useEffect(() => {
    const platform =
      navigator.platform ||
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      "";
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);

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
      <div className="flex items-center gap-3 min-w-0">
        <ProjectSelector />
      </div>

      {/* Center: Search */}
      <div className="flex-1 flex items-center justify-center px-4">
        <button
          onClick={() => openCommandPalette(true)}
          aria-label="Search issues"
          className="flex items-center gap-2 h-8 w-full max-w-[480px] px-3 rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border-subtle))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border-strong))] hover:text-[hsl(var(--foreground))] transition-all duration-150 text-sm"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left text-sm">Search issues...</span>
          {isMac !== null && (
            <kbd className="shrink-0 inline-flex h-5 items-center gap-0.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border-subtle))] px-1.5 font-mono text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
              {isMac ? (
                <>
                  <span className="text-xs">⌘</span>K
                </>
              ) : (
                <>Ctrl K</>
              )}
            </kbd>
          )}
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
        <DropdownMenu>
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
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="font-medium font-sans">{user?.name || "User"}</p>
              <p className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings?tab=profile")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
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
