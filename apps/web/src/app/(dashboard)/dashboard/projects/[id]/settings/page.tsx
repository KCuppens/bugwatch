"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { projectsApi, type Project } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    projectsApi.get(id).then((res) => {
      setProject(res.data);
      setLogoUrl(res.data.logo_url ?? "");
    }).catch(() => {});
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setSaving(true);
    try {
      await projectsApi.update(id, { logo_url: logoUrl || undefined });
      setProject((p) => p ? { ...p, logo_url: logoUrl || null } : p);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Project settings</h1>
        {project && (
          <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
        )}
      </div>

      <form onSubmit={handleSave} className="glass-card rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-sm font-medium mb-4">Branding</h2>
          <div className="space-y-2">
            <label htmlFor="logo-url" className="text-sm text-muted-foreground">
              Logo URL
            </label>
            <Input
              id="logo-url"
              type="url"
              placeholder="https://example.com/logo.png"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Publicly accessible image URL. Shown as the project avatar in the selector.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
