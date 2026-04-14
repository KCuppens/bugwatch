import { Infinity, Activity, Zap, GitFork, Server, Bell } from "lucide-react";
import { FadeUp, StaggerContainer, StaggerItem } from "./motion";

export function FeaturesGrid() {
  return (
    <section className="container mx-auto px-4 py-20 md:py-28">
      <FadeUp>
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display text-display-md md:text-display-lg mb-4">
            Everything you need. <span className="text-accent">Nothing you don't.</span>
          </h2>
          <p className="text-body-lg text-muted-foreground">
            Powerful error tracking without the complexity or the bill shock.
          </p>
        </div>
      </FadeUp>

      {/* Bento Grid */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {/* Large card - spans 2 columns */}
        <StaggerItem className="md:col-span-2 md:row-span-2">
          <div className="p-8 h-full liquid-glass-card card-hover transform-gpu">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent mb-6">
              <Infinity className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h3 className="text-heading-md mb-3">Unlimited Errors</h3>
            <p className="text-body-lg text-muted-foreground">
              No event limits. No throttling. Track every error without worrying about caps or surprise bills.
            </p>
            <div className="mt-8 p-4 rounded-xl bg-surface-3 border border-border-subtle">
              <div className="flex items-center justify-between text-body-sm">
                <span className="text-muted-foreground">Errors this month</span>
                <span className="font-mono font-bold text-accent tabular-nums">1,247,832</span>
              </div>
              <div className="flex items-center justify-between text-body-sm mt-2">
                <span className="text-muted-foreground">Your cost</span>
                <span className="font-mono font-bold tabular-nums">$29/mo</span>
              </div>
            </div>
          </div>
        </StaggerItem>

        {/* Medium cards */}
        <StaggerItem>
          <div className="p-6 h-full liquid-glass-card card-hover transform-gpu">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-2/10 text-accent-2 mb-4">
              <Activity className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="text-heading-sm mb-2">Server Monitoring</h3>
            <p className="text-muted-foreground text-body-sm">
              Track CPU, memory, and disk usage. Get alerted before your servers hit critical thresholds.
            </p>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="p-6 h-full liquid-glass-card card-hover transform-gpu">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-2/10 text-accent-2 mb-4">
              <Zap className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="text-heading-sm mb-2">Zero-Config SDK</h3>
            <p className="text-muted-foreground text-body-sm">
              One import. Auto-detects your framework. Start tracking errors in under 60 seconds.
            </p>
          </div>
        </StaggerItem>

        {/* Small cards row */}
        <StaggerItem>
          <div className="p-6 h-full liquid-glass-card card-hover transform-gpu">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-2/10 text-accent-2 mb-4">
              <GitFork className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="text-heading-sm mb-1">Open Source</h3>
            <p className="text-muted-foreground text-body-sm">
              MIT licensed. Read the code. Fork it. No vendor lock-in.
            </p>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="p-6 h-full liquid-glass-card card-hover transform-gpu">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-2/10 text-accent-2 mb-4">
              <Server className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="text-heading-sm mb-1">Self-Host Option</h3>
            <p className="text-muted-foreground text-body-sm">Single binary. Run on your own servers.</p>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="p-6 h-full liquid-glass-card card-hover transform-gpu">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-2/10 text-accent-2 mb-4">
              <Bell className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="text-heading-sm mb-1">Smart Alerts</h3>
            <p className="text-muted-foreground text-body-sm">PagerDuty, Slack, Discord, webhooks.</p>
          </div>
        </StaggerItem>
      </StaggerContainer>
    </section>
  );
}
