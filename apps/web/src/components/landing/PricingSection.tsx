"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { FadeUp, StaggerContainer, StaggerItem } from "./motion";
import { isSelfHosted } from "@/hooks/use-feature";

const tiers = [
  {
    name: "Free",
    monthlyPrice: "$0",
    annualPrice: "$0",
    period: "/forever",
    description: "For side projects",
    features: [
      "Unlimited errors",
      "1 project",
      "7-day data retention",
      "1 uptime monitor",
      "Slack notifications",
    ],
    cta: "Get Started",
    href: "/signup",
    highlighted: false,
  },
  {
    name: "Pro",
    monthlyPrice: "$12",
    annualPrice: "$8",
    period: "/seat/mo",
    description: "For growing teams",
    features: [
      "Everything in Free, plus:",
      "Unlimited projects",
      "90-day data retention",
      "10 uptime monitors",
      "Server monitoring",
      "Email, webhooks, PagerDuty",
    ],
    cta: "Start Free Trial",
    href: "/signup?plan=pro",
    highlighted: true,
  },
  {
    name: "Team",
    monthlyPrice: "$25",
    annualPrice: "$18",
    period: "/seat/mo",
    description: "For scaling organizations",
    features: [
      "Everything in Pro, plus:",
      "365-day data retention",
      "25 uptime monitors",
      "OpsGenie integration",
      "Jira, Linear, GitHub",
    ],
    cta: "Start Free Trial",
    href: "/signup?plan=team",
    highlighted: false,
  },
  {
    name: "Enterprise",
    monthlyPrice: "Custom",
    annualPrice: "Custom",
    period: "",
    description: "For large organizations",
    features: [
      "Everything in Team, plus:",
      "Unlimited data retention",
      "Unlimited monitors",
      "SSO & SAML",
      "Audit logs",
      "Dedicated support",
    ],
    cta: "Contact Sales",
    href: "mailto:sales@bugwatch.dev",
    highlighted: false,
  },
];

export function PricingSection() {
  const [isAnnual, setIsAnnual] = useState(false);

  if (isSelfHosted()) {
    return (
      <section id="pricing" className="container mx-auto px-4 py-28">
        <FadeUp>
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              All features <span className="text-accent">included</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              You&apos;re running Bugwatch self-hosted. All features are included — no limits, no billing.
            </p>
          </div>
        </FadeUp>
      </section>
    );
  }

  return (
    <section id="pricing" className="container mx-auto px-4 py-20 md:py-28">
      <FadeUp>
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display text-display-md md:text-display-lg mb-4">
            Simple,{" "}
            <span className="text-accent">predictable pricing</span>
          </h2>
          <p className="text-body-lg text-muted-foreground">
            Unlimited errors on every plan. Pay per seat, not per event.
          </p>
        </div>
      </FadeUp>

      {/* Monthly / Annual toggle */}
      <FadeUp delay={0.1}>
      <div className="flex items-center justify-center gap-3 mb-12">
        <span
          className={`text-sm font-medium ${!isAnnual ? "text-foreground" : "text-muted-foreground"}`}
        >
          Monthly
        </span>
        <button
          onClick={() => setIsAnnual(!isAnnual)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isAnnual ? "bg-accent" : "bg-surface-3"
          }`}
          aria-label="Toggle annual billing"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isAnnual ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span
          className={`text-sm font-medium ${isAnnual ? "text-foreground" : "text-muted-foreground"}`}
        >
          Annual
        </span>
        <span className="ml-1 px-2 py-0.5 rounded-full bg-accent/20 text-accent text-xs font-semibold">
          Save 30%
        </span>
      </div>
      </FadeUp>

      <StaggerContainer className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
        {tiers.map((tier) => {
          const displayPrice = isAnnual ? tier.annualPrice : tier.monthlyPrice;
          return (
            <StaggerItem key={tier.name}>
            <div
              className={`relative flex flex-col p-6 transition-all h-full ${
                tier.highlighted
                  ? "elev-3 border-accent/40 lg:scale-[1.03]"
                  : "elev-1 card-hover transform-gpu"
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1.5 rounded-full bg-accent text-accent-foreground text-xs font-semibold uppercase tracking-wide">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground">{tier.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="font-display text-4xl font-bold tracking-tight tabular-nums">{displayPrice}</span>
                  {tier.period && (
                    <span className="text-muted-foreground text-sm">{tier.period}</span>
                  )}
                </div>
                {isAnnual && tier.monthlyPrice !== "$0" && tier.monthlyPrice !== "Custom" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    billed annually
                  </p>
                )}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature, idx) => (
                  <li key={feature} className="flex items-start gap-3">
                    {idx === 0 && feature.includes("Everything in") ? (
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    ) : (
                      <>
                        <Check className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground/90">{feature}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <Link
                href={tier.href}
                className={`block w-full text-center py-3 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  tier.highlighted
                    ? "bg-accent text-accent-foreground hover:bg-accent/90 shadow-md shadow-accent/20 btn-inset"
                    : "bg-surface-3 hover:bg-surface-3/80 border border-border-subtle"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
            </StaggerItem>
          );
        })}
      </StaggerContainer>

      <p className="text-center text-muted-foreground mt-12">
        All plans include unlimited error tracking.{" "}
        <Link href="https://github.com/KCuppens/bugwatch" className="text-accent hover:underline">
          Self-host for free
        </Link>{" "}
        with MIT license.
      </p>
    </section>
  );
}
