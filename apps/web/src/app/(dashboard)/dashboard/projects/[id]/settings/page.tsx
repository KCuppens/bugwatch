"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { projectsApi, type Project, type Platform, type Framework } from "@/lib/api";
import {
  getSDKContent,
  interpolateApiKey,
  getPlatformConfig,
  getFrameworkConfig,
} from "@/lib/sdk-config";
import { CodeBlock, InstallCommand } from "@/components/onboarding/CodeBlock";

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function fetchProject() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await projectsApi.get(projectId);
        setProject(response.data);
        setName(response.data.name);
      } catch (err) {
        console.error("Failed to fetch project:", err);
        setError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        setIsLoading(false);
      }
    }

    fetchProject();
  }, [projectId]);

  function copyApiKey() {
    if (!project) return;
    navigator.clipboard.writeText(project.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRotateKey() {
    if (!project) return;
    if (!confirm("Are you sure you want to rotate the API key? The old key will stop working immediately.")) {
      return;
    }

    setIsRotating(true);
    try {
      const response = await projectsApi.rotateApiKey(projectId);
      setProject(response.data);
    } catch (err) {
      console.error("Failed to rotate API key:", err);
    } finally {
      setIsRotating(false);
    }
  }

  async function handleSave() {
    if (!project || !name.trim()) return;

    setIsSaving(true);
    try {
      const response = await projectsApi.update(projectId, { name: name.trim() });
      setProject(response.data);
    } catch (err) {
      console.error("Failed to update project:", err);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!project || deleteConfirmText !== project.name) return;

    setIsDeleting(true);
    try {
      await projectsApi.delete(projectId);
      router.push("/dashboard/projects");
    } catch (err) {
      console.error("Failed to delete project:", err);
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-lg font-medium">Failed to load project</h2>
        <p className="text-muted-foreground">{error || "Project not found"}</p>
        <Link href="/dashboard/projects">
          <Button>Back to Projects</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/projects">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Project Settings</h1>
          <p className="text-muted-foreground">{project.name}</p>
        </div>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Update your project name and basic settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Project Slug</Label>
            <Input value={project.slug} disabled />
            <p className="text-xs text-muted-foreground">
              The slug is auto-generated and cannot be changed
            </p>
          </div>
          <div className="space-y-2">
            <Label>Created</Label>
            <Input
              value={new Date(project.created_at).toLocaleDateString()}
              disabled
            />
          </div>
          <Button onClick={handleSave} disabled={isSaving || name === project.name}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle>API Key</CardTitle>
          <CardDescription>
            Use this key to authenticate your SDK with Bugwatch
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Your API Key</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border bg-muted px-3 py-2">
                <code className="text-sm font-mono break-all">
                  {project.api_key}
                </code>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copyApiKey}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Keep this key secret. Do not expose it in client-side code.
            </p>
          </div>

          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <div>
                <h4 className="font-medium text-yellow-800 dark:text-yellow-200">
                  Rotate API Key
                </h4>
                <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                  If you believe your API key has been compromised, rotate it immediately.
                  The old key will stop working as soon as you rotate.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleRotateKey}
                  disabled={isRotating}
                >
                  {isRotating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {isRotating ? "Rotating..." : "Rotate API Key"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SDK Configuration */}
      {project.platform && project.framework && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>SDK Configuration</CardTitle>
                <CardDescription>
                  Your project is configured for{" "}
                  {getPlatformConfig(project.platform as Platform)?.name} /{" "}
                  {getFrameworkConfig(
                    project.platform as Platform,
                    project.framework as Framework
                  )?.name}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {getPlatformConfig(project.platform as Platform)?.name}
                </span>
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {getFrameworkConfig(
                    project.platform as Platform,
                    project.framework as Framework
                  )?.name}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {(() => {
              const sdkContent = getSDKContent(
                project.platform as Platform,
                project.framework as Framework
              );
              if (!sdkContent) return null;

              return (
                <>
                  {/* Install */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                        1
                      </div>
                      <h3 className="font-semibold">Install the SDK</h3>
                    </div>
                    <InstallCommand commands={sdkContent.installCommands} />
                  </div>

                  {/* Configuration steps */}
                  {sdkContent.configSteps.map((step, index) => (
                    <div key={index} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                          {index + 2}
                        </div>
                        <div>
                          <h3 className="font-semibold">{step.title}</h3>
                          {step.description && (
                            <p className="text-sm text-muted-foreground">
                              {step.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <CodeBlock
                        code={interpolateApiKey(step.code, project.api_key)}
                        language={step.language}
                        filename={step.filename}
                      />
                    </div>
                  ))}

                  {/* Documentation link */}
                  <div className="flex items-center justify-center pt-2">
                    <a
                      href={sdkContent.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                    >
                      View full documentation
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* SDK Integration - Shown when no platform/framework is set */}
      {(!project.platform || !project.framework) && (
        <Card>
          <CardHeader>
            <CardTitle>SDK Integration</CardTitle>
            <CardDescription>
              Configure your SDK to get personalized installation instructions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-muted-foreground">
                No SDK configuration set for this project.
              </p>
              <Link href="/dashboard/projects/new">
                <Button variant="outline" className="mt-4">
                  Configure SDK
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions that will permanently affect your project
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showDeleteConfirm ? (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Project
            </Button>
          ) : (
            <div className="space-y-4 rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
              <div>
                <h4 className="font-medium text-red-800 dark:text-red-200">
                  Are you sure you want to delete this project?
                </h4>
                <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                  This action cannot be undone. All issues, events, and settings will be permanently deleted.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-red-700 dark:text-red-300">
                  Type <strong>{project.name}</strong> to confirm:
                </Label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={project.name}
                  className="border-red-300"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText("");
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteConfirmText !== project.name || isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    "Delete Project"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
