import Link from "next/link";

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
    <section className="container mx-auto px-4 py-24">
      <div className="text-center max-w-2xl mx-auto mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Works with{" "}
          <span className="text-accent">your stack</span>
        </h2>
        <p className="text-lg text-muted-foreground">
          Drop-in SDKs for all major frameworks. Zero config required.
        </p>
      </div>

      {/* Framework icons */}
      <div className="flex flex-wrap justify-center gap-3 mb-12">
        {frameworks.map((fw) => (
          <div
            key={fw.name}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full glass-card hover:border-white/20 transition-colors"
          >
            <span className="text-lg">{fw.icon}</span>
            <span className="font-medium text-sm">{fw.name}</span>
          </div>
        ))}
      </div>

      {/* Code snippet */}
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl glass-card overflow-hidden glow">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="w-3 h-3 rounded-full bg-white/20" />
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
            href="/docs"
            className="text-accent hover:underline"
          >
            View all integrations →
          </Link>
        </div>
      </div>
    </section>
  );
}
