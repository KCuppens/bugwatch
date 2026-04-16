"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderOpen,
  Plus,
  Settings,
  Bug,
  Clock,
  Copy,
  Check,
  AlertCircle,
  ArrowRight,
  Flame,
  Users,
  Activity,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  projectsApi,
  overviewApi,
  type Project,
  type Platform,
  type Framework,
  type ProjectStatsWithInfo,
} from "@/lib/api";
import { getPlatformConfig, getFrameworkConfig } from "@/lib/sdk-config";
import { toast } from "sonner";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

function getHealthColor(stats: ProjectStatsWithInfo | undefined): { dot: string; label: string } {
  if (!stats) return { dot: "bg-gray-400", label: "No data" };
  if (stats.critical_count > 0) return { dot: "bg-red-500", label: "Critical" };
  if (stats.unresolved_count > 5) return { dot: "bg-yellow-500", label: "Needs attention" };
  return { dot: "bg-green-500", label: "Healthy" };
}

export default function ProjectsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectStats, setProjectStats] = useState<Map<string, ProjectStatsWithInfo>>(new Map());

  useEffect(() => {
    async function fetchProjects() {
      setIsLoading(true);
      setError(null);

      try {
        const [projectsRes, statsRes] = await Promise.all([
          projectsApi.list(),
          overviewApi.getStatsByProject().catch(() => null),
        ]);
        setProjects(projectsRes.data);

        // Build stats map
        if (statsRes?.data) {
          const statsMap = new Map<string, ProjectStatsWithInfo>();
          for (const stat of statsRes.data) {
            statsMap.set(stat.project_id, stat);
          }
          setProjectStats(statsMap);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
        toast.error("Failed to load projects", {
          description: err instanceof Error ? err.message : "Please try again",
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchProjects();
  }, []);

  async function copyApiKey(id: string, apiKey: string) {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedId(id);
      toast.success("API key copied");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy — clipboard not available");
    }
  }

  function getProjectBadge(project: Project) {
    if (!project.platform || !project.framework) return null;
    const platformConfig = getPlatformConfig(project.platform as Platform);
    const frameworkConfig = getFrameworkConfig(project.platform as Platform, project.framework as Framework);
    if (!platformConfig || !frameworkConfig) return null;
    return {
      platform: platformConfig.name,
      framework: frameworkConfig.name,
    };
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-10 rounded-md" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-8 w-full rounded-md" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4 animate-fade-in-up">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-lg font-medium">Failed to load projects</h2>
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => window.location.reload()}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-heading-lg">Projects</h1>
          <p className="text-body-sm text-muted-foreground mt-1">Manage your projects and API keys</p>
        </div>
        <Link href="/dashboard/projects/new">
          <Button variant="success">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Projects Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => {
          const badge = getProjectBadge(project);
          const needsOnboarding = !project.onboarding_completed_at && project.platform;
          const stats = projectStats.get(project.id);
          const health = getHealthColor(stats);

          return (
            <Card key={project.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-accent-2/10 p-2 relative">
                      <FolderOpen className="h-4 w-4 text-accent-2" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{project.name}</CardTitle>
                        {/* Health indicator dot */}
                        <span className={`h-2 w-2 rounded-full ${health.dot}`} title={health.label}>
                          <span className="sr-only">{health.label}</span>
                        </span>
                      </div>
                      <CardDescription className="text-xs">{project.slug}</CardDescription>
                    </div>
                  </div>
                  <Link href={`/dashboard/projects/${project.id}/settings`} aria-label={`Settings for ${project.name}`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Settings className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Platform/Framework Badge */}
                {badge && (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-accent-2/10 px-2.5 py-0.5 text-caption font-medium text-accent-2">
                      {badge.platform}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {badge.framework}
                    </span>
                  </div>
                )}

                {/* Continue Setup Banner */}
                {needsOnboarding && (
                  <Link
                    href={`/dashboard/projects/${project.id}/settings`}
                    className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950"
                  >
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Complete setup</span>
                    <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </Link>
                )}

                {/* Real Stats */}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Bug className="h-3 w-3" />
                    <span>{stats?.unresolved_count ?? 0} issues</span>
                  </div>
                  {stats && stats.critical_count > 0 && (
                    <div className="flex items-center gap-1 text-red-500">
                      <Flame className="h-3 w-3" />
                      <span>{stats.critical_count} critical</span>
                    </div>
                  )}
                  {stats && stats.total_events > 0 && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Activity className="h-3 w-3" />
                      <span>{stats.total_events.toLocaleString()}</span>
                    </div>
                  )}
                  {stats && stats.total_users > 0 && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{stats.total_users}</span>
                    </div>
                  )}
                  {!stats && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{formatRelativeTime(project.created_at)}</span>
                    </div>
                  )}
                </div>

                {/* API Key */}
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">API Key</span>
                  <div role="group" aria-label={`API key for ${project.name}`} className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs font-mono">
                      {revealedId === project.id ? (
                        project.api_key
                      ) : (
                        <>
                          {project.api_key.slice(0, 8)}
                          <span aria-hidden="true">{"•".repeat(12)}</span>
                          <span className="sr-only">hidden</span>
                        </>
                      )}
                    </code>
                    <span aria-live="polite" className="sr-only">
                      {revealedId === project.id ? "API key revealed" : ""}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label={revealedId === project.id ? "Hide API key" : "Reveal API key"}
                      onClick={() => setRevealedId(revealedId === project.id ? null : project.id)}
                    >
                      {revealedId === project.id ? (
                        <EyeOff className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Eye className="h-3 w-3" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label={copiedId === project.id ? "API key copied" : "Copy API key"}
                      onClick={() => copyApiKey(project.id, project.api_key)}
                    >
                      {copiedId === project.id ? (
                        <Check className="h-3 w-3 text-bug" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3 w-3" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Link href={`/dashboard?project=${project.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      View Issues
                    </Button>
                  </Link>
                  <Link href={`/dashboard/projects/${project.id}/settings`}>
                    <Button variant="outline" size="sm">
                      Settings
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Empty State / Create New */}
        <Card className="flex flex-col items-center justify-center border-dashed border-bug/50 p-6 hover:border-bug transition-colors">
          <div className="rounded-full bg-bug/10 p-3">
            <Plus className="h-6 w-6 text-bug" />
          </div>
          <h3 className="mt-4 font-medium">Create a new project</h3>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Get started by creating a project for your application
          </p>
          <Link href="/dashboard/projects/new">
            <Button className="mt-4" variant="outline">
              New Project
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}
