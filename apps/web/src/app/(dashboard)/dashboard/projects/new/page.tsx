"use client";

import { OnboardingWizard } from "@/components/onboarding";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";

export default function NewProjectPage() {
  return (
    <OnboardingShell>
      <OnboardingWizard />
    </OnboardingShell>
  );
}
