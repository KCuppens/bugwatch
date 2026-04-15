import Link from "next/link";
import { ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { FadeUp, ScaleIn } from "./motion";

function DashboardPreview() {
  return (
    <div className="relative w-full">
      {/* Accent glow behind preview */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background: "radial-gradient(ellipse, rgba(232,255,71,0.12) 0%, transparent 70%)",
        }}
      />
      {/* Browser chrome */}
      <div className="surface-raised rounded-xl overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border-subtle))]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--surface-3))]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--surface-3))]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--surface-3))]" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-4 py-1 rounded-md bg-[hsl(var(--surface-3))] text-xs text-[hsl(var(--muted-foreground))] font-mono">
              app.bugwatch.dev/dashboard
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-4 bg-[hsl(var(--background))]">
          {/* Triage bar mock */}
          <div className="flex items-center gap-3 h-8 px-3 mb-4 rounded-md bg-[hsl(var(--surface-1))] border border-[hsl(var(--border-subtle))]">
            <span className="text-xs font-mono font-bold text-red-400 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />3 FATAL
            </span>
            <div className="h-3 w-px bg-[hsl(var(--border-subtle))]" />
            <span className="text-xs font-mono font-bold text-orange-400 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              12 ERROR
            </span>
            <span className="ml-auto text-xs font-mono text-[hsl(var(--muted-foreground))]">23 unresolved</span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: "Unresolved", value: "23", color: "text-orange-400" },
              { label: "Events", value: "1,247", color: "text-[hsl(var(--foreground))]" },
              { label: "Uptime", value: "98.2%", color: "text-emerald-400" },
              { label: "This Month", value: "$0", color: "text-[hsl(var(--accent))]" },
            ].map((stat) => (
              <div key={stat.label} className="surface-card p-3">
                <div className={`text-lg font-mono font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Issues list */}
          <div className="surface-card overflow-hidden">
            <div className="divide-y divide-[hsl(var(--border-subtle))]">
              <div className="px-3 py-2.5 flex items-center gap-3 border-l-4 border-l-red-500">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">TypeError: Cannot read property &apos;id&apos;</div>
                  <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">847 events · 2m ago</div>
                </div>
              </div>
              <div className="px-3 py-2.5 flex items-center gap-3 border-l-4 border-l-orange-500">
                <AlertCircle className="h-4 w-4 text-orange-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">Unhandled Rejection: Network Error</div>
                  <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">234 events · 5m ago</div>
                </div>
              </div>
              <div className="px-3 py-2.5 flex items-center gap-3 border-l-4 border-l-[hsl(var(--accent))] opacity-60">
                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--accent))] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">ReferenceError: user is not defined</div>
                  <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">Resolved 2h ago</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative container mx-auto px-4 pt-20 md:pt-28 pb-20 bg-grid-pattern">
      <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
        {/* Left 60%: Text content */}
        <div className="flex-[1.5] min-w-0">
          <FadeUp>
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface-2))] text-xs uppercase text-[hsl(var(--muted-foreground))] font-mono tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))] animate-pulse" />
              Open source · v1.0 shipping
            </div>
            <h1 className="font-sans text-4xl sm:text-5xl md:text-6xl font-bold leading-tight tracking-tight mb-6 text-[hsl(var(--foreground))]">
              Stop paying
              <br />
              per error.
              <br />
              <span className="text-[hsl(var(--accent))]">BugWatch.</span>
            </h1>
            <p className="text-lg text-[hsl(var(--muted-foreground))] mb-10 max-w-md">
              Open-source error tracking with flat pricing. Unlimited errors, zero surprise bills.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] text-sm font-semibold hover:bg-[hsl(var(--accent-2))] transition-colors"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="https://github.com/KCuppens/bugwatch"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg surface-panel text-sm font-medium text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))] transition-colors"
              >
                Self-host on GitHub →
              </Link>
            </div>
          </FadeUp>
        </div>

        {/* Right 40%: Dashboard preview */}
        <div className="flex-1 w-full lg:w-auto">
          <ScaleIn delay={0.15}>
            <DashboardPreview />
          </ScaleIn>
        </div>
      </div>
    </section>
  );
}
