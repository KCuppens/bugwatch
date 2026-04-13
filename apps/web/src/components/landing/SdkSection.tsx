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
          <h2 className="font-display text-display-md md:text-display-lg mb-4">
            Works with{" "}
            <span className="text-accent">your stack</span>
          </h2>
          <p className="text-body-lg text-muted-foreground">
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
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-surface-2 border border-border-subtle cursor-default"
          >
            <span className="text-lg">{fw.icon}</span>
            <span className="font-medium text-sm">{fw.name}</span>
          </div>
        ))}
      </div>
      </FadeUp>

      {/* Code snippet */}
      <ScaleIn delay={0.2}>
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl glass-card overflow-hidden glow">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
              <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
              <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
            </div>
            <span className="text-xs text-muted-foreground ml-2">terminal</span>
          </div>
          <div className="p-6 font-mono text-sm">
            <div className="flex items-center">
              <span className="text-accent mr-2">$</span>
              <span className="text-foreground">npm install @bugwatch/auto</span>
            </div>
            <div className="mt-4 text-muted-foreground"># That's it. Add one import:</div>
            <div className="mt-3">
              <span className="text-accent">import</span>{" "}
              <span className="text-foreground">'@bugwatch/auto'</span>
              <span className="text-muted-foreground">;</span>
            </div>
            <div className="mt-4 text-muted-foreground"># Errors are now tracked automatically</div>
          </div>
        </div>

        <div className="text-center mt-8">
          <Link
            href="/docs/sdks"
            className="text-accent hover:underline"
          >
            View all integrations →
          </Link>
        </div>
      </div>
      </ScaleIn>
    </section>
  );
}
