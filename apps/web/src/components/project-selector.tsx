"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ChevronDown,
  Search,
  Plus,
  Check,
  FolderOpen,
  Clock,
  Loader2,
} from "lucide-react";
import { useProject } from "@/lib/project-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api";

function getProjectStatus(project: Project): "healthy" | "needs-setup" | "inactive" {
  if (!project.onboarding_completed_at && project.platform) {
    return "needs-setup";
  }
  return "healthy";
}

function getStatusColor(status: "healthy" | "needs-setup" | "inactive"): string {
  switch (status) {
    case "healthy":
      return "bg-green-500";
    case "needs-setup":
      return "bg-yellow-500";
    case "inactive":
      return "bg-gray-400";
  }
}

interface ProjectItemProps {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
}

function ProjectItem({ project, isSelected, onSelect }: ProjectItemProps) {
  const status = getProjectStatus(project);

  return (
    <Command.Item
      value={project.name}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
    >
      <div className={cn("h-2 w-2 rounded-full", getStatusColor(status))} />
      <div className="flex-1 truncate">
        <span className="font-medium">{project.name}</span>
        {status === "needs-setup" && (
          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
            Setup incomplete
          </span>
        )}
      </div>
      {isSelected && <Check className="h-4 w-4 text-primary" />}
    </Command.Item>
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Global keyboard shortcut: Cmd/Ctrl+P
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
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

  const handleCreateNew = useCallback(() => {
    setOpen(false);
    router.push("/dashboard/projects/new");
  }, [router]);

  // Filter projects based on search
  const filteredProjects = search
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  // Get non-recent projects (all projects minus recent ones)
  const recentIds = new Set(recentProjects.map((p) => p.id));
  const otherProjects = filteredProjects.filter((p) => !recentIds.has(p.id));

  // Filter recent projects if searching
  const filteredRecentProjects = search
    ? recentProjects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    : recentProjects;

  const status = selectedProject ? getProjectStatus(selectedProject) : "inactive";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm hover:bg-muted transition-colors">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn("h-2 w-2 rounded-full shrink-0", getStatusColor(status))} />
            <span className="truncate">
              {isLoading ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : selectedProject ? (
                selectedProject.name
              ) : (
                <span className="text-muted-foreground">Select project</span>
              )}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        sideOffset={8}
      >
        <Command className="rounded-lg" loop shouldFilter={false}>
          {/* Search Input */}
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search projects..."
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <Command.List className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                  No projects found.
                </Command.Empty>

                {/* Recent Projects */}
                {filteredRecentProjects.length > 0 && !search && (
                  <Command.Group
                    heading={
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Recent
                      </span>
                    }
                    className="px-2 py-1.5"
                  >
                    {filteredRecentProjects.map((project) => (
                      <ProjectItem
                        key={project.id}
                        project={project}
                        isSelected={selectedProject?.id === project.id}
                        onSelect={() => handleSelect(project)}
                      />
                    ))}
                  </Command.Group>
                )}

                {/* All Projects (or filtered results) */}
                <Command.Group
                  heading={
                    search ? undefined : (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <FolderOpen className="h-3 w-3" />
                        {recentProjects.length > 0 ? "All Projects" : "Projects"}
                      </span>
                    )
                  }
                  className="px-2 py-1.5"
                >
                  {(search ? filteredProjects : otherProjects).map((project) => (
                    <ProjectItem
                      key={project.id}
                      project={project}
                      isSelected={selectedProject?.id === project.id}
                      onSelect={() => handleSelect(project)}
                    />
                  ))}
                </Command.Group>

                {/* Create New */}
                <div className="border-t px-2 py-1.5">
                  <Command.Item
                    value="create-new-project"
                    onSelect={handleCreateNew}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <Plus className="h-4 w-4" />
                    <span>New Project</span>
                  </Command.Item>
                </div>
              </>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-3 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">
                {typeof navigator !== "undefined" &&
                navigator.platform.includes("Mac")
                  ? "⌘"
                  : "Ctrl"}
              </kbd>
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">P</kbd>
              <span>to open</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↑↓</kbd>
              <span>navigate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↵</kbd>
              <span>select</span>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
