import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Replay",
  description: "Review session replays to understand user-reported issues.",
};

export default function ReplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
