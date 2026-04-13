"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  Search,
  HelpCircle,
  Moon,
  Sun,
  LogOut,
  User,
  Settings,
  Menu,
  BookOpen,
  Keyboard,
  Bug,
  Mail,
  ExternalLink,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCommandPalette } from "@/components/command-palette";
import { NotificationCenter } from "@/components/notification-center";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { setOpen: openCommandPalette } = useCommandPalette();
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const platform = navigator.platform || (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || "";
      setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
    }
  }, []);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="fixed md:left-64 left-0 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border-subtle bg-surface-1/95 backdrop-blur-lg px-6">
      {/* Search */}
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          aria-label="Toggle sidebar"
          className="md:hidden h-9 w-9 rounded-lg flex items-center justify-center hover:bg-surface-3 transition-colors"
        >
          <Menu className="h-5 w-5 text-muted-foreground" />
        </button>
        <button
          onClick={() => openCommandPalette(true)}
          aria-label="Search issues"
          className="flex items-center gap-2 h-9 w-9 sm:w-56 px-0 sm:px-3 justify-center sm:justify-start rounded-lg bg-surface-2 border border-border-subtle text-muted-foreground hover:bg-surface-3 hover:text-foreground transition-all"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline text-sm">Search issues...</span>
          <kbd className="hidden sm:inline-flex ml-auto h-5 items-center gap-0.5 rounded bg-surface-3 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            {isMac ? <><span className="text-xs">⌘</span>K</> : <>Ctrl K</>}
          </kbd>
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Help" className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-surface-3 transition-colors">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push("/docs")}>
              <BookOpen className="mr-2 h-4 w-4" />
              Documentation
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
            }}>
              <Keyboard className="mr-2 h-4 w-4" />
              Keyboard Shortcuts
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="https://github.com/KCuppens/bugwatch/issues" target="_blank" rel="noopener noreferrer">
                <Bug className="mr-2 h-4 w-4" />
                Report a Bug
                <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
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
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-surface-3 transition-colors"
        >
          <Sun className="h-4 w-4 text-muted-foreground rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 text-muted-foreground rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 h-9 px-2 rounded-lg hover:bg-surface-3 transition-colors">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
              </div>
              <span className="max-w-24 truncate text-sm">
                {user?.name || user?.email?.split("@")[0]}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="font-medium">{user?.name || "User"}</p>
              <p className="text-xs font-normal text-muted-foreground">{user?.email}</p>
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
