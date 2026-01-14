"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FolderOpen,
  Plus,
  Settings,
  Bug,
  Clock,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { projectsApi, type Project, type Platform, type Framework } from "@/lib/api";
import { getPlatformConfig, getFrameworkConfig } from "@/lib/sdk-config";

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

export default function ProjectsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProjects() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await projectsApi.list();
        setProjects(response.data);
      } catch (err) {
        console.error("Failed to fetch projects:", err);
        setError(err instanceof Error ? err.message : "Failed to load projects");
      } finally {
        setIsLoading(false);
      }
    }

    fetchProjects();
  }, []);

  function copyApiKey(id: string, apiKey: string) {
    navigator.clipboard.writeText(apiKey);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getProjectBadge(project: Project) {
    if (!project.platform || !project.framework) return null;
    const platformConfig = getPlatformConfig(project.platform as Platform);
    const frameworkConfig = getFrameworkConfig(
      project.platform as Platform,
      project.framework as Framework
    );
    if (!platformConfig || !frameworkConfig) return null;
    return {
      platform: platformConfig.name,
      framework: frameworkConfig.name,
    };
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
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
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Manage your projects and API keys
          </p>
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
          const needsOnboarding =
            !project.onboarding_completed_at && project.platform;

          return (
            <Card key={project.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-primary/10 p-2">
                      <FolderOpen className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{project.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {project.slug}
                      </CardDescription>
                    </div>
                  </div>
                  <Link href={`/dashboard/projects/${project.id}/settings`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Platform/Framework Badge */}
                {badge && (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
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
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Complete setup
                    </span>
                    <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </Link>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Bug className="h-3 w-3" />
                    <span>0 issues</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatRelativeTime(project.created_at)}</span>
                  </div>
                </div>

                {/* API Key */}
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">API Key</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs font-mono">
                      {project.api_key}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => copyApiKey(project.id, project.api_key)}
                    >
                      {copiedId === project.id ? (
                        <Check className="h-3 w-3 text-bug" />
                      ) : (
                        <Copy className="h-3 w-3" />
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
