"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Code2, Users, Server, Rocket, Bug, Activity, GitBranch, LayoutGrid } from "lucide-react";
import type { OnboardingProfile } from "@/lib/onboarding-context";

interface WelcomeScreenProps {
  onComplete: (profile: OnboardingProfile) => void;
  onSkip: () => void;
}

type Role = OnboardingProfile["role"];
type UseCase = OnboardingProfile["use_case"];
type TeamSize = OnboardingProfile["team_size"];

const ROLES: { value: Role; label: string; icon: React.ReactNode }[] = [
  { value: "developer", label: "Developer", icon: <Code2 className="h-6 w-6" /> },
  { value: "team_lead", label: "Team Lead", icon: <Users className="h-6 w-6" /> },
  { value: "devops", label: "DevOps / SRE", icon: <Server className="h-6 w-6" /> },
  { value: "founder", label: "Founder", icon: <Rocket className="h-6 w-6" /> },
];

const USE_CASES: { value: UseCase; label: string; icon: React.ReactNode }[] = [
  { value: "errors", label: "Catch production errors", icon: <Bug className="h-6 w-6" /> },
  { value: "uptime", label: "Monitor uptime", icon: <Activity className="h-6 w-6" /> },
  { value: "releases", label: "Track releases", icon: <GitBranch className="h-6 w-6" /> },
  { value: "observability", label: "Team observability", icon: <LayoutGrid className="h-6 w-6" /> },
];

const TEAM_SIZES: { value: TeamSize; label: string; sublabel: string }[] = [
  { value: "solo", label: "Solo", sublabel: "Just me" },
  { value: "small", label: "Small", sublabel: "2–10" },
  { value: "medium", label: "Medium", sublabel: "11–50" },
  { value: "large", label: "Large", sublabel: "50+" },
];

const cardBase =
  "flex flex-col items-center gap-3 p-5 rounded-xl border cursor-pointer transition-all duration-150 select-none " +
  "bg-[hsl(var(--surface-2))] border-[hsl(var(--border-subtle))] " +
  "hover:border-[hsl(var(--accent))]/60";

const cardSelected = "border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5";

const stepVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

function BugWatchLogo() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M8 2v3" />
          <path d="M16 2v3" />
          <rect x="4" y="6" width="16" height="14" rx="5" />
          <path d="M4 13h16" />
        </svg>
      </span>
      <span className="font-sans font-bold text-xl tracking-tight text-[hsl(var(--foreground))]">BugWatch</span>
    </div>
  );
}

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuenow={step + 1}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label="Onboarding step"
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${
            i === step
              ? "w-6 bg-[hsl(var(--accent))]"
              : i < step
                ? "w-2 bg-[hsl(var(--accent))]/50"
                : "w-2 bg-[hsl(var(--border-subtle))]"
          }`}
        />
      ))}
    </div>
  );
}

export function WelcomeScreen({ onComplete, onSkip }: WelcomeScreenProps) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<Role | null>(null);
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [teamSize, setTeamSize] = useState<TeamSize | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending auto-advance timer on unmount
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleRoleSelect = (value: Role) => {
    setRole(value);
    if (prefersReducedMotion) {
      setStep(1);
      return;
    }
    timerRef.current = setTimeout(() => setStep(1), 180);
  };

  const handleUseCaseSelect = (value: UseCase) => {
    setUseCase(value);
    if (prefersReducedMotion) {
      setStep(2);
      return;
    }
    timerRef.current = setTimeout(() => setStep(2), 180);
  };

  const handleGetStarted = () => {
    if (!role || !useCase || !teamSize) return;
    onComplete({ role, use_case: useCase, team_size: teamSize });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(var(--background))]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4">
        <BugWatchLogo />
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          Skip for now
        </button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[640px] flex flex-col gap-8">
          {/* Progress dots */}
          <div className="flex justify-center">
            <ProgressDots step={step} total={3} />
          </div>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="step-0"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-6"
              >
                <div className="text-center">
                  <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">What&apos;s your role?</h1>
                  <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                    We&apos;ll tailor your setup experience.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {ROLES.map(({ value, label, icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleRoleSelect(value)}
                      aria-label={`${label}${role === value ? " — selected" : ""}`}
                      aria-pressed={role === value}
                      className={`${cardBase} ${role === value ? cardSelected : ""}`}
                    >
                      <span className={`text-[hsl(var(--accent))] ${role === value ? "opacity-100" : "opacity-70"}`}>
                        {icon}
                      </span>
                      <span className="font-sans text-sm font-medium text-[hsl(var(--foreground))]">{label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={onSkip}
                    className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="step-1"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-6"
              >
                <div className="text-center">
                  <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">
                    What&apos;s your primary goal?
                  </h1>
                  <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                    Choose the use case that matters most to you.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {USE_CASES.map(({ value, label, icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleUseCaseSelect(value)}
                      aria-label={`${label}${useCase === value ? " — selected" : ""}`}
                      aria-pressed={useCase === value}
                      className={`${cardBase} ${useCase === value ? cardSelected : ""}`}
                    >
                      <span className={`text-[hsl(var(--accent))] ${useCase === value ? "opacity-100" : "opacity-70"}`}>
                        {icon}
                      </span>
                      <span className="font-sans text-sm font-medium text-[hsl(var(--foreground))]">{label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={onSkip}
                    className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-6"
              >
                <div className="text-center">
                  <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">How big is your team?</h1>
                  <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                    We&apos;ll suggest the right plan and features.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3 justify-center">
                  {TEAM_SIZES.map(({ value, label, sublabel }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTeamSize(value)}
                      aria-label={`${label} — ${sublabel}${teamSize === value ? " — selected" : ""}`}
                      aria-pressed={teamSize === value}
                      className={`flex flex-col items-center gap-1 px-6 py-3 rounded-full border font-sans text-sm font-medium transition-all duration-150 cursor-pointer select-none ${
                        teamSize === value
                          ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] border-[hsl(var(--accent))]"
                          : "bg-[hsl(var(--surface-2))] border-[hsl(var(--border-subtle))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--accent))]/60"
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`text-xs ${teamSize === value ? "opacity-80" : "text-[hsl(var(--muted-foreground))]"}`}
                      >
                        {sublabel}
                      </span>
                    </button>
                  ))}
                </div>

                {teamSize && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      onClick={handleGetStarted}
                      className="w-full h-11 rounded-lg bg-[#2ed573] text-[#080B10] hover:bg-[#1a9e52] font-sans font-semibold text-sm border-0 transition-colors"
                    >
                      Get started →
                    </button>
                  </motion.div>
                )}

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={onSkip}
                    className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Social proof footer */}
      <footer className="flex justify-center pb-8">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Trusted by 2,000+ engineering teams</p>
      </footer>
    </div>
  );
}
