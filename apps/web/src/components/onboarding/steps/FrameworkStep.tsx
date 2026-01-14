"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { FrameworkCard } from "../FrameworkCard";
import { getPlatformConfig } from "@/lib/sdk-config";
import type { Platform, Framework } from "@/lib/api";

interface FrameworkStepProps {
  platform: Platform;
  value: Framework | null;
  onChange: (value: Framework) => void;
  onNext: () => void;
  onBack: () => void;
  isValid: boolean;
}

export function FrameworkStep({
  platform,
  value,
  onChange,
  onNext,
  onBack,
  isValid,
}: FrameworkStepProps) {
  const platformConfig = getPlatformConfig(platform);
  const frameworks = platformConfig?.frameworks || [];

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Select Your Framework</h2>
        <p className="text-muted-foreground">
          Choose the specific framework you&apos;re using
          {platformConfig && (
            <span className="ml-1 text-foreground">
              for {platformConfig.name}
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {frameworks.map((framework) => (
          <FrameworkCard
            key={framework.id}
            framework={framework}
            selected={value === framework.id}
            onClick={() => onChange(framework.id as Framework)}
          />
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!isValid}>
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
