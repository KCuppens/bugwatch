"use client";

import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Bug,
  FolderOpen,
  Settings,
  Activity,
  Search,
  Plus,
  Sparkles,
  LogOut,
  Moon,
  Sun,
  User,
  Home,
  Check,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";

// Mock recent issues - will be replaced with real data
const recentIssues = [
  { id: "1", title: "TypeError: Cannot read property 'map' of undefined", level: "error" },
  { id: "2", title: "ReferenceError: process is not defined", level: "fatal" },
  { id: "3", title: "Warning: Each child in a list should have a unique key", level: "warning" },
];

// Context for controlling command palette from anywhere
interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  }
  return context;
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Toggle with keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandPaletteContent open={open} setOpen={setOpen} />
    </CommandPaletteContext.Provider>
  );
}

interface CommandPaletteContentProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

function CommandPaletteContent({ open, setOpen }: CommandPaletteContentProps) {
  const router = useRouter();
  const { logout } = useAuth();
  const { setTheme } = useTheme();
  const { projects, selectedProject, selectProject } = useProject();
  const [search, setSearch] = useState("");

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />

      {/* Command Dialog */}
      <div className="fixed left-1/2 top-1/4 w-full max-w-lg -translate-x-1/2 rounded-lg border bg-background shadow-lg">
        <Command className="rounded-lg" loop>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search..."
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Quick Actions */}
            <Command.Group heading="Quick Actions" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Home className="h-4 w-4" />
                Go to Dashboard
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/projects"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <FolderOpen className="h-4 w-4" />
                View Projects
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/uptime"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Activity className="h-4 w-4" />
                View Uptime Monitors
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/settings"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Settings className="h-4 w-4" />
                Open Settings
              </Command.Item>
            </Command.Group>

            {/* Switch Project */}
            {projects.length > 0 && (
              <Command.Group heading="Switch Project" className="pb-2">
                {projects.map((project) => (
                  <Command.Item
                    key={project.id}
                    value={`switch-project-${project.name}`}
                    onSelect={() => runCommand(() => selectProject(project))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span className="flex-1">{project.name}</span>
                    {selectedProject?.id === project.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Recent Issues */}
            <Command.Group heading="Recent Issues" className="pb-2">
              {recentIssues.map((issue) => (
                <Command.Item
                  key={issue.id}
                  onSelect={() => runCommand(() => router.push(`/dashboard/issues/${issue.id}`))}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                >
                  <Bug className={`h-4 w-4 ${
                    issue.level === "fatal" ? "text-red-500" :
                    issue.level === "error" ? "text-orange-500" :
                    "text-yellow-500"
                  }`} />
                  <span className="truncate">{issue.title}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Create */}
            <Command.Group heading="Create" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/projects?create=true"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4" />
                New Project
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/uptime?create=true"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4" />
                New Uptime Monitor
              </Command.Item>
            </Command.Group>

            {/* AI */}
            <Command.Group heading="AI" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => console.log("AI Fix"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Sparkles className="h-4 w-4" />
                Generate AI Fix for Issue
              </Command.Item>
            </Command.Group>

            {/* Theme */}
            <Command.Group heading="Theme" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => setTheme("light"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Sun className="h-4 w-4" />
                Light Mode
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => setTheme("dark"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Moon className="h-4 w-4" />
                Dark Mode
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => setTheme("system"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <Settings className="h-4 w-4" />
                System Theme
              </Command.Item>
            </Command.Group>

            {/* Account */}
            <Command.Group heading="Account" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/settings"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
              >
                <User className="h-4 w-4" />
                Profile Settings
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(async () => {
                  await logout();
                  router.push("/login");
                })}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-red-500 aria-selected:bg-accent"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">↑↓</kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">↵</kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">Esc</kbd>
              <span>Close</span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
