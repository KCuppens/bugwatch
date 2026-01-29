import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { BugwatchProvider } from "@/components/bugwatch-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bugwatch - AI-Powered Error Tracking",
  description: "Watch your bugs. Fix them faster. Free unlimited error logging with AI-powered fixes.",
  keywords: ["error tracking", "bug tracking", "AI", "debugging", "monitoring"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <BugwatchProvider>{children}</BugwatchProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
