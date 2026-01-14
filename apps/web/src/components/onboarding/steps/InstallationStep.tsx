"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { CodeBlock, InstallCommand } from "../CodeBlock";
import { getSDKContent, interpolateApiKey } from "@/lib/sdk-config";
import type { Platform, Framework } from "@/lib/api";

interface InstallationStepProps {
  platform: Platform;
  framework: Framework;
  apiKey: string;
  onNext: () => void;
  onBack: () => void;
}

export function InstallationStep({
  platform,
  framework,
  apiKey,
  onNext,
  onBack,
}: InstallationStepProps) {
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
        <h2 className="text-2xl font-bold">Install {sdkContent.packageName}</h2>
        <p className="text-muted-foreground">
          Follow these steps to integrate Bugwatch into your application
        </p>
      </div>

      <div className="space-y-8 max-w-2xl mx-auto">
        {/* Step 1: Install */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
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
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
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
              code={interpolateApiKey(step.code, apiKey)}
              language={step.language}
              filename={step.filename}
            />
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
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext}>
          Continue to Verification
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
