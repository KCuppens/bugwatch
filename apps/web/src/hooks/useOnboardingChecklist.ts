import { useEffect, useMemo } from "react";
import { useOnboarding, type MilestoneId } from "@/lib/onboarding-context";
import { useProject } from "@/lib/project-context";

export interface ChecklistMilestone {
  id: MilestoneId;
  label: string;
  description: string;
  href: string;
  completed: boolean;
}

export interface UseOnboardingChecklistReturn {
  milestones: ChecklistMilestone[];
  completedCount: number;
  totalCount: number;
  isAllComplete: boolean;
  markComplete: (id: MilestoneId) => void;
}

const MILESTONE_CONFIG: Record<MilestoneId, { label: string; description: string; href: string }> = {
  create_project: {
    label: "Create your first project",
    description: "Set up error tracking for an app",
    href: "/dashboard/projects/new",
  },
  install_sdk: {
    label: "Install the SDK",
    description: "Add BugWatch to your codebase",
    href: "/dashboard/projects/new",
  },
  first_error: {
    label: "Capture your first error",
    description: "Send a test error to verify setup",
    href: "/dashboard/projects/new",
  },
  create_alert: {
    label: "Set up an alert",
    description: "Get notified when errors occur",
    href: "/dashboard/alerts",
  },
  invite_member: {
    label: "Invite a teammate",
    description: "Collaborate on error resolution",
    href: "/dashboard/settings?tab=billing",
  },
};

/** Ordered milestone IDs based on the user's role. */
function getOrderForRole(role: string | null): MilestoneId[] {
  switch (role) {
    case "team_lead":
      return ["create_project", "create_alert", "invite_member", "install_sdk", "first_error"];
    case "devops":
      return ["create_project", "install_sdk", "create_alert", "first_error", "invite_member"];
    case "founder":
      return ["create_project", "invite_member", "create_alert", "install_sdk", "first_error"];
    case "developer":
    default:
      return ["create_project", "install_sdk", "first_error", "create_alert", "invite_member"];
  }
}

export function useOnboardingChecklist(): UseOnboardingChecklistReturn {
  const { checklist, markMilestone, profile } = useOnboarding();
  const { projects, selectedProject } = useProject();

  // Auto-mark create_project when the user has at least one project.
  useEffect(() => {
    if (projects.length > 0 && !checklist.create_project) {
      markMilestone("create_project");
    }
  }, [projects.length, checklist.create_project, markMilestone]);

  // Auto-mark install_sdk when the selected project has completed onboarding.
  useEffect(() => {
    if (selectedProject?.onboarding_completed_at != null && !checklist.install_sdk) {
      markMilestone("install_sdk");
    }
  }, [selectedProject?.onboarding_completed_at, checklist.install_sdk, markMilestone]);

  const milestones = useMemo<ChecklistMilestone[]>(() => {
    const order = getOrderForRole(profile?.role ?? null);
    return order.map((id) => ({
      id,
      ...MILESTONE_CONFIG[id],
      completed: checklist[id],
    }));
  }, [checklist, profile?.role]);

  const completedCount = useMemo(() => milestones.filter((m) => m.completed).length, [milestones]);

  return {
    milestones,
    completedCount,
    totalCount: milestones.length,
    isAllComplete: completedCount === milestones.length,
    markComplete: markMilestone,
  };
}
