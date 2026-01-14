import { AlertTriangle, Check } from "lucide-react";

export function ProblemSection() {
  return (
    <section className="container mx-auto px-4 py-24">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          You shouldn't pay more{" "}
          <span className="text-accent">when things go wrong</span>
        </h2>
        <p className="text-lg text-muted-foreground">
          When your app goes viral or hits a bug storm, other tools charge you more.
          We charge you the same. Always.
        </p>
      </div>

      {/* Comparison */}
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {/* Other tools */}
        <div className="p-8 rounded-2xl glass-card">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <span className="font-semibold text-red-500">Usage-based pricing</span>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
              <span className="text-muted-foreground">Normal month</span>
              <span className="font-mono font-medium">$29/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-muted-foreground">Traffic spike</span>
              <span className="font-mono font-medium text-red-500">$340/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-muted-foreground">Bug storm</span>
              <span className="font-mono font-medium text-red-500">$1,200+/mo</span>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/10">
            <p className="text-sm text-muted-foreground italic">
              "We had to disable error tracking during our Product Hunt launch because of costs."
            </p>
          </div>
        </div>

        {/* BugWatch */}
        <div className="p-8 rounded-2xl glass-card border-accent/20">
          <div className="flex items-center gap-2 mb-6">
            <Check className="h-5 w-5 text-accent" />
            <span className="font-semibold text-accent">BugWatch pricing</span>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
              <span className="text-muted-foreground">Normal month</span>
              <span className="font-mono font-medium">$29/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-accent/10 border border-accent/20">
              <span className="text-muted-foreground">Traffic spike</span>
              <span className="font-mono font-medium text-accent">$29/mo</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-accent/10 border border-accent/20">
              <span className="text-muted-foreground">Bug storm</span>
              <span className="font-mono font-medium text-accent">$29/mo</span>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-accent/5 border border-accent/20">
            <p className="text-sm text-muted-foreground italic">
              "Finally, I can ship without checking my billing dashboard first."
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
