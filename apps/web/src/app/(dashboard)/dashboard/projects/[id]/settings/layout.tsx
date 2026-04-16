import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Project Settings",
  description: "Configure SDK keys, integrations, and preferences for this project.",
};

export default function ProjectSettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
