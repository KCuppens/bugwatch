import { FadeUp } from "./motion";

export function SocialProof() {
  return (
    <section className="py-16">
      <div className="container mx-auto px-4">
        <FadeUp>
        <div className="flex items-center justify-center gap-3 bg-surface-2 border border-border-subtle rounded-full shadow-sm py-3 px-6 w-fit mx-auto">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-accent/20 border-2 border-background" />
            <div className="w-8 h-8 rounded-full bg-accent/30 border-2 border-background" />
            <div className="w-8 h-8 rounded-full bg-accent/40 border-2 border-background" />
            <div className="w-8 h-8 rounded-full bg-accent/50 border-2 border-background" />
          </div>
          <p className="text-sm">
            Built for teams tracking{" "}
            <span className="font-bold text-accent">millions of errors</span>{" "}
            without limits
          </p>
        </div>
        </FadeUp>
      </div>
    </section>
  );
}
