import { Download, Rocket, BellRing } from "lucide-react";
import { FadeUp, StaggerContainer, StaggerItem } from "./motion";

const steps = [
  {
    n: "01",
    icon: Download,
    title: "Install the SDK",
    description: "One command. Zero config. Auto-detects your framework and wires up in under 60 seconds.",
    code: "npm install @bugwatch/sdk",
  },
  {
    n: "02",
    icon: Rocket,
    title: "Ship your app",
    description: "Deploy to prod. BugWatch captures every error, trace, and context automatically.",
    code: "bugwatch.init({ dsn: '...' })",
  },
  {
    n: "03",
    icon: BellRing,
    title: "Get alerted on real bugs",
    description: "Smart grouping surfaces the issues that matter. Slack, PagerDuty, webhooks — your call.",
    code: "→ #alerts channel",
  },
];

export function HowItWorks() {
  return (
    <section className="container mx-auto px-4 py-20 md:py-28">
      <FadeUp>
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-caption uppercase tracking-wider text-accent-2 mb-3">How it works</p>
          <h2 className="font-display text-display-md md:text-display-lg mb-4">
            Three steps to <span className="text-accent">shipping fearlessly</span>
          </h2>
          <p className="text-body-lg text-muted-foreground">
            From install to first alert in under five minutes.
          </p>
        </div>
      </FadeUp>

      <StaggerContainer className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {steps.map(({ n, icon: Icon, title, description, code }) => (
          <StaggerItem key={n}>
            <div className="relative p-8 h-full elev-1 card-hover transform-gpu">
              <span className="absolute top-6 right-6 font-display text-4xl font-bold text-border-strong tabular-nums select-none">
                {n}
              </span>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-2/10 text-accent-2 mb-5">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3 className="text-heading-sm mb-2">{title}</h3>
              <p className="text-body-sm text-muted-foreground mb-5">{description}</p>
              <div className="px-3 py-2 rounded-lg bg-surface-3 border border-border-subtle">
                <code className="font-mono text-mono-sm text-foreground/80">{code}</code>
              </div>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}
