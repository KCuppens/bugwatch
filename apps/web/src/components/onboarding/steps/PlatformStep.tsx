"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PlatformCard } from "../PlatformCard";
import { PLATFORMS } from "@/lib/sdk-config";
import type { Platform } from "@/lib/api";

interface PlatformStepProps {
  value: Platform | null;
  onChange: (value: Platform) => void;
  onNext: () => void;
  onBack: () => void;
  isValid: boolean;
}

export function PlatformStep({
  value,
  onChange,
  onNext,
  onBack,
  isValid,
}: PlatformStepProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Select Your Platform</h2>
        <p className="text-muted-foreground">
          Choose the language your application is built with
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            selected={value === platform.id}
            onClick={() => onChange(platform.id)}
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
