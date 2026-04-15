"use client";

import { useEffect, useState, useCallback, useRef, createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Bug,
  FolderOpen,
  Settings,
  Activity,
  Search,
  Plus,
  LogOut,
  Moon,
  Sun,
  User,
  Home,
  Check,
  Keyboard,
  Bell,
  BellOff,
  CheckCircle2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { overviewApi, issuesApi, type IssueWithProject } from "@/lib/api";
import { toast } from "sonner";

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
  const [recentIssues, setRecentIssues] = useState<IssueWithProject[]>([]);
  const issuesCacheRef = useRef<{ data: IssueWithProject[]; timestamp: number } | null>(null);

  // Fetch real issues when palette opens (with 30s cache)
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    if (issuesCacheRef.current && now - issuesCacheRef.current.timestamp < 30000) {
      setRecentIssues(issuesCacheRef.current.data);
      return;
    }
    overviewApi
      .getIssuesAcrossProjects({ limit: 5 })
      .then((res) => {
        setRecentIssues(res.data);
        issuesCacheRef.current = { data: res.data, timestamp: Date.now() };
      })
      .catch((err) => {
        console.error("Failed to fetch recent issues for command palette:", err);
      });
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, setOpen]);

  const runCommand = useCallback(
    (command: () => void | Promise<void>) => {
      setOpen(false);
      command();
    },
    [setOpen]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />

      {/* Command Dialog */}
      <div className="fixed left-1/2 top-[18%] w-full max-w-xl -translate-x-1/2 surface-raised overflow-hidden">
        <Command className="rounded-2xl" loop>
          <div className="flex items-center border-b border-border-subtle px-4">
            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search issues, projects, actions..."
              className="flex h-14 w-full rounded-md bg-transparent py-3 text-body outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">No results found.</Command.Empty>

            {/* Quick Actions */}
            <Command.Group heading="Quick Actions" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Home className="h-4 w-4" />
                Go to Dashboard
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/projects"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <FolderOpen className="h-4 w-4" />
                View Projects
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/uptime"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Activity className="h-4 w-4" />
                View Uptime Monitors
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/settings"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Settings className="h-4 w-4" />
                Open Settings
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/alerts"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Bell className="h-4 w-4" />
                View Alert Rules
              </Command.Item>
              <Command.Item
                onSelect={() =>
                  runCommand(() => {
                    // Dispatch keyboard event to trigger shortcuts dialog
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Keyboard className="h-4 w-4" />
                Keyboard Shortcuts
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
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span className="flex-1">{project.name}</span>
                    {selectedProject?.id === project.id && <Check className="h-4 w-4 text-accent-2" />}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Recent Issues */}
            {recentIssues.length > 0 && (
              <Command.Group heading="Recent Issues" className="pb-2">
                {recentIssues.map((issue) => (
                  <Command.Item
                    key={issue.id}
                    value={`issue-${issue.title}-${issue.project_name}`}
                    onSelect={() => runCommand(() => router.push(`/dashboard/issues/${issue.id}`))}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
                  >
                    <Bug
                      className={`h-4 w-4 ${
                        issue.level === "fatal"
                          ? "text-red-500"
                          : issue.level === "error"
                            ? "text-orange-500"
                            : issue.level === "warning"
                              ? "text-yellow-500"
                              : "text-muted-foreground"
                      }`}
                    />
                    <span className="truncate flex-1">{issue.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{issue.project_name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Issue Actions */}
            {recentIssues.length > 0 && (
              <Command.Group heading="Issue Actions" className="pb-2">
                {recentIssues.slice(0, 5).map((issue) => (
                  <Command.Item
                    key={`resolve-${issue.id}`}
                    value={`resolve ${issue.title}`}
                    onSelect={() =>
                      runCommand(async () => {
                        try {
                          await issuesApi.update(issue.project_id, issue.id, "resolved");
                          toast.success("Issue resolved", {
                            description: issue.title,
                            action: {
                              label: "Undo",
                              onClick: async () => {
                                try {
                                  await issuesApi.update(issue.project_id, issue.id, "unresolved");
                                } catch {
                                  toast.error("Failed to undo");
                                }
                              },
                            },
                          });
                        } catch {
                          toast.error("Failed to resolve issue");
                        }
                      })
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
                  >
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                    <span className="truncate flex-1">Resolve: {issue.title}</span>
                  </Command.Item>
                ))}
                {recentIssues.slice(0, 5).map((issue) => (
                  <Command.Item
                    key={`ignore-${issue.id}`}
                    value={`ignore ${issue.title}`}
                    onSelect={() =>
                      runCommand(async () => {
                        try {
                          await issuesApi.update(issue.project_id, issue.id, "ignored");
                          toast.success("Issue ignored", {
                            description: issue.title,
                            action: {
                              label: "Undo",
                              onClick: async () => {
                                try {
                                  await issuesApi.update(issue.project_id, issue.id, "unresolved");
                                } catch {
                                  toast.error("Failed to undo");
                                }
                              },
                            },
                          });
                        } catch {
                          toast.error("Failed to ignore issue");
                        }
                      })
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
                  >
                    <BellOff className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate flex-1">Ignore: {issue.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Create */}
            <Command.Group heading="Create" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/projects?create=true"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Plus className="h-4 w-4" />
                New Project
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/uptime?create=true"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Plus className="h-4 w-4" />
                New Uptime Monitor
              </Command.Item>
            </Command.Group>

            {/* Theme */}
            <Command.Group heading="Theme" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => setTheme("light"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Sun className="h-4 w-4" />
                Light Mode
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => setTheme("dark"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Moon className="h-4 w-4" />
                Dark Mode
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => setTheme("system"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <Settings className="h-4 w-4" />
                System Theme
              </Command.Item>
            </Command.Group>

            {/* Account */}
            <Command.Group heading="Account" className="pb-2">
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard/settings"))}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent-2/10 aria-selected:text-accent-2"
              >
                <User className="h-4 w-4" />
                Profile Settings
              </Command.Item>
              <Command.Item
                onSelect={() =>
                  runCommand(async () => {
                    try {
                      await logout();
                    } catch {
                      // Still navigate to login even if logout API fails
                    }
                    router.push("/login");
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-red-500 aria-selected:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2.5 text-caption text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">
                ↑↓
              </kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">
                ↵
              </kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">
                Esc
              </kbd>
              <span>Close</span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
