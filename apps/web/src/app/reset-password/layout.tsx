import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose New Password — BugWatch",
  description: "Set a new password for your BugWatch account.",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
