import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFirstError } from "@/hooks/useFirstError";
import { useOnboarding } from "@/lib/onboarding-context";
import { useProject } from "@/lib/project-context";
import { issuesApi } from "@/lib/api";

vi.mock("@/lib/onboarding-context");
vi.mock("@/lib/project-context");
vi.mock("@/lib/api", () => ({
  issuesApi: {
    list: vi.fn(),
  },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

const CELEBRATED_KEY = "bugwatch:first_error_celebrated";

const mockMarkMilestone = vi.fn();

function mockOnboarding(overrides: Partial<ReturnType<typeof useOnboarding>> = {}) {
  vi.mocked(useOnboarding).mockReturnValue({
    profile: null,
    setProfile: vi.fn(),
    checklist: {
      create_project: false,
      install_sdk: false,
      first_error: false,
      create_alert: false,
      invite_member: false,
    },
    markMilestone: mockMarkMilestone,
    isWelcomeComplete: false,
    setWelcomeComplete: vi.fn(),
    ...overrides,
  });
}

// Minimal Project shape needed by the hook
const mockProject = {
  id: "proj-1",
  name: "Test Project",
  onboarding_completed_at: null,
} as ReturnType<typeof useProject>["selectedProject"];

function mockProjectContext(selectedProject: ReturnType<typeof useProject>["selectedProject"] = mockProject) {
  vi.mocked(useProject).mockReturnValue({
    projects: selectedProject ? [selectedProject] : [],
    selectedProject,
    recentProjects: [],
    isLoading: false,
    error: null,
    selectProject: vi.fn(),
    refreshProjects: vi.fn(),
  });
}

// A minimal issue object that satisfies issuesApi.list's return type at runtime
const fakeIssue = { id: "issue-1", title: "TypeError", status: "unresolved", project_id: "proj-1" };

// ─── tests ───────────────────────────────────────────────────────────────────

describe("useFirstError", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockOnboarding();
    mockProjectContext();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns shouldCelebrate: false when already celebrated in localStorage", () => {
    localStorage.setItem(CELEBRATED_KEY, "true");
    mockOnboarding();
    mockProjectContext();

    const { result } = renderHook(() => useFirstError());
    expect(result.current.shouldCelebrate).toBe(false);
  });

  it("returns shouldCelebrate: false when first_error milestone already marked", () => {
    mockOnboarding({
      checklist: {
        create_project: false,
        install_sdk: false,
        first_error: true,
        create_alert: false,
        invite_member: false,
      },
    });

    const { result } = renderHook(() => useFirstError());
    expect(result.current.shouldCelebrate).toBe(false);
  });

  it("shouldCelebrate becomes true when an issue arrives via polling", async () => {
    // Use real timers so the immediate poll() call resolves naturally
    vi.mocked(issuesApi.list).mockResolvedValue({
      data: [fakeIssue],
      total: 1,
      page: 1,
      per_page: 20,
    } as never);

    const { result } = renderHook(() => useFirstError());

    await waitFor(
      () => {
        expect(result.current.shouldCelebrate).toBe(true);
      },
      { timeout: 3000 }
    );
  });

  it("dismiss() sets localStorage key and clears shouldCelebrate", async () => {
    vi.mocked(issuesApi.list).mockResolvedValue({
      data: [fakeIssue],
      total: 1,
      page: 1,
      per_page: 20,
    } as never);

    const { result } = renderHook(() => useFirstError());

    await waitFor(
      () => {
        expect(result.current.shouldCelebrate).toBe(true);
      },
      { timeout: 3000 }
    );

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.shouldCelebrate).toBe(false);
    expect(localStorage.getItem(CELEBRATED_KEY)).toBe("true");
  });

  it("does not poll when no project is selected", async () => {
    vi.useFakeTimers();
    mockProjectContext(null);

    renderHook(() => useFirstError());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(vi.mocked(issuesApi.list)).not.toHaveBeenCalled();
  });
});
