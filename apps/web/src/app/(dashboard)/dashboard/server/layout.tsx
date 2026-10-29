import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Server",
  description: "Monitor server health, metrics, and performance.",
};

export default function ServerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
