import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-context";
import type { OnboardingContextValue, OnboardingProfile } from "@/lib/onboarding-context";

// Mock the API so saveProfile doesn't hit the network
vi.mock("@/lib/api", () => ({
  onboardingApi: {
    saveProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── helpers ────────────────────────────────────────────────────────────────

function TestComponent({ onRender }: { onRender: (ctx: OnboardingContextValue) => void }) {
  const ctx = useOnboarding();
  onRender(ctx);
  return null;
}

function renderWithProvider() {
  let ctx!: OnboardingContextValue;
  render(
    <OnboardingProvider>
      <TestComponent
        onRender={(c) => {
          ctx = c;
        }}
      />
    </OnboardingProvider>
  );
  return () => ctx;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("OnboardingProvider / useOnboarding", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("has empty initial state", () => {
    const getCtx = renderWithProvider();
    const ctx = getCtx();

    expect(ctx.profile).toBeNull();
    expect(ctx.isWelcomeComplete).toBe(false);
    expect(ctx.checklist.create_project).toBe(false);
    expect(ctx.checklist.install_sdk).toBe(false);
    expect(ctx.checklist.first_error).toBe(false);
    expect(ctx.checklist.create_alert).toBe(false);
    expect(ctx.checklist.invite_member).toBe(false);
  });

  it("setProfile saves to state and localStorage", () => {
    const getCtx = renderWithProvider();
    const profile: OnboardingProfile = {
      role: "developer",
      use_case: "errors",
      team_size: "solo",
    };

    act(() => {
      getCtx().setProfile(profile);
    });

    expect(getCtx().profile).toEqual(profile);
    const stored = JSON.parse(localStorage.getItem("bugwatch:onboarding_profile") ?? "null");
    expect(stored).toEqual(profile);
  });

  it("profile persists on remount", () => {
    const profile: OnboardingProfile = {
      role: "team_lead",
      use_case: "uptime",
      team_size: "small",
    };

    // First mount — set profile
    const { unmount } = render(
      <OnboardingProvider>
        <TestComponent onRender={(c) => c.setProfile(profile)} />
      </OnboardingProvider>
    );
    unmount();

    // Second mount — should read from localStorage
    let restored: OnboardingProfile | null = null;
    render(
      <OnboardingProvider>
        <TestComponent
          onRender={(c) => {
            restored = c.profile;
          }}
        />
      </OnboardingProvider>
    );

    expect(restored).toEqual(profile);
  });

  it("markMilestone updates checklist", () => {
    const getCtx = renderWithProvider();

    expect(getCtx().checklist.create_project).toBe(false);

    act(() => {
      getCtx().markMilestone("create_project");
    });

    expect(getCtx().checklist.create_project).toBe(true);
  });

  it("isAllComplete is false when 4 milestones marked, true when all 5 marked", () => {
    const getCtx = renderWithProvider();
    const four: Array<Parameters<OnboardingContextValue["markMilestone"]>[0]> = [
      "create_project",
      "install_sdk",
      "first_error",
      "create_alert",
    ];

    act(() => {
      four.forEach((id) => getCtx().markMilestone(id));
    });

    // 4 out of 5 — not all complete (verify via checklist values)
    expect(getCtx().checklist.invite_member).toBe(false);
    expect(Object.values(getCtx().checklist).every(Boolean)).toBe(false);

    act(() => {
      getCtx().markMilestone("invite_member");
    });

    expect(Object.values(getCtx().checklist).every(Boolean)).toBe(true);
  });

  it("setWelcomeComplete sets localStorage and isWelcomeComplete", () => {
    const getCtx = renderWithProvider();

    expect(getCtx().isWelcomeComplete).toBe(false);

    act(() => {
      getCtx().setWelcomeComplete();
    });

    expect(getCtx().isWelcomeComplete).toBe(true);
    expect(localStorage.getItem("bugwatch:welcome_completed")).toBe("true");
  });

  it("useOnboarding throws when used outside Provider", () => {
    function Naked() {
      useOnboarding();
      return null;
    }

    // Suppress React's console.error for expected throws
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Naked />)).toThrow("useOnboarding must be used inside <OnboardingProvider>");

    consoleError.mockRestore();
  });
});
