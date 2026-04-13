"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ChevronDown,
  Search,
  Plus,
  Check,
  FolderOpen,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useProject } from "@/lib/project-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformIcon } from "@/components/platform-icon";
import { projectAvatarColor, projectInitial } from "@/lib/project-avatar";
import { useProjectStats } from "@/hooks/useProjectStats";
import { cn } from "@/lib/utils";
import type { Project, ProjectStatsWithInfo } from "@/lib/api";

function needsSetup(project: Project): boolean {
  return Boolean(!project.onboarding_completed_at && project.platform);
}

interface ProjectAvatarProps {
  name: string;
  size?: "sm" | "md";
}

function ProjectAvatar({ name, size = "md" }: ProjectAvatarProps) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-[11px] rounded-md" : "h-8 w-8 text-[13px] rounded-lg";
  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center font-semibold text-white font-display tracking-tight",
        sizeClass
      )}
      style={{ backgroundColor: projectAvatarColor(name) }}
      aria-hidden="true"
    >
      {projectInitial(name)}
    </div>
  );
}

interface UnresolvedBadgeProps {
  stat: ProjectStatsWithInfo | undefined;
  setupIncomplete: boolean;
}

function UnresolvedBadge({ stat, setupIncomplete }: UnresolvedBadgeProps) {
  if (stat && stat.unresolved_count > 0) {
    const isCritical = stat.critical_count > 0;
    const count = stat.unresolved_count > 99 ? "99+" : String(stat.unresolved_count);
    return (
      <span
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-full px-2 text-caption font-medium tabular-nums",
          isCritical
            ? "bg-destructive/10 text-destructive"
            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        )}
      >
        {isCritical && <AlertTriangle className="h-3 w-3" />}
        {count}
      </span>
    );
  }
  if (setupIncomplete) {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-amber-500/10 px-2 text-caption font-medium text-amber-600 dark:text-amber-400">
        Setup
      </span>
    );
  }
  return null;
}

interface ProjectItemProps {
  project: Project;
  stat: ProjectStatsWithInfo | undefined;
  isSelected: boolean;
  onSelect: () => void;
}

