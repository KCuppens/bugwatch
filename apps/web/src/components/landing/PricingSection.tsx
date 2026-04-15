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
    features: ["Unlimited errors", "1 project", "7-day data retention", "1 uptime monitor", "Slack notifications"],
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
          <h2 className="font-sans text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 text-[hsl(var(--foreground))]">
            Simple, <span className="text-[hsl(var(--accent))]">predictable pricing</span>
          </h2>
          <p className="text-lg text-[hsl(var(--muted-foreground))]">
            Unlimited errors on every plan. Pay per seat, not per event.
          </p>
        </div>
      </FadeUp>

      {/* Monthly / Annual toggle */}
      <FadeUp delay={0.1}>
        <div className="flex items-center justify-center gap-3 mb-12">
          <span
            className={`text-sm font-sans font-medium ${!isAnnual ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}
          >
            Monthly
          </span>
          <button
            onClick={() => setIsAnnual(!isAnnual)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isAnnual ? "bg-[hsl(var(--accent))]" : "bg-[hsl(var(--surface-3))]"
            }`}
            role="switch"
            aria-checked={isAnnual}
            aria-label={isAnnual ? "Switch to monthly billing" : "Switch to annual billing"}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isAnnual ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span
            className={`text-sm font-sans font-medium ${isAnnual ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}
          >
            Annual
          </span>
          <span className="ml-1 px-2 py-0.5 rounded-full bg-[hsl(var(--accent))]/20 text-[hsl(var(--accent))] text-xs font-semibold font-mono">
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
                className={`relative flex flex-col p-6 transition-all h-full rounded-lg border ${
                  tier.highlighted
                    ? "bg-[hsl(var(--surface-2))] border-[hsl(var(--accent))] lg:scale-[1.03] shadow-[0_0_24px_rgba(232,255,71,0.12)]"
                    : "surface-card card-hover"
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-4 py-1.5 rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] text-xs font-semibold uppercase tracking-wide font-sans">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-sans font-semibold text-[hsl(var(--foreground))]">{tier.name}</h3>
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{tier.description}</p>
                  <div className="flex items-baseline gap-1 mt-4" aria-live="polite" aria-atomic="true">
                    <span className="font-mono text-4xl font-bold tracking-tight tabular-nums text-[hsl(var(--foreground))]">
                      {displayPrice}
                    </span>
                    {tier.period && <span className="text-[hsl(var(--muted-foreground))] text-sm">{tier.period}</span>}
                  </div>
                  {isAnnual && tier.monthlyPrice !== "$0" && tier.monthlyPrice !== "Custom" && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">billed annually</p>
                  )}
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {tier.features.map((feature, idx) => (
                    <li key={feature} className="flex items-start gap-3">
                      {idx === 0 && feature.includes("Everything in") ? (
                        <span className="text-sm text-[hsl(var(--muted-foreground))]">{feature}</span>
                      ) : (
                        <>
                          <Check className="h-4 w-4 text-[hsl(var(--accent))] shrink-0 mt-0.5" />
                          <span className="text-sm text-[hsl(var(--foreground))]/90">{feature}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={`block w-full text-center py-3 rounded-lg text-sm font-semibold font-sans transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] ${
                    tier.highlighted
                      ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-2))]"
                      : "bg-[hsl(var(--surface-3))] hover:bg-[hsl(var(--surface-3))]/80 border border-[hsl(var(--border-subtle))] text-[hsl(var(--foreground))]"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            </StaggerItem>
          );
        })}
      </StaggerContainer>

      <p className="text-center text-[hsl(var(--muted-foreground))] mt-12 text-sm">
        All plans include unlimited error tracking.{" "}
        <Link href="https://github.com/KCuppens/bugwatch" className="text-[hsl(var(--accent))] hover:underline">
          Self-host for free
        </Link>{" "}
        with MIT license.
      </p>
    </section>
  );
}
