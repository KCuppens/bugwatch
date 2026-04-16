import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Issues",
  description: "View and triage error issues captured by your projects.",
};

export default function IssuesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
