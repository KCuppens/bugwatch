import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password — BugWatch",
  description: "Request a password reset link for your BugWatch account.",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
