"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExternalLink, Loader2, Unlink, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi, type IssueLinkInfo } from "@/lib/api";
import { isValidHttpUrl } from "@/lib/url-utils";
import { ProviderIcon } from "./ProviderIcon";

interface LinkedIssuesProps {
  projectId: string;
  issueId: string;
  links: IssueLinkInfo[];
  onLinksChange: (links: IssueLinkInfo[]) => void;
}

export function LinkedIssues({ projectId, issueId, links, onLinksChange }: LinkedIssuesProps) {
  const [unlinking, setUnlinking] = useState<string | null>(null);

  async function handleUnlink(linkId: string) {
    setUnlinking(linkId);
    try {
      await integrationsApi.deleteIssueLink(projectId, issueId, linkId);
      onLinksChange(links.filter((l) => l.id !== linkId));
      toast.success("Issue unlinked");
    } catch {
      toast.error("Failed to unlink issue");
    } finally {
      setUnlinking(null);
    }
  }

  if (links.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5" />
          Linked Issues
          <span className="text-xs font-normal text-muted-foreground">({links.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <ProviderIcon provider={link.provider} className="h-4 w-4 shrink-0" />
              {isValidHttpUrl(link.external_issue_url) ? (
                <a
                  href={link.external_issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 hover:underline"
                >
                  <span className="font-medium">{link.external_issue_key}</span>
                </a>
              ) : (
                <span className="flex-1 min-w-0 font-medium">{link.external_issue_key}</span>
              )}
              {link.external_status && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {link.external_status}
                </span>
              )}
              <div className="flex items-center gap-1 shrink-0">
                {isValidHttpUrl(link.external_issue_url) && (
                  <a
                    href={link.external_issue_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                  onClick={() => handleUnlink(link.id)}
                  disabled={unlinking === link.id}
                >
                  {unlinking === link.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Unlink className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
