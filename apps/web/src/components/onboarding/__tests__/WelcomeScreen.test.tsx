import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import type { OnboardingProfile } from "@/lib/onboarding-context";

// Mock framer-motion to avoid animation complexity in jsdom
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function setup(overrides: Partial<{ onComplete: (p: OnboardingProfile) => void; onSkip: () => void }> = {}) {
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  render(<WelcomeScreen onComplete={overrides.onComplete ?? onComplete} onSkip={overrides.onSkip ?? onSkip} />);
  return { onComplete, onSkip };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("WelcomeScreen", () => {
  it("renders role picker cards on initial render", () => {
    setup();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("Team Lead")).toBeInTheDocument();
    expect(screen.getByText("DevOps / SRE")).toBeInTheDocument();
    expect(screen.getByText("Founder")).toBeInTheDocument();
  });

  it("clicking a role card advances to the use-case step", async () => {
    setup();

    await act(async () => {
      fireEvent.click(screen.getByText("Developer"));
      // WelcomeScreen uses setTimeout(180ms) to advance — flush it
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.getByText("Catch production errors")).toBeInTheDocument();
  });

  it("Skip button calls onSkip", () => {
    const { onSkip } = setup();
    // There are multiple "Skip for now" buttons; clicking any one is sufficient
    const skipButton = screen.getAllByText("Skip for now")[0];
    if (skipButton) fireEvent.click(skipButton);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("completing all 3 steps calls onComplete with correct profile", async () => {
    const { onComplete } = setup();

    // Step 0: pick role
    await act(async () => {
      fireEvent.click(screen.getByText("Developer"));
      await new Promise((r) => setTimeout(r, 200));
    });

    // Step 1: pick use case
    await act(async () => {
      fireEvent.click(screen.getByText("Catch production errors"));
      await new Promise((r) => setTimeout(r, 200));
    });

    // Step 2: pick team size
    fireEvent.click(screen.getByText("Solo"));

    // Click "Get started →"
    fireEvent.click(screen.getByText("Get started →"));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith<[OnboardingProfile]>({
      role: "developer",
      use_case: "errors",
      team_size: "solo",
    });
  });

  it("onComplete is not called before all steps are complete", async () => {
    const { onComplete } = setup();

    // Only pick role, do not advance further
    await act(async () => {
      fireEvent.click(screen.getByText("Developer"));
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("renders 3 progress dots", () => {
    setup();
    // ProgressDots renders a div with role="progressbar" and aria-valuemax=3
    const progressbar = screen.getByRole("progressbar");
    // It contains 3 dot divs (children of the progressbar container)
    expect(progressbar.children).toHaveLength(3);
  });
});
