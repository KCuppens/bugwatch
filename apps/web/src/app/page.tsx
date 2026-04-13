import {
  Header,
  Hero,
  SocialProof,
  ProblemSection,
  HowItWorks,
  FeaturesGrid,
  SdkSection,
  OpenSourceSection,
  PricingSection,
  FaqSection,
  FinalCta,
  Footer,
} from "@/components/landing";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-mesh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-accent-foreground focus:rounded-lg"
      >
        Skip to content
      </a>
      <Header />
      <main id="main-content" className="flex-1">
        <Hero />
        <SocialProof />
        <ProblemSection />
        <HowItWorks />
        <FeaturesGrid />
        <SdkSection />
        <OpenSourceSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
