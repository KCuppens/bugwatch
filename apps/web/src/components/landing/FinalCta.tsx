import Link from "next/link";
import { Github, Star } from "lucide-react";
import { FadeUp } from "./motion";

export function FinalCta() {
  return (
    <section className="container mx-auto px-4 py-28">
      <FadeUp>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-sans text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 text-[hsl(var(--foreground))]">
            Stop paying for <span className="text-[hsl(var(--accent))]">your mistakes</span>
          </h2>
          <p className="text-lg text-[hsl(var(--muted-foreground))] mb-8">
            Join developers who track errors without limits. Get started in under 60 seconds.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] px-8 py-4 rounded-lg text-base font-semibold font-sans hover:bg-[hsl(var(--accent-2))] transition-colors"
            >
              Get Started Free
            </Link>
            <Link
              href="https://github.com/KCuppens/bugwatch"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 surface-panel px-8 py-4 rounded-lg text-base font-medium font-sans text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))] transition-colors"
            >
              <Github className="h-5 w-5" aria-hidden="true" />
              Star on GitHub
              <Star className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </FadeUp>
    </section>
  );
}
