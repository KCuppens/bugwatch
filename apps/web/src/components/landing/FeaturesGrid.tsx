import { AlertCircle, CheckCircle2, Activity, GitFork, Bell } from "lucide-react";
import { FadeUp } from "./motion";

function MockIssueList() {
  const issues = [
    { level: "fatal", color: "red", label: "TypeError: Cannot read property 'id'", count: "847", time: "2m ago" },
    { level: "error", color: "orange", label: "Unhandled Rejection: Network Error", count: "234", time: "5m ago" },
    { level: "error", color: "orange", label: "RangeError: Maximum call stack exceeded", count: "91", time: "12m ago" },
    { level: "resolved", color: "accent", label: "ReferenceError: user is not defined", count: "12", time: "1h ago" },
  ];
  return (
    <div className="mt-6 divide-y divide-[hsl(var(--border-subtle))] rounded-lg overflow-hidden border border-[hsl(var(--border-subtle))]">
      {issues.map((issue) => (
        <div
          key={issue.label}
          className={`flex items-center gap-3 px-3 py-2.5 bg-[hsl(var(--surface-1))] border-l-4 ${
            issue.color === "red"
              ? "border-l-red-500"
              : issue.color === "orange"
                ? "border-l-orange-500"
                : "border-l-[hsl(var(--accent))] opacity-60"
          }`}
        >
          {issue.level === "resolved" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--accent))] shrink-0" />
          ) : (
            <AlertCircle
              className={`h-3.5 w-3.5 shrink-0 ${issue.color === "red" ? "text-red-500" : "text-orange-500"}`}
            />
          )}
          <span className="font-mono text-xs truncate flex-1 text-[hsl(var(--foreground))]">{issue.label}</span>
          <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
            {issue.count} · {issue.time}
          </span>
        </div>
      ))}
    </div>
  );
}

function UptimeDots() {
  const statuses = [
    true,
    true,
    true,
    true,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ];
  return (
    <div
      role="img"
      aria-label={`30-day uptime history: ${statuses.filter(Boolean).length} of ${statuses.length} intervals online`}
      className="mt-4 flex flex-wrap gap-1"
    >
      {statuses.map((up, i) => (
        <div
          key={i}
          className={`w-5 h-5 rounded-sm ${up ? "bg-emerald-500/80" : "bg-red-500/80"}`}
          title={up ? "Online" : "Down"}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function FeaturesGrid() {
  return (
    <section className="container mx-auto px-4 py-20 md:py-28">
      <FadeUp>
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-sans text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 text-[hsl(var(--foreground))]">
            Everything you need. <span className="text-[hsl(var(--accent))]">Nothing you don&apos;t.</span>
          </h2>
          <p className="text-lg text-[hsl(var(--muted-foreground))]">
            Powerful error tracking without the complexity or the bill shock.
          </p>
        </div>
      </FadeUp>

      {/* Bento grid — 12 columns */}
      <div className="grid grid-cols-12 gap-4 max-w-5xl mx-auto">
        {/* Card 1: Large — animated mock issue list (6col × 2row) */}
        <FadeUp className="col-span-12 md:col-span-7 md:row-span-2">
          <div className="surface-card p-6 h-full min-h-[280px]">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-xs font-bold text-red-400">3 FATAL · 12 ERROR</span>
              <span className="ml-auto font-mono text-[10px] text-[hsl(var(--muted-foreground))]">23 unresolved</span>
            </div>
            <MockIssueList />
            <div className="mt-4 flex items-center gap-3">
              <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">Last event 2m ago</span>
              <span className="ml-auto px-2 py-0.5 rounded bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))] font-mono text-[10px] font-bold">
                UNLIMITED ERRORS · $0 extra
              </span>
            </div>
          </div>
        </FadeUp>

        {/* Card 2: Uptime monitor dots (5col) */}
        <FadeUp delay={0.05} className="col-span-12 md:col-span-5">
          <div className="surface-card p-6 h-full">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-[hsl(var(--accent))]" />
              <span className="font-sans text-sm font-semibold text-[hsl(var(--foreground))]">Uptime Monitoring</span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">30-day history — all monitors</p>
            <UptimeDots />
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold text-emerald-400">99.3%</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">avg uptime</span>
            </div>
          </div>
        </FadeUp>

        {/* Card 3: Flat pricing copy (5col) */}
        <FadeUp delay={0.1} className="col-span-12 md:col-span-5">
          <div className="surface-card p-6 h-full">
            <div className="font-mono text-3xl font-bold text-[hsl(var(--accent))] mb-1">$0</div>
            <div className="font-mono text-xs text-[hsl(var(--muted-foreground))] mb-3">extra per error — ever</div>
            <p className="font-sans text-sm font-semibold text-[hsl(var(--foreground))] mb-1">
              Flat pricing. No surprises.
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
              Pay per seat, not per event. Catch a million errors during an incident — your bill doesn&apos;t budge.
            </p>
          </div>
        </FadeUp>

        {/* Card 4: Stack trace snippet (4col) */}
        <FadeUp delay={0.15} className="col-span-12 sm:col-span-6 md:col-span-4">
          <div className="surface-card p-5 h-full">
            <div className="flex items-center gap-2 mb-3">
              <GitFork className="h-4 w-4 text-[hsl(var(--accent))]" />
              <span className="font-sans text-sm font-semibold text-[hsl(var(--foreground))]">Stack Traces</span>
            </div>
            <pre className="font-mono text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed overflow-hidden">
              <span className="text-red-400">TypeError</span>
              {`: Cannot read\n  at getUser (api.ts:42)\n  at handler (route.ts:18)\n  at Server.<anon>`}
            </pre>
          </div>
        </FadeUp>

        {/* Card 5: Alert notification preview (4col) */}
        <FadeUp delay={0.2} className="col-span-12 sm:col-span-6 md:col-span-4">
          <div className="surface-card p-5 h-full">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4 text-[hsl(var(--accent))]" />
              <span className="font-sans text-sm font-semibold text-[hsl(var(--foreground))]">Smart Alerts</span>
            </div>
            <div className="space-y-2">
              {["Slack", "PagerDuty", "Discord", "Webhooks"].map((ch) => (
                <div key={ch} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-[hsl(var(--accent))] shrink-0" />
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">{ch}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeUp>

        {/* Card 6: Terminal card — wide (4col) */}
        <FadeUp delay={0.25} className="col-span-12 md:col-span-4">
          <div className="surface-card p-5 h-full">
            <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono mb-2">ZERO-CONFIG SETUP</div>
            <div className="rounded-md bg-[hsl(var(--surface-3))] p-3 font-mono text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">$ </span>
              <span className="text-[hsl(var(--accent))]">npx bugwatch init</span>
              <div className="mt-1.5 text-[hsl(var(--muted-foreground))]">
                ✓ Detected Next.js
                <br />
                ✓ SDK installed
                <br />
                <span className="text-[hsl(var(--accent))]">✓ Ready in 12s</span>
              </div>
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
