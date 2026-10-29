import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Performance",
  description: "Track web vitals, transaction traces, and performance trends.",
};

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
