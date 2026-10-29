import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — BugWatch",
  description: "Sign in to your BugWatch account to monitor errors and performance.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
