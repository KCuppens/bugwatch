"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-context";
import type { OnboardingProfile } from "@/lib/onboarding-context";

function WelcomePage() {
  const router = useRouter();
  const { setProfile, setWelcomeComplete } = useOnboarding();

  // Guard: already completed welcome → go to dashboard
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("bugwatch:welcome_completed") === "true") {
      router.push("/dashboard");
    }
  }, [router]);

  const handleComplete = (profile: OnboardingProfile) => {
    setProfile(profile);
    setWelcomeComplete();
    router.push("/dashboard/projects/new");
  };

  const handleSkip = () => {
    setWelcomeComplete();
    router.push("/dashboard/projects/new");
  };

  return <WelcomeScreen onComplete={handleComplete} onSkip={handleSkip} />;
}

export default function WelcomePageWrapper() {
  return (
    <OnboardingProvider>
      <WelcomePage />
    </OnboardingProvider>
  );
}
