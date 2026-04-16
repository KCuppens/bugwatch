import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Alerts",
  description: "Manage alert rules and notification channels for your projects.",
};

export default function AlertsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
