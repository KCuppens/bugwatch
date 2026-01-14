"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface ProjectNameStepProps {
  value: string;
  onChange: (value: string) => void;
  onNext: () => void;
  isValid: boolean;
}

export function ProjectNameStep({
  value,
  onChange,
  onNext,
  isValid,
}: ProjectNameStepProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Name Your Project</h2>
        <p className="text-muted-foreground">
          Give your project a name to help you identify it later
        </p>
      </div>

      <div className="mx-auto max-w-md space-y-4">
        <div className="space-y-2">
          <Label htmlFor="project-name">Project Name</Label>
          <Input
            id="project-name"
            type="text"
            placeholder="My Awesome App"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid) {
                onNext();
              }
            }}
            className="h-12 text-lg"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            You can change this later in project settings
          </p>
        </div>

        <Button
          onClick={onNext}
          disabled={!isValid}
          className="w-full h-12"
          size="lg"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
