import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account — BugWatch",
  description: "Create your BugWatch account and start monitoring errors in minutes.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
