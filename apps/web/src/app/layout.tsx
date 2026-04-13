import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Urbanist } from "next/font/google";

const urbanist = Urbanist({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { BugwatchProvider } from "@/components/bugwatch-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bugwatch.dev";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Bugwatch - AI-Powered Error Tracking",
  description: "Watch your bugs. Fix them faster. Free unlimited error logging with AI-powered fixes.",
  keywords: ["error tracking", "bug tracking", "AI", "debugging", "monitoring"],
  openGraph: {
    title: "Bugwatch - AI-Powered Error Tracking",
    description: "Watch your bugs. Fix them faster. Free unlimited error logging with AI-powered fixes.",
    url: siteUrl,
    siteName: "Bugwatch",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bugwatch - AI-Powered Error Tracking",
    description: "Watch your bugs. Fix them faster. Free unlimited error logging with AI-powered fixes.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} ${urbanist.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <BugwatchProvider>{children}</BugwatchProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
