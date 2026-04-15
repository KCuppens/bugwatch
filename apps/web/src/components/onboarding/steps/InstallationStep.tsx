"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Server } from "lucide-react";
import { CodeBlock, InstallCommand } from "../CodeBlock";
import { getSDKContent, interpolateApiKey, SERVER_MONITORING_CONTENT } from "@/lib/sdk-config";
import type { Platform, Framework } from "@/lib/api";

interface InstallationStepProps {
  platform: Platform;
  framework: Framework;
  apiKey: string;
  onNext: () => void;
  onBack: () => void;
  backDisabled?: boolean;
}

export function InstallationStep({ platform, framework, apiKey, onNext, onBack, backDisabled }: InstallationStepProps) {
  const [showServerMonitoring, setShowServerMonitoring] = useState(false);
  const sdkContent = getSDKContent(platform, framework);

  if (!sdkContent) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          SDK content not found for {platform}/{framework}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="font-sans text-2xl font-bold">Install {sdkContent.packageName}</h2>
        <p className="text-muted-foreground">Follow these steps to integrate Bugwatch into your application</p>
      </div>

      <div className="space-y-8 max-w-2xl mx-auto">
        {/* Step 1: Install */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-sm font-medium text-[#080B10]">
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
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-sm font-medium text-[#080B10]">
                {index + 2}
              </div>
              <div>
                <h3 className="font-semibold">{step.title}</h3>
                {step.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
              </div>
            </div>
            <CodeBlock code={interpolateApiKey(step.code, apiKey)} language={step.language} filename={step.filename} />
          </div>
        ))}

        {/* Documentation link */}
        <div className="flex items-center justify-center gap-2 pt-4">
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

        {/* Server Monitoring (Optional) */}
        <div className="border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowServerMonitoring(!showServerMonitoring)}
            className="flex w-full items-center gap-3 p-4 text-left hover:bg-[hsl(var(--surface-2))] transition-colors"
          >
            <Server className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Server Monitoring (Optional)</h3>
              <p className="text-xs text-muted-foreground">{SERVER_MONITORING_CONTENT.description}</p>
            </div>
            {showServerMonitoring ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showServerMonitoring && (
            <div className="border-t p-4 space-y-4">
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Install the agent</h4>
                <CodeBlock code={interpolateApiKey(SERVER_MONITORING_CONTENT.installCommand, apiKey)} language="bash" />
              </div>
              <p className="text-xs text-muted-foreground">{SERVER_MONITORING_CONTENT.requirements}</p>
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Management commands</h4>
                <div className="space-y-1">
                  {SERVER_MONITORING_CONTENT.managementCommands.map((cmd) => (
                    <div key={cmd.label} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-28 shrink-0">{cmd.label}:</span>
                      <code className="bg-[hsl(var(--surface-2))] px-1.5 py-0.5 rounded font-mono">{cmd.command}</code>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <div className="relative group">
          <Button variant="ghost" onClick={onBack} disabled={backDisabled}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {backDisabled && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground border shadow-sm">
              Project already created
            </span>
          )}
        </div>
        <Button onClick={onNext}>
          Continue to Verification
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
