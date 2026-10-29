"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  id: number;
  title: string;
  description?: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <nav aria-label="Progress" className="w-full">
      <ol aria-label={`Step ${currentStep} of ${steps.length}`} className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = step.id < currentStep;
          const isCurrent = step.id === currentStep;
          const isClickable = isCompleted && onStepClick;

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className={cn("flex items-center", index < steps.length - 1 && "flex-1")}
            >
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  aria-disabled={!isClickable}
                  aria-label={
                    isCompleted
                      ? `${step.title}, completed`
                      : isCurrent
                        ? `${step.title}, current step`
                        : `${step.title}, not yet reached`
                  }
                  onClick={() => isClickable && onStepClick(step.id)}
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all",
                    isCompleted &&
                      "border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] cursor-pointer hover:bg-[hsl(var(--accent))]/90",
                    isCurrent && "border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]",
                    !isCompleted && !isCurrent && "border-muted-foreground/30 bg-background text-muted-foreground"
                  )}
                >
                  {isCompleted ? <Check className="h-5 w-5" /> : <span className="text-sm font-medium">{step.id}</span>}
                </button>
                <div className="mt-2 text-center">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      (isCompleted || isCurrent) && "text-foreground",
                      !isCompleted && !isCurrent && "text-muted-foreground"
                    )}
                  >
                    {step.title}
                  </p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-4 h-0.5 flex-1 transition-colors",
                    isCompleted ? "bg-[hsl(var(--accent))]" : "bg-muted-foreground/30"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
