import Link from "next/link";
import { Github, Book, Shield, Download } from "lucide-react";

export function OpenSourceSection() {
  return (
    <section className="container mx-auto px-4 py-24">
      <div className="max-w-4xl mx-auto rounded-2xl glass-card border-accent/20 p-8 sm:p-12">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Deploy anywhere.{" "}
            <span className="text-accent">Own your data.</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            BugWatch is open source under the MIT license. Run it on your own infrastructure
            with full control over your error data.
          </p>
        </div>

        {/* Docker command */}
        <div className="max-w-2xl mx-auto mb-10">
          <div className="rounded-xl glass-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-xs text-muted-foreground">Deploy in one command</span>
              <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Copy
              </button>
            </div>
            <div className="p-4 font-mono text-sm">
              <span className="text-accent">$</span>{" "}
              <span className="text-foreground">docker run -p 3000:3000 bugwatch/bugwatch</span>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="grid sm:grid-cols-3 gap-6 mb-10">
          <div className="text-center p-6 rounded-xl glass-card">
            <Shield className="h-10 w-10 mx-auto mb-4 text-accent" />
            <h3 className="font-semibold mb-2">Data Privacy</h3>
            <p className="text-sm text-muted-foreground">
              Errors never leave your network
            </p>
          </div>
          <div className="text-center p-6 rounded-xl glass-card">
            <Download className="h-10 w-10 mx-auto mb-4 text-accent" />
            <h3 className="font-semibold mb-2">No Vendor Lock-in</h3>
            <p className="text-sm text-muted-foreground">
              Export your data anytime
            </p>
          </div>
          <div className="text-center p-6 rounded-xl glass-card">
            <Github className="h-10 w-10 mx-auto mb-4 text-accent" />
            <h3 className="font-semibold mb-2">Community Driven</h3>
            <p className="text-sm text-muted-foreground">
              Contribute and shape the roadmap
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="https://github.com/bugwatch/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-6 py-3 rounded-full font-medium hover:bg-accent/90 transition-colors"
          >
            <Github className="h-5 w-5" />
            View on GitHub
          </Link>
          <Link
            href="/docs/self-hosting"
            className="inline-flex items-center justify-center gap-2 glass px-6 py-3 rounded-full font-medium hover:bg-white/10 transition-colors"
          >
            <Book className="h-5 w-5" />
            Self-Hosting Guide
          </Link>
        </div>
      </div>
    </section>
  );
}
