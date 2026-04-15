import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnboardingChecklist } from "@/hooks/useOnboardingChecklist";
import { useOnboarding } from "@/lib/onboarding-context";
import { useProject } from "@/lib/project-context";

vi.mock("@/lib/onboarding-context", () => ({
  useOnboarding: vi.fn(),
}));

vi.mock("@/lib/project-context", () => ({
  useProject: vi.fn(),
}));

// ─── default mock values ─────────────────────────────────────────────────────

const allFalseChecklist = {
  create_project: false,
  install_sdk: false,
  first_error: false,
  create_alert: false,
  invite_member: false,
};

const allTrueChecklist = {
  create_project: true,
  install_sdk: true,
  first_error: true,
  create_alert: true,
  invite_member: true,
};

let mockMarkMilestone = vi.fn();

function mockOnboarding(overrides: Partial<ReturnType<typeof useOnboarding>> = {}) {
  vi.mocked(useOnboarding).mockReturnValue({
    profile: null,
    setProfile: vi.fn(),
    checklist: { ...allFalseChecklist },
    markMilestone: mockMarkMilestone,
    isWelcomeComplete: false,
    setWelcomeComplete: vi.fn(),
    ...overrides,
  });
}

function mockProject(overrides: Partial<ReturnType<typeof useProject>> = {}) {
  vi.mocked(useProject).mockReturnValue({
    projects: [],
    selectedProject: null,
    recentProjects: [],
    isLoading: false,
    error: null,
    selectProject: vi.fn(),
    refreshProjects: vi.fn(),
    ...overrides,
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("useOnboardingChecklist", () => {
  beforeEach(() => {
    mockMarkMilestone = vi.fn();
    vi.clearAllMocks();
    mockOnboarding();
    mockProject();
  });

  it("returns all milestones incomplete when checklist is all false", () => {
    const { result } = renderHook(() => useOnboardingChecklist());
    expect(result.current.completedCount).toBe(0);
    expect(result.current.milestones.every((m) => !m.completed)).toBe(true);
  });

  it("markComplete calls markMilestone with the given id", () => {
    const { result } = renderHook(() => useOnboardingChecklist());

    act(() => {
      result.current.markComplete("create_project");
    });

    expect(mockMarkMilestone).toHaveBeenCalledWith("create_project");
  });

  it("isAllComplete is true when all 5 milestones are true", () => {
    mockOnboarding({ checklist: { ...allTrueChecklist } });
    const { result } = renderHook(() => useOnboardingChecklist());
    expect(result.current.isAllComplete).toBe(true);
  });

  it("isAllComplete is false when only 4 milestones are true", () => {
    mockOnboarding({
      checklist: {
        ...allTrueChecklist,
        invite_member: false,
      },
    });
    const { result } = renderHook(() => useOnboardingChecklist());
    expect(result.current.isAllComplete).toBe(false);
  });

  it("developer role: milestones[0] is create_project, milestones[2] is first_error", () => {
    mockOnboarding({
      profile: { role: "developer", use_case: "errors", team_size: "solo" },
    });
    const { result } = renderHook(() => useOnboardingChecklist());
    expect(result.current.milestones[0]?.id).toBe("create_project");
    expect(result.current.milestones[2]?.id).toBe("first_error");
  });

  it("team_lead role: milestones[1] is create_alert (early in order)", () => {
    mockOnboarding({
      profile: { role: "team_lead", use_case: "uptime", team_size: "medium" },
    });
    const { result } = renderHook(() => useOnboardingChecklist());
    // team_lead order: create_project, create_alert, invite_member, install_sdk, first_error
    expect(result.current.milestones[0]?.id).toBe("create_project");
    expect(result.current.milestones[1]?.id).toBe("create_alert");
  });

  it("completedCount matches the number of true milestones", () => {
    mockOnboarding({
      checklist: {
        create_project: true,
        install_sdk: true,
        first_error: true,
        create_alert: false,
        invite_member: false,
      },
    });
    const { result } = renderHook(() => useOnboardingChecklist());
    expect(result.current.completedCount).toBe(3);
  });
});