function ProjectItem({ project, stat, isSelected, onSelect }: ProjectItemProps) {
  const setupIncomplete = needsSetup(project);
  const platform = project.platform || stat?.project_platform || null;

  return (
    <Command.Item
      value={project.name}
      onSelect={onSelect}
      className="flex h-12 cursor-pointer items-center gap-3 rounded-lg px-2 aria-selected:bg-accent-2/10 aria-selected:text-accent-2 transition-colors"
    >
      <ProjectAvatar name={project.name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium truncate tracking-tight">{project.name}</span>
        </div>
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground truncate">
          {platform && (
            <>
              <PlatformIcon platform={platform} className="h-3 w-3" />
              <span className="capitalize">{platform}</span>
            </>
          )}
          {platform && stat && stat.unresolved_count > 0 && <span aria-hidden="true">·</span>}
          {stat && stat.unresolved_count > 0 && (
            <span className="tabular-nums">
              {stat.unresolved_count} unresolved
            </span>
          )}
          {!platform && !stat?.unresolved_count && (
            <span className="text-muted-foreground/60">No activity yet</span>
          )}
        </div>
      </div>
      <UnresolvedBadge stat={stat} setupIncomplete={setupIncomplete} />
      {isSelected && <Check className="h-4 w-4 text-accent-2 shrink-0" aria-label="Current project" />}
    </Command.Item>
  );
}

function SkeletonRow() {
  return (
    <div className="flex h-12 items-center gap-3 px-2">
      <Skeleton className="h-7 w-7 rounded-md" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}

export function ProjectSelector() {
  const router = useRouter();
  const {
    projects,
    selectedProject,
    recentProjects,
    isLoading,
    selectProject,
  } = useProject();
  const { stats, isLoading: statsLoading } = useProjectStats();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform || ""));
    }
  }, []);

  // Global keyboard shortcut: Cmd/Ctrl+P
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = useCallback(
    (project: Project) => {
      selectProject(project);
      setOpen(false);
      setSearch("");
    },
    [selectProject]
  );

  const handleCreateNew = useCallback(
    (prefilledName?: string) => {
      setOpen(false);
      setSearch("");
      const qs = prefilledName ? `?name=${encodeURIComponent(prefilledName)}` : "";
      router.push(`/dashboard/projects/new${qs}`);
    },
    [router]
  );

  const filteredProjects = useMemo(
    () =>
      search
        ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
        : projects,
    [projects, search]
  );

  const recentIds = useMemo(() => new Set(recentProjects.map((p) => p.id)), [recentProjects]);
  const otherProjects = useMemo(
    () => filteredProjects.filter((p) => !recentIds.has(p.id)),
    [filteredProjects, recentIds]
  );

  const filteredRecentProjects = useMemo(
    () =>
      search
        ? recentProjects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
        : recentProjects,
    [recentProjects, search]
  );

  const selectedStat = selectedProject ? stats.get(selectedProject.id) : undefined;
  const selectedPlatform =
    selectedProject?.platform || selectedStat?.project_platform || null;
  const selectedUnresolved = selectedStat?.unresolved_count ?? 0;
  const selectedCritical = selectedStat?.critical_count ?? 0;

  const hasNoMatches = Boolean(
    search && filteredProjects.length === 0 && filteredRecentProjects.length === 0
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch project"
          className="group flex h-12 w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-3 text-left transition-all hover:bg-surface-3 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-accent-2/40"
        >
          {isLoading ? (
            <>
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </>
          ) : selectedProject ? (
            <>
              <ProjectAvatar name={selectedProject.name} />
              <div className="flex-1 min-w-0">
                <div className="text-body font-medium truncate tracking-tight text-foreground">
                  {selectedProject.name}
                </div>
                <div className="flex items-center gap-1.5 text-caption text-muted-foreground truncate">
                  {selectedPlatform && (
                    <>
                      <PlatformIcon platform={selectedPlatform} className="h-3 w-3" />
                      <span className="capitalize">{selectedPlatform}</span>
                    </>
                  )}
                  {selectedPlatform && selectedUnresolved > 0 && <span aria-hidden="true">·</span>}
                  {selectedUnresolved > 0 && (
                    <span
                      className={cn(
                        "tabular-nums font-medium",
                        selectedCritical > 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {selectedUnresolved > 99 ? "99+" : selectedUnresolved} unresolved
                    </span>
                  )}
                  {!selectedPlatform && selectedUnresolved === 0 && !statsLoading && (
                    <span className="text-muted-foreground/60">All clear</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="h-8 w-8 rounded-lg bg-surface-3 flex items-center justify-center">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 text-body text-muted-foreground">Select project</div>
            </>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">
              <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                {isMac ? "⌘" : "Ctrl"} P
              </kbd>
            </span>
            <ChevronDown
              className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0 elev-2 border-0 overflow-hidden"
        align="start"
        sideOffset={8}
      >
        <Command className="rounded-2xl" loop shouldFilter={false}>
          {/* Search Input */}
          <div className="flex items-center border-b border-border-subtle px-3 focus-within:border-accent-2/40 transition-colors">
            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search projects…"
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-body outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            {isLoading ? (
              <div className="space-y-1">
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : (
              <>
                <Command.Empty className="py-6 text-center text-body-sm text-muted-foreground">
                  {hasNoMatches ? (
                    <div className="flex flex-col items-center gap-3 px-4">
                      <span>No project matches &ldquo;{search}&rdquo;</span>
                      <button
                        type="button"
                        onClick={() => handleCreateNew(search)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent-2/10 px-3 py-1.5 text-caption font-medium text-accent-2 hover:bg-accent-2/20 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        Create &ldquo;{search}&rdquo;
                      </button>
                    </div>
                  ) : (
                    "No projects found"
                  )}
                </Command.Empty>

                {/* Recent */}
                {filteredRecentProjects.length > 0 && !search && (
                  <Command.Group
                    heading={
                      <span className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted-foreground px-1 pt-2 pb-1">
                        <Clock className="h-3 w-3 text-accent-2" />
                        Recent
                      </span>
                    }
                  >
                    {filteredRecentProjects.map((project) => (
                      <ProjectItem
                        key={`recent-${project.id}`}
                        project={project}
                        stat={stats.get(project.id)}
                        isSelected={selectedProject?.id === project.id}
                        onSelect={() => handleSelect(project)}
                      />
                    ))}
                  </Command.Group>
                )}

                {/* All / filtered */}
                <Command.Group
                  heading={
                    search ? undefined : (
                      <span className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted-foreground px-1 pt-3 pb-1">
                        <FolderOpen className="h-3 w-3 text-accent-2" />
                        {recentProjects.length > 0 ? "All projects" : "Projects"}
                      </span>
                    )
                  }
                >
                  {(search ? filteredProjects : otherProjects).map((project) => (
                    <ProjectItem
                      key={project.id}
                      project={project}
                      stat={stats.get(project.id)}
                      isSelected={selectedProject?.id === project.id}
                      onSelect={() => handleSelect(project)}
                    />
                  ))}
                </Command.Group>

                {/* Create */}
                {!hasNoMatches && (
                  <div className="border-t border-border-subtle mt-1 pt-1">
                    <Command.Item
                      value="__create-new-project__"
                      onSelect={() => handleCreateNew()}
                      className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-body-sm font-medium aria-selected:bg-accent-2/10 aria-selected:text-accent-2 transition-colors"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-2/10 text-accent-2">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                      New project
                    </Command.Item>
                  </div>
                )}
              </>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2 text-caption text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">
                {isMac ? "⌘" : "Ctrl"}
              </kbd>
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">P</kbd>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">↑↓</kbd>
              <span>navigate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[10px]">↵</kbd>
              <span>select</span>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
