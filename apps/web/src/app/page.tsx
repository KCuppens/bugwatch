import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header, Hero, FeaturesGrid, SdkSection, PricingSection, FinalCta, Footer } from "@/components/landing";

export const metadata: Metadata = {
  title: "BugWatch — Open-source error tracking with flat pricing",
  description:
    "Unlimited error tracking with flat per-seat pricing. No surprise bills. Self-host free with MIT license.",
  openGraph: {
    title: "BugWatch — Open-source error tracking",
    description: "Unlimited errors, flat pricing. Zero surprise bills.",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "BugWatch — Open-source error tracking" }],
  },
};

export default function Home() {
  // The marketing landing page is only meaningful for the SaaS build.
  // Self-hosted deployments are private installations — send users straight
  // to the dashboard, which forwards unauthenticated visitors to /login.
  if (process.env.NEXT_PUBLIC_DEPLOYMENT_MODE !== "saas") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(var(--background))]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-[hsl(var(--accent))] focus:text-[hsl(var(--accent-foreground))] focus:rounded-lg"
      >
        Skip to content
      </a>
      <Header />
      <main id="main-content" className="flex-1">
        <Hero />
        <FeaturesGrid />
        <SdkSection />
        <PricingSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
