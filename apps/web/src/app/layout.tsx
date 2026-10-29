import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { BugwatchProvider } from "@/components/bugwatch-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { ErrorFallback } from "@/components/error-fallback";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const spaceMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "700"],
  adjustFontFallback: true,
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bugwatch.dev";
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL) {
  console.warn("[layout] NEXT_PUBLIC_SITE_URL is not set — OG/canonical URLs default to https://bugwatch.dev");
}

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
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Bugwatch - AI-Powered Error Tracking" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bugwatch - AI-Powered Error Tracking",
    description: "Watch your bugs. Fix them faster. Free unlimited error logging with AI-powered fixes.",
    images: ["/og-image.png"],
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
      <body className={`${spaceMono.variable} font-sans antialiased bg-gradient-mesh`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <ErrorBoundary fallback={<ErrorFallback />}>
            <AuthProvider>
              <BugwatchProvider>
                {children}
                <Toaster />
              </BugwatchProvider>
            </AuthProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
