"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { StepIndicator, type Step } from "./StepIndicator";
import { ProjectNameStep } from "./steps/ProjectNameStep";
import { PlatformStep } from "./steps/PlatformStep";
import { FrameworkStep } from "./steps/FrameworkStep";
import { InstallationStep } from "./steps/InstallationStep";
import { VerificationStep } from "./steps/VerificationStep";
import { projectsApi } from "@/lib/api";
import type { Platform, Framework, Project } from "@/lib/api";
import { Loader2 } from "lucide-react";

const WIZARD_STEPS: Step[] = [
  { id: 1, title: "Name" },
  { id: 2, title: "Platform" },
  { id: 3, title: "Framework" },
  { id: 4, title: "Install" },
  { id: 5, title: "Verify" },
];

interface OnboardingWizardProps {
  onComplete?: (project: Project) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [projectName, setProjectName] = useState("");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  const handleStepClick = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    }
  };

  const handleProjectNameNext = async () => {
    // Move to platform selection
    setCurrentStep(2);
  };

  const handlePlatformNext = () => {
    // Reset framework when platform changes
    setFramework(null);
    setCurrentStep(3);
  };

  const handleFrameworkNext = async () => {
    // Create the project at this point
    if (!projectName || !platform || !framework) return;

    setIsCreating(true);
    setError(null);

    try {
      const response = await projectsApi.create(projectName, platform, framework);
      setProject(response.data);
      setCurrentStep(4);
    } catch (err) {
      console.error("Failed to create project:", err);
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  };

  const handleInstallationNext = () => {
    setCurrentStep(5);
  };

  const handleComplete = () => {
    if (onComplete && project) {
      onComplete(project);
    } else {
      router.push("/dashboard/projects");
    }
  };

  const goBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Create New Project</h1>
          <p className="mt-2 text-muted-foreground">
            Set up error tracking for your application in minutes
          </p>
        </div>

        {/* Step Indicator */}
        <div className="mb-12">
          <StepIndicator
            steps={WIZARD_STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
            {error}
          </div>
        )}

        {/* Step Content */}
        <Card className="border-0 shadow-lg">
          <CardContent className="p-8">
            {isCreating ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="mt-4 text-muted-foreground">
                  Creating your project...
                </p>
              </div>
            ) : (
              <>
                {currentStep === 1 && (
                  <ProjectNameStep
                    value={projectName}
                    onChange={setProjectName}
                    onNext={handleProjectNameNext}
                    isValid={projectName.trim().length > 0}
                  />
                )}
                {currentStep === 2 && (
                  <PlatformStep
                    value={platform}
                    onChange={setPlatform}
                    onNext={handlePlatformNext}
                    onBack={goBack}
                    isValid={platform !== null}
                  />
                )}
                {currentStep === 3 && platform && (
                  <FrameworkStep
                    platform={platform}
                    value={framework}
                    onChange={setFramework}
                    onNext={handleFrameworkNext}
                    onBack={goBack}
                    isValid={framework !== null}
                  />
                )}
                {currentStep === 4 && project && platform && framework && (
                  <InstallationStep
                    platform={platform}
                    framework={framework}
                    apiKey={project.api_key}
                    onNext={handleInstallationNext}
                    onBack={goBack}
                  />
                )}
                {currentStep === 5 && project && platform && framework && (
                  <VerificationStep
                    projectId={project.id}
                    platform={platform}
                    framework={framework}
                    apiKey={project.api_key}
                    onComplete={handleComplete}
                    onBack={goBack}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
