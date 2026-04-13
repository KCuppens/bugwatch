import Link from "next/link";
import { ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { FadeUp, ScaleIn } from "./motion";

function DashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-5xl mt-16 overflow-hidden">
      {/* Browser chrome */}
      <div className="rounded-2xl elev-3 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
            <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
            <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-4 py-1 rounded-full bg-surface-3 text-xs text-muted-foreground">
              app.bugwatch.dev/dashboard/issues
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-6">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-surface-3 border border-border-subtle">
              <div className="text-2xl font-bold">1,247</div>
              <div className="text-xs text-muted-foreground">Total Errors</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-3 border border-border-subtle">
              <div className="text-2xl font-bold text-red-500">23</div>
              <div className="text-xs text-muted-foreground">Unresolved</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-3 border border-border-subtle">
              <div className="text-2xl font-bold text-accent">98.2%</div>
              <div className="text-xs text-muted-foreground">Uptime</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-3 border border-border-subtle">
              <div className="text-2xl font-bold">$0</div>
              <div className="text-xs text-muted-foreground">This Month</div>
            </div>
          </div>

          {/* Issues list */}
          <div className="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle">
              <span className="font-medium">Recent Issues</span>
            </div>
            <div className="divide-y divide-border-subtle">
              <div className="px-4 py-3 flex items-center gap-4">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">TypeError: Cannot read property 'id' of undefined</div>
                  <div className="text-xs text-muted-foreground">src/api/users.ts:142 · 847 events</div>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs bg-red-500/20 text-red-400 font-medium">
                  Unresolved
                </span>
              </div>
              <div className="px-4 py-3 flex items-center gap-4">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">Unhandled Promise Rejection: Network Error</div>
                  <div className="text-xs text-muted-foreground">src/lib/fetch.ts:28 · 234 events</div>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400 font-medium">
                  Investigating
                </span>
              </div>
              <div className="px-4 py-3 flex items-center gap-4">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">ReferenceError: user is not defined</div>
                  <div className="text-xs text-muted-foreground">src/components/Profile.tsx:56 · Resolved 2h ago</div>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs bg-accent/10 text-accent border border-accent/30">
                  Resolved
                </span>
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
    <section className="container mx-auto px-4 pt-20 md:pt-28 pb-20 md:pb-28">
      <FadeUp>
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-border-subtle bg-surface-2 text-caption uppercase text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Open source · v1.0 shipping
          </div>
          <h1 className="font-display text-display-md sm:text-display-lg md:text-display-xl mb-6">
            Error tracking that doesn't{" "}
            <span className="text-accent">punish growth</span>
          </h1>
          <p className="text-body-lg md:text-xl text-muted-foreground mb-10 max-w-[620px] mx-auto">
            Unlimited errors. Zero surprise bills. Open source.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-xl bg-accent text-accent-foreground text-base font-medium shadow-lg shadow-accent/25 hover:bg-accent/90 transition-all btn-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="https://github.com/KCuppens/bugwatch"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-xl bg-surface-2 border border-border-subtle text-base font-medium hover:bg-surface-3 hover:border-border-strong transition-all"
            >
              Self-Host on GitHub
            </Link>
          </div>
          <div className="mt-10 flex flex-col items-center gap-3">
            <p className="text-caption uppercase tracking-wider text-muted-foreground">
              Trusted by engineering teams shipping fast
            </p>
            <div className="flex items-center gap-8 opacity-60 grayscale text-muted-foreground text-sm font-semibold">
              <span>◆ Vercel</span>
              <span>▲ Railway</span>
              <span>● Fly.io</span>
              <span className="hidden sm:inline">◇ Render</span>
              <span className="hidden sm:inline">★ Supabase</span>
            </div>
          </div>
        </div>
      </FadeUp>

      <ScaleIn delay={0.2}>
        <div className="md:rotate-[0.5deg] transform-gpu">
          <DashboardPreview />
        </div>
      </ScaleIn>
    </section>
  );
}
