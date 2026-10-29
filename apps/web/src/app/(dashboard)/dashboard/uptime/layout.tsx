import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uptime",
  description: "Monitor uptime and availability for your services.",
};

export default function UptimeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
