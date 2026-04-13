"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi, type IntegrationInfo, type IssueLinkInfo, ApiError } from "@/lib/api";
import { ProviderIcon, getProviderName } from "./ProviderIcon";

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  issueId: string;
  issueTitle: string;
  onCreated: (link: IssueLinkInfo) => void;
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  projectId,
  issueId,
  issueTitle,
  onCreated,
}: CreateIssueDialogProps) {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [title, setTitle] = useState(issueTitle);
  const [description, setDescription] = useState("");

  // Provider-specific fields
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [domain, setDomain] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [teamId, setTeamId] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(issueTitle);
      fetchIntegrations();
    }
  }, [open, issueTitle]);

  async function fetchIntegrations() {
    setLoading(true);
    try {
      const response = await integrationsApi.list();
      setIntegrations(response.data);
      if (response.data.length > 0) {
        setProvider(response.data[0]!.provider);
      }
    } catch {
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!provider || !title.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    const config: Record<string, string> = { title, description };

    if (provider === "github") {
      if (!owner || !repo) {
        toast.error("Owner and repository are required for GitHub");
        return;
      }
      config.owner = owner;
      config.repo = repo;
    } else if (provider === "jira") {
      if (!domain || !projectKey) {
        toast.error("Domain and project key are required for Jira");
        return;
      }
      config.domain = domain;
      config.project_key = projectKey;
    } else if (provider === "linear") {
      if (!teamId) {
        toast.error("Team ID is required for Linear");
        return;
      }
      config.team_id = teamId;
    }

    setCreating(true);
    try {
      const response = await integrationsApi.createIssueLink(projectId, issueId, {
        provider,
        config,
      });
      toast.success(`${getProviderName(provider)} issue created: ${response.data.external_issue_key}`);
      onCreated(response.data);
      onOpenChange(false);
      // Reset fields
      setDescription("");
      setOwner("");
      setRepo("");
      setDomain("");
      setProjectKey("");
      setTeamId("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create issue";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create External Issue</DialogTitle>
          <DialogDescription>
            Create a linked issue in your connected project management tool.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : integrations.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No integrations connected. Go to Settings &gt; Integrations to connect GitHub, Jira, or Linear.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {integrations.map((i) => (
                    <SelectItem key={i.provider} value={i.provider}>
                      <div className="flex items-center gap-2">
                        <ProviderIcon provider={i.provider} className="h-4 w-4" />
                        {getProviderName(i.provider)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="issue-title">Title</Label>
              <Input
                id="issue-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="issue-desc">Description (optional)</Label>
              <textarea
                id="issue-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional context..."
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Provider-specific fields */}
            {provider === "github" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="gh-owner">Owner</Label>
                  <Input
                    id="gh-owner"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="e.g. my-org"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gh-repo">Repository</Label>
                  <Input
                    id="gh-repo"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="e.g. my-app"
                  />
                </div>
              </div>
            )}

            {provider === "jira" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="jira-domain">Domain</Label>
                  <Input
                    id="jira-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="e.g. mycompany"
                  />
                  <p className="text-[10px] text-muted-foreground">.atlassian.net</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jira-project">Project Key</Label>
                  <Input
                    id="jira-project"
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value)}
                    placeholder="e.g. PROJ"
                  />
                </div>
              </div>
            )}

            {provider === "linear" && (
              <div className="space-y-2">
                <Label htmlFor="linear-team">Team ID</Label>
                <Input
                  id="linear-team"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  placeholder="Linear Team ID"
                />
                <p className="text-[10px] text-muted-foreground">
                  Find this in Linear Settings &gt; Teams
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || integrations.length === 0}
          >
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
