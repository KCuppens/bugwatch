import { Check, X } from "lucide-react";
import { FadeUp, StaggerContainer, StaggerItem } from "./motion";

export function ProblemSection() {
  return (
    <section className="container mx-auto px-4 py-20 md:py-28">
      <FadeUp>
      <div className="text-center max-w-2xl mx-auto mb-16">
        <h2 className="font-display text-display-md md:text-display-lg mb-4">
          You shouldn't pay more{" "}
          <span className="text-accent">when things go wrong</span>
        </h2>
        <p className="text-body-lg text-muted-foreground">
          When your app goes viral or hits a bug storm, other tools charge you more.
          We charge you the same. Always.
        </p>
      </div>
      </FadeUp>

      {/* Comparison */}
      <StaggerContainer className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Other tools */}
        <StaggerItem>
        <div className="p-8 elev-0 md:mt-6">
          <div className="flex items-center gap-2 mb-6">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
              <X className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <span className="font-semibold text-red-500">Usage-based pricing</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-3">
              <span className="text-muted-foreground">Normal month</span>
              <span className="font-mono font-medium tabular-nums">$29/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-muted-foreground">Traffic spike</span>
              <span className="font-mono font-medium text-red-500 tabular-nums">$340/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-muted-foreground">Bug storm</span>
              <span className="font-mono font-medium text-red-500 tabular-nums">$1,200+/mo</span>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-surface-3 border border-border-subtle">
            <p className="text-sm italic text-muted-foreground">
              "We had to disable error tracking during our Product Hunt launch because of costs."
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              — Common complaint from teams on usage-based pricing
            </p>
          </div>
        </div>
        </StaggerItem>

        {/* BugWatch */}
        <StaggerItem>
        <div className="p-8 elev-2 border-accent/30">
          <div className="flex items-center gap-2 mb-6">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <span className="font-semibold text-accent">BugWatch pricing</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-3">
              <span className="text-muted-foreground">Normal month</span>
              <span className="font-mono font-medium tabular-nums">$29/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-accent/10 border border-accent/20">
              <span className="text-muted-foreground">Traffic spike</span>
              <span className="font-mono font-medium text-accent tabular-nums">$29/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-accent/10 border border-accent/20">
              <span className="text-muted-foreground">Bug storm</span>
              <span className="font-mono font-medium text-accent tabular-nums">$29/mo</span>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-accent/5 border border-accent/20">
            <p className="text-sm italic text-muted-foreground">
              "Finally, I can ship without checking my billing dashboard first."
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              — What BugWatch users experience
            </p>
          </div>
        </div>
        </StaggerItem>
      </StaggerContainer>
    </section>
  );
}
