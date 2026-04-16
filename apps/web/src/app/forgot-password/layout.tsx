import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password — BugWatch",
  description: "Reset your BugWatch account password.",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
