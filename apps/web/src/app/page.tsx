import {
  Header,
  Hero,
  SocialProof,
  ProblemSection,
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
      <Header />
      <main className="flex-1">
        <Hero />
        <SocialProof />
        <ProblemSection />
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
