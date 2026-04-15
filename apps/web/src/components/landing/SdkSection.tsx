import Link from "next/link";
import { FadeUp, ScaleIn } from "./motion";

const frameworks = [
  { name: "JavaScript", icon: "JS" },
  { name: "TypeScript", icon: "TS" },
  { name: "React", icon: "⚛️" },
  { name: "Next.js", icon: "▲" },
  { name: "Node.js", icon: "⬢" },
  { name: "Python", icon: "🐍" },
  { name: "Rust", icon: "🦀" },
];

export function SdkSection() {
  return (
    <section className="container mx-auto px-4 py-28">
      <FadeUp>
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-sans text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 text-[hsl(var(--foreground))]">
            Works with <span className="text-[hsl(var(--accent))]">your stack</span>
          </h2>
          <p className="text-lg text-[hsl(var(--muted-foreground))]">
            Drop-in SDKs for all major frameworks. Zero config required.
          </p>
        </div>
      </FadeUp>

      {/* Framework icons */}
      <FadeUp delay={0.1}>
        <div className="flex flex-wrap justify-center gap-3 mb-12">
          {frameworks.map((fw) => (
            <div
              key={fw.name}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[hsl(var(--surface-2))] border border-[hsl(var(--border-subtle))] cursor-default"
            >
              <span className="text-lg" aria-hidden="true">
                {fw.icon}
              </span>
              <span className="font-medium text-sm">{fw.name}</span>
            </div>
          ))}
        </div>
      </FadeUp>

      {/* Code snippet */}
      <ScaleIn delay={0.2}>
        <div className="max-w-2xl mx-auto">
          <div className="surface-raised rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border-subtle))]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[hsl(var(--surface-3))]" />
                <div className="w-3 h-3 rounded-full bg-[hsl(var(--surface-3))]" />
                <div className="w-3 h-3 rounded-full bg-[hsl(var(--surface-3))]" />
              </div>
              <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono ml-2">terminal</span>
            </div>
            <div className="p-6 font-mono text-sm bg-[hsl(var(--background))]">
              <div className="flex items-center">
                <span className="text-[hsl(var(--accent))] mr-2">$</span>
                <span className="text-[hsl(var(--foreground))]">npm install @bugwatch/auto</span>
              </div>
              <div className="mt-4 text-[hsl(var(--muted-foreground))]"># That&apos;s it. Add one import:</div>
              <div className="mt-3">
                <span className="text-[hsl(var(--accent))]">import</span>{" "}
                <span className="text-[hsl(var(--foreground))]">&apos;@bugwatch/auto&apos;</span>
                <span className="text-[hsl(var(--muted-foreground))]">;</span>
              </div>
              <div className="mt-4 text-[hsl(var(--muted-foreground))]"># Errors are now tracked automatically</div>
            </div>
          </div>

          <div className="text-center mt-8">
            <Link href="/docs/sdks" className="text-[hsl(var(--accent))] hover:underline text-sm">
              View all integrations →
            </Link>
          </div>
        </div>
      </ScaleIn>
    </section>
  );
}
