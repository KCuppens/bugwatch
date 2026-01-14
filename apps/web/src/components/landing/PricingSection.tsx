import Link from "next/link";
import { Check } from "lucide-react";

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/forever",
    description: "For side projects",
    features: [
      "Unlimited errors",
      "1 project",
      "7-day data retention",
      "Email alerts",
    ],
    cta: "Get Started",
    href: "/signup",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$12",
    period: "/seat/mo",
    description: "For growing teams",
    features: [
      "Everything in Free, plus:",
      "Unlimited projects",
      "90-day data retention",
      "5 AI fixes per seat/mo",
      "Slack & PagerDuty",
    ],
    cta: "Start Free Trial",
    href: "/signup?plan=pro",
    highlighted: true,
  },
  {
    name: "Team",
    price: "$25",
    period: "/seat/mo",
    description: "For scaling organizations",
    badge: "5 seat minimum",
    features: [
      "Everything in Pro, plus:",
      "365-day data retention",
      "15 AI fixes per seat/mo",
      "Session replay",
      "Jira, Linear, GitHub",
    ],
    cta: "Start Free Trial",
    href: "/signup?plan=team",
    highlighted: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large organizations",
    features: [
      "Everything in Team, plus:",
      "Unlimited data retention",
      "Unlimited AI fixes",
      "SSO & SAML",
      "Audit logs",
      "Dedicated support",
    ],
    cta: "Contact Sales",
    href: "/contact",
    highlighted: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="container mx-auto px-4 py-24">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Simple,{" "}
          <span className="text-accent">predictable pricing</span>
        </h2>
        <p className="text-lg text-muted-foreground">
          Unlimited errors on every plan. Pay per seat, not per event.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`relative flex flex-col p-6 rounded-2xl transition-all ${
              tier.highlighted
                ? "glass-card border-accent/50 lg:scale-[1.02] shadow-lg shadow-accent/10"
                : "glass-card hover:border-white/20"
            }`}
          >
            {tier.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-4 py-1.5 rounded-full bg-accent text-accent-foreground text-xs font-semibold uppercase tracking-wide">
                  Most Popular
                </span>
              </div>
            )}

            {"badge" in tier && tier.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-3 py-1 rounded-full bg-white/10 text-white/70 text-xs font-medium">
                  {tier.badge}
                </span>
              </div>
            )}

            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white">{tier.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
              <div className="flex items-baseline gap-1 mt-4">
                <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                {tier.period && (
                  <span className="text-muted-foreground text-sm">{tier.period}</span>
                )}
              </div>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {tier.features.map((feature, idx) => (
                <li key={feature} className="flex items-start gap-3">
                  {idx === 0 && feature.includes("Everything in") ? (
                    <span className="text-sm text-muted-foreground">{feature}</span>
                  ) : (
                    <>
                      <Check className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                      <span className="text-sm text-white/90">{feature}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>

            <Link
              href={tier.href}
              className={`block w-full text-center py-3 rounded-lg text-sm font-medium transition-all ${
                tier.highlighted
                  ? "bg-accent text-accent-foreground hover:bg-accent/90 shadow-md shadow-accent/20"
                  : "bg-white/5 hover:bg-white/10 border border-white/10"
              }`}
            >
              {tier.cta}
            </Link>
          </div>
        ))}
      </div>

      <p className="text-center text-muted-foreground mt-12">
        All plans include unlimited error tracking.{" "}
        <Link href="https://github.com/bugwatch/bugwatch" className="text-accent hover:underline">
          Self-host for free
        </Link>{" "}
        with MIT license.
      </p>
    </section>
  );
}
