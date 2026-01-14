export function SocialProof() {
  return (
    <section className="py-12">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-center gap-3 glass-card rounded-full py-3 px-6 w-fit mx-auto">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-accent/20 border-2 border-background" />
            <div className="w-8 h-8 rounded-full bg-accent/30 border-2 border-background" />
            <div className="w-8 h-8 rounded-full bg-accent/40 border-2 border-background" />
            <div className="w-8 h-8 rounded-full bg-accent/50 border-2 border-background" />
          </div>
          <p className="text-sm">
            Trusted by developers tracking{" "}
            <span className="font-bold text-accent">1M+ errors</span>{" "}
            without limits
          </p>
        </div>
      </div>
    </section>
  );
}
