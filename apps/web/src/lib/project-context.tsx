"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { projectsApi, type Project } from "@/lib/api";

const STORAGE_KEYS = {
  selectedProjectId: "bugwatch:selectedProjectId",
  recentProjects: "bugwatch:recentProjects",
} as const;

const MAX_RECENT_PROJECTS = 3;

interface ProjectContextValue {
  projects: Project[];
  selectedProject: Project | null;
  recentProjects: Project[];
  isLoading: boolean;
  error: string | null;
  selectProject: (project: Project) => void;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function getStoredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEYS.selectedProjectId);
}

function setStoredProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(STORAGE_KEYS.selectedProjectId, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.selectedProjectId);
  }
}

function getStoredRecentProjectIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.recentProjects);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStoredRecentProjectIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.recentProjects, JSON.stringify(ids));
}

function addToRecentProjects(projectId: string, currentRecent: string[]): string[] {
  // Remove if already exists
  const filtered = currentRecent.filter((id) => id !== projectId);
  // Add to front
  const updated = [projectId, ...filtered];
  // Keep max items
  return updated.slice(0, MAX_RECENT_PROJECTS);
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await projectsApi.list(1, 100);
      const fetchedProjects = response.data;
      setProjects(fetchedProjects);

      // Get stored project ID and validate
      const storedId = getStoredProjectId();
      const storedRecent = getStoredRecentProjectIds();
      setRecentProjectIds(storedRecent);

      if (storedId) {
        // Find the stored project
        const storedProject = fetchedProjects.find((p) => p.id === storedId);
        if (storedProject) {
          setSelectedProject(storedProject);
        } else {
          // Stored project no longer exists, select first
          const firstProject = fetchedProjects[0];
          if (firstProject) {
            setSelectedProject(firstProject);
            setStoredProjectId(firstProject.id);
          }
        }
      } else {
        // No stored project, select first
        const firstProject = fetchedProjects[0];
        if (firstProject) {
          setSelectedProject(firstProject);
          setStoredProjectId(firstProject.id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const selectProject = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setStoredProjectId(project.id);

      // Update recent projects
      const updatedRecent = addToRecentProjects(project.id, recentProjectIds);
      setRecentProjectIds(updatedRecent);
      setStoredRecentProjectIds(updatedRecent);
    },
    [recentProjectIds]
  );

  // Map recent IDs to projects
  const recentProjects = recentProjectIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => p !== undefined);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        selectedProject,
        recentProjects,
        isLoading,
        error,
        selectProject,
        refreshProjects: fetchProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}
