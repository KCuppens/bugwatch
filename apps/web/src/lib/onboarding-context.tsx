"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { onboardingApi } from "@/lib/api";

export interface OnboardingProfile {
  role: "developer" | "team_lead" | "devops" | "founder";
  use_case: "errors" | "uptime" | "releases" | "observability";
  team_size: "solo" | "small" | "medium" | "large";
}

export type MilestoneId = "create_project" | "install_sdk" | "first_error" | "create_alert" | "invite_member";

export interface OnboardingContextValue {
  profile: OnboardingProfile | null;
  setProfile: (p: OnboardingProfile) => void;
  checklist: Record<MilestoneId, boolean>;
  markMilestone: (id: MilestoneId) => void;
  isWelcomeComplete: boolean;
  setWelcomeComplete: () => void;
}

const PROFILE_KEY = "bugwatch:onboarding_profile";
const CHECKLIST_KEY = "bugwatch:onboarding_checklist";
const WELCOME_KEY = "bugwatch:welcome_completed";

const DEFAULT_CHECKLIST: Record<MilestoneId, boolean> = {
  create_project: false,
  install_sdk: false,
  first_error: false,
  create_alert: false,
  invite_member: false,
};

function readLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error("[onboarding] Failed to read localStorage key:", key, err);
    return fallback;
  }
}

function writeLocalStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage quota or private-mode — silently ignore
  }
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<OnboardingProfile | null>(() =>
    readLocalStorage<OnboardingProfile | null>(PROFILE_KEY, null)
  );

  const [checklist, setChecklist] = useState<Record<MilestoneId, boolean>>(() =>
    readLocalStorage<Record<MilestoneId, boolean>>(CHECKLIST_KEY, DEFAULT_CHECKLIST)
  );

  const [isWelcomeComplete, setIsWelcomeComplete] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(WELCOME_KEY) === "true";
  });

  const setProfile = useCallback((p: OnboardingProfile) => {
    setProfileState(p);
    writeLocalStorage(PROFILE_KEY, p);
    // Fire-and-forget — profile is already persisted to localStorage
    void onboardingApi
      .saveProfile(p)
      .catch((err) => console.error("[onboarding] Failed to save profile to server:", err));
  }, []);

  const markMilestone = useCallback((id: MilestoneId) => {
    setChecklist((prev) => {
      const next = { ...prev, [id]: true };
      writeLocalStorage(CHECKLIST_KEY, next);
      return next;
    });
  }, []);

  const setWelcomeComplete = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(WELCOME_KEY, "true");
    }
    setIsWelcomeComplete(true);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{ profile, setProfile, checklist, markMilestone, isWelcomeComplete, setWelcomeComplete }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (ctx === null) {
    throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  }
  return ctx;
}
