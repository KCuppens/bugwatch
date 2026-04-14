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
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

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
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <ErrorBoundary
            fallback={
              <div className="min-h-screen flex items-center justify-center p-8 text-center">
                <div>
                  <p className="text-lg font-semibold mb-2">Something went wrong</p>
                  <p className="text-sm text-muted-foreground mb-4">Please refresh the page to try again.</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
                  >
                    Refresh
                  </button>
                </div>
              </div>
            }
          >
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
