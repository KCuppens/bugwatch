import Link from "next/link";
import { ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";

function DashboardPreview() {
  return (
    <div className="relative mx-auto max-w-4xl mt-16">
      {/* Browser chrome */}
      <div className="rounded-2xl glass-card overflow-hidden glow">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-white/20" />
            <div className="w-3 h-3 rounded-full bg-white/20" />
            <div className="w-3 h-3 rounded-full bg-white/20" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-4 py-1 rounded-full bg-white/5 text-xs text-muted-foreground">
              app.bugwatch.dev/dashboard/issues
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-6">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-xl glass-card">
              <div className="text-2xl font-bold">1,247</div>
              <div className="text-xs text-muted-foreground">Total Errors</div>
            </div>
            <div className="p-4 rounded-xl glass-card">
              <div className="text-2xl font-bold text-red-500">23</div>
              <div className="text-xs text-muted-foreground">Unresolved</div>
            </div>
            <div className="p-4 rounded-xl glass-card">
              <div className="text-2xl font-bold text-accent">98.2%</div>
              <div className="text-xs text-muted-foreground">Uptime</div>
            </div>
            <div className="p-4 rounded-xl glass-card">
              <div className="text-2xl font-bold">$0</div>
              <div className="text-xs text-muted-foreground">This Month</div>
            </div>
          </div>

          {/* Issues list */}
          <div className="rounded-xl glass-card overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <span className="font-medium">Recent Issues</span>
            </div>
            <div className="divide-y divide-white/5">
              <div className="px-4 py-3 flex items-center gap-4">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">TypeError: Cannot read property 'id' of undefined</div>
                  <div className="text-xs text-muted-foreground">src/api/users.ts:142 · 847 events</div>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs bg-accent text-accent-foreground font-medium">
                  AI Fix
                </span>
              </div>
              <div className="px-4 py-3 flex items-center gap-4">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">Unhandled Promise Rejection: Network Error</div>
                  <div className="text-xs text-muted-foreground">src/lib/fetch.ts:28 · 234 events</div>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs bg-accent text-accent-foreground font-medium">
                  AI Fix
                </span>
              </div>
              <div className="px-4 py-3 flex items-center gap-4">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">ReferenceError: user is not defined</div>
                  <div className="text-xs text-muted-foreground">src/components/Profile.tsx:56 · Fixed by AI</div>
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
    <section className="container mx-auto px-4 pt-24 pb-16">
      <div className="text-center max-w-3xl mx-auto">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
          Error tracking that doesn't{" "}
          <span className="text-accent">punish growth</span>
        </h1>
        <p className="text-xl text-muted-foreground mb-8">
          Unlimited errors. AI-powered fixes. Open source.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-8 py-3 rounded-full text-lg font-medium hover:bg-accent/90 transition-colors"
          >
            Get Started Free
          </Link>
          <Link
            href="https://github.com/bugwatch/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 glass px-8 py-3 rounded-full text-lg font-medium hover:bg-white/10 transition-colors"
          >
            Self-Host
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <DashboardPreview />
    </section>
  );
}
