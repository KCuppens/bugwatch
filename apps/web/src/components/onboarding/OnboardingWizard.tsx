"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    // Prevent going back before step 4 once project is created
    if (project && step < 4) return;
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
      setError("Failed to create project. Please try again.");
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
    // Prevent going back before step 4 once project is created
    const nextStep = currentStep - 1;
    if (project && nextStep < 4) return;
    if (currentStep > 1) {
      setCurrentStep(nextStep);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header with mono step counter */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">Create New Project</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Set up error tracking for your application in minutes
          </p>
        </div>
        <span className="font-mono text-sm text-[hsl(var(--muted-foreground))] shrink-0 pt-1">
          {String(currentStep).padStart(2, "0")} / {String(WIZARD_STEPS.length).padStart(2, "0")}
        </span>
      </div>

      {/* Step Indicator */}
      <div className="mb-8">
        <StepIndicator steps={WIZARD_STEPS} currentStep={currentStep} onStepClick={handleStepClick} />
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
      )}

      {/* Step Content */}
      <div className="surface-card p-8">
        {isCreating ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--accent))]" />
            <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Creating your project...</p>
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
                backDisabled={!!project}
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
                backDisabled={!!project}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
