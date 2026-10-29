import type { Metadata } from "next";

// Base metadata for all dashboard routes. Individual sub-route layouts can
// override title and description while inheriting the template.
// All dashboard page components are "use client" and cannot export metadata
// directly — this server-side layout provides the closest approximation.
export const metadata: Metadata = {
  title: {
    default: "Dashboard — BugWatch",
    template: "%s — BugWatch",
  },
  description: "Monitor errors, uptime, and performance across your projects.",
  robots: { index: false, follow: false },
};

export default function DashboardRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
