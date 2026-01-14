import { Infinity, Bot, Zap, GitFork, Server, Bell } from "lucide-react";

export function FeaturesGrid() {
  return (
    <section className="container mx-auto px-4 py-24">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Everything you need.{" "}
          <span className="text-accent">Nothing you don't.</span>
        </h2>
        <p className="text-lg text-muted-foreground">
          Powerful error tracking without the complexity or the bill shock.
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
        {/* Large card - spans 2 columns */}
        <div className="md:col-span-2 md:row-span-2 p-8 rounded-2xl glass-card border-accent/20 hover:border-accent/40 transition-colors">
          <Infinity className="h-12 w-12 mb-6 text-accent" />
          <h3 className="text-2xl font-bold mb-3">Unlimited Errors</h3>
          <p className="text-muted-foreground text-lg">
            No event limits. No throttling. Track every error without worrying about caps or surprise bills.
          </p>
          <div className="mt-8 p-4 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Errors this month</span>
              <span className="font-mono font-bold text-accent">1,247,832</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-muted-foreground">Your cost</span>
              <span className="font-mono font-bold">$29/mo</span>
            </div>
          </div>
        </div>

        {/* Medium cards */}
        <div className="p-6 rounded-2xl glass-card hover:border-white/20 transition-colors">
          <Bot className="h-10 w-10 mb-4 text-accent" />
          <h3 className="text-xl font-semibold mb-2">AI-Powered Fixes</h3>
          <p className="text-muted-foreground text-sm">
            Claude analyzes your errors and suggests actual code fixes. One click to understand the root cause.
          </p>
        </div>

        <div className="p-6 rounded-2xl glass-card hover:border-white/20 transition-colors">
          <Zap className="h-10 w-10 mb-4 text-accent" />
          <h3 className="text-xl font-semibold mb-2">Zero-Config SDK</h3>
          <p className="text-muted-foreground text-sm">
            One import. Auto-detects your framework. Start tracking errors in under 60 seconds.
          </p>
        </div>

        {/* Small cards row */}
        <div className="p-6 rounded-2xl glass-card hover:border-white/20 transition-colors">
          <GitFork className="h-8 w-8 mb-3 text-accent" />
          <h3 className="text-lg font-semibold mb-1">Open Source</h3>
          <p className="text-muted-foreground text-sm">
            MIT licensed. Read the code. Fork it. No vendor lock-in.
          </p>
        </div>

        <div className="p-6 rounded-2xl glass-card hover:border-white/20 transition-colors">
          <Server className="h-8 w-8 mb-3 text-accent" />
          <h3 className="text-lg font-semibold mb-1">Self-Host Option</h3>
          <p className="text-muted-foreground text-sm">
            Single binary. Run on your own servers.
          </p>
        </div>

        <div className="p-6 rounded-2xl glass-card hover:border-white/20 transition-colors">
          <Bell className="h-8 w-8 mb-3 text-accent" />
          <h3 className="text-lg font-semibold mb-1">Smart Alerts</h3>
          <p className="text-muted-foreground text-sm">
            PagerDuty, Slack, Discord, webhooks.
          </p>
        </div>
      </div>
    </section>
  );
}
