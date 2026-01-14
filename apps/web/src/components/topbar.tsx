"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  Search,
  Bell,
  HelpCircle,
  Moon,
  Sun,
  LogOut,
  User,
  Settings,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCommandPalette } from "@/components/command-palette";

export function Topbar() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { setOpen: openCommandPalette } = useCommandPalette();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="fixed left-64 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-background/80 backdrop-blur-xl px-6">
      {/* Search */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => openCommandPalette(true)}
          className="flex items-center gap-2 w-64 h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all"
        >
          <Search className="h-4 w-4" />
          <span className="text-sm">Search issues...</span>
          <kbd className="ml-auto inline-flex h-5 items-center gap-1 rounded bg-white/10 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors relative">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent" />
        </button>
        <button className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <Sun className="h-4 w-4 text-muted-foreground rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 text-muted-foreground rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </button>

        {/* User Menu */}
        <div className="relative ml-2">
          <div className="group">
            <button className="flex items-center gap-2 h-9 px-2 rounded-lg hover:bg-white/10 transition-colors">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
              </div>
              <span className="max-w-24 truncate text-sm">
                {user?.name || user?.email?.split("@")[0]}
              </span>
            </button>
            <div className="absolute right-0 top-full mt-1 hidden w-48 rounded-xl glass-card p-1.5 shadow-xl group-hover:block">
              <div className="px-3 py-2 text-sm">
                <p className="font-medium">{user?.name || "User"}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <div className="my-1 border-t border-white/10" />
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10 transition-colors">
                <User className="h-4 w-4" />
                Profile
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10 transition-colors">
                <Settings className="h-4 w-4" />
                Settings
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
