"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, ExternalLink, Unplug, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi, type IntegrationInfo, ApiError } from "@/lib/api";
import { isValidHttpUrl } from "@/lib/url-utils";
import { ProviderIcon, getProviderName, getProviderColor } from "./ProviderIcon";

const PROVIDERS = ["github", "jira", "linear"] as const;

export function IntegrationSettings() {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrations();
  }, []);

  // Check for callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      toast.success(`${getProviderName(connected)} connected successfully`);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      window.history.replaceState({}, "", url.toString());
      fetchIntegrations();
    }
    if (error) {
      // Map error codes to safe messages instead of displaying raw query params
      const errorMessages: Record<string, string> = {
        save_failed: "Failed to save integration. Please try again.",
      };
      toast.error(errorMessages[error] || "Failed to connect integration. Please try again.");
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  async function fetchIntegrations() {
    setLoading(true);
    try {
      const response = await integrationsApi.list();
      setIntegrations(response.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        // Tier gating - show empty state
        setIntegrations([]);
      } else {
        toast.error("Failed to load integrations");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(provider: string) {
    setConnecting(provider);
    try {
      const response = await integrationsApi.getOAuthUrl(provider);
      // Validate OAuth redirect URL before navigating
      if (!isValidHttpUrl(response.data.url)) {
        toast.error("Invalid OAuth redirect URL received");
        setConnecting(null);
        return;
      }
      window.location.href = response.data.url;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : `Failed to connect ${getProviderName(provider)}`;
      toast.error(message);
      setConnecting(null);
    }
  }

  async function handleDisconnect(integration: IntegrationInfo) {
    setDisconnecting(integration.id);
    try {
      await integrationsApi.disconnect(integration.id);
      setIntegrations((prev) => prev.filter((i) => i.id !== integration.id));
      toast.success(`${getProviderName(integration.provider)} disconnected`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to disconnect";
      toast.error(message);
    } finally {
      setDisconnecting(null);
    }
  }

  function getIntegration(provider: string): IntegrationInfo | undefined {
    return integrations.find((i) => i.provider === provider);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Connect your project management tools to create and track issues directly from Bugwatch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROVIDERS.map((provider) => {
            const integration = getIntegration(provider);
            const isConnected = !!integration;
            const isConnecting = connecting === provider;
            const isDisconnecting = disconnecting === integration?.id;

            return (
              <div
                key={provider}
                className="flex items-center justify-between rounded-xl border bg-surface-2 p-4"
              >
                <div className="flex items-center gap-4">
                  <div className={`${getProviderColor(provider)} shrink-0`}>
                    <ProviderIcon provider={provider} className="h-8 w-8" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{getProviderName(provider)}</h3>
                      {isConnected && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3 w-3" />
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {isConnected
                        ? `Connected as ${integration.external_username || "unknown"}`
                        : `Connect your ${getProviderName(provider)} account to create and link issues`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDisconnect(integration)}
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Unplug className="mr-2 h-4 w-4" />
                      )}
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleConnect(provider)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-2 h-4 w-4" />
                      )}
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
