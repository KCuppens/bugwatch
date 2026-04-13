import Link from "next/link";
import { Github, Star } from "lucide-react";
import { FadeUp } from "./motion";

export function FinalCta() {
  return (
    <section className="container mx-auto px-4 py-28">
      <FadeUp>
        <div className="max-w-3xl mx-auto text-center">
        <h2 className="font-display text-display-md md:text-display-lg mb-4">
          Stop paying for{" "}
          <span className="text-accent">your mistakes</span>
        </h2>
        <p className="text-body-lg text-muted-foreground mb-8">
          Join developers who track errors without limits. Get started in under 60 seconds.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-8 py-4 rounded-full text-lg font-medium hover:bg-accent/90 transition-colors"
          >
            Get Started Free
          </Link>
          <Link
            href="https://github.com/KCuppens/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-surface-2 border border-border-subtle px-8 py-4 rounded-full text-lg font-medium hover:bg-surface-3 transition-colors"
          >
            <Github className="h-5 w-5" />
            Star on GitHub
            <Star className="h-4 w-4" />
          </Link>
        </div>
        </div>
      </FadeUp>
    </section>
  );
}
