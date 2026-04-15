"use client";

import { useState } from "react";
import Link from "next/link";
import { Github, Book, Shield, Download } from "lucide-react";
import { toast } from "sonner";
import { FadeUp, ScaleIn, StaggerContainer, StaggerItem } from "./motion";

export function OpenSourceSection() {
  const [copied, setCopied] = useState(false);

  return (
    <section className="container mx-auto px-4 py-28">
      <div className="max-w-4xl mx-auto rounded-xl surface-card border-accent/20 p-8 sm:p-12">
        <FadeUp>
          <div className="text-center mb-10">
            <h2 className="font-display text-display-md md:text-display-lg mb-4">
              Deploy anywhere. <span className="text-accent">Own your data.</span>
            </h2>
            <p className="text-body-lg text-muted-foreground max-w-2xl mx-auto">
              BugWatch is open source under the MIT license. Run it on your own infrastructure with full control over
              your error data.
            </p>
          </div>
        </FadeUp>

        {/* Docker command */}
        <ScaleIn delay={0.1}>
          <div className="max-w-2xl mx-auto mb-10">
            <div className="rounded-xl bg-surface-3 border border-border-subtle overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                <span className="text-xs text-muted-foreground">Deploy in one command</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText("docker run -p 3000:3000 bugwatch/bugwatch");
                    toast.success("Copied to clipboard");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="p-4 font-mono text-sm">
                <span className="text-accent">$</span>{" "}
                <span className="text-foreground">docker run -p 3000:3000 bugwatch/bugwatch</span>
              </div>
            </div>
          </div>
        </ScaleIn>

        {/* Benefits */}
        <StaggerContainer className="grid sm:grid-cols-3 gap-6 mb-10">
          <StaggerItem>
            <div className="text-center p-6 rounded-xl bg-surface-3 border border-border-subtle">
              <Shield className="h-10 w-10 mx-auto mb-4 text-accent" />
              <h3 className="font-semibold mb-2">Data Privacy</h3>
              <p className="text-sm text-muted-foreground">Errors never leave your network</p>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="text-center p-6 rounded-xl bg-surface-3 border border-border-subtle">
              <Download className="h-10 w-10 mx-auto mb-4 text-accent" />
              <h3 className="font-semibold mb-2">No Vendor Lock-in</h3>
              <p className="text-sm text-muted-foreground">Export your data anytime</p>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="text-center p-6 rounded-xl bg-surface-3 border border-border-subtle">
              <Github className="h-10 w-10 mx-auto mb-4 text-accent" />
              <h3 className="font-semibold mb-2">Community Driven</h3>
              <p className="text-sm text-muted-foreground">Contribute and shape the roadmap</p>
            </div>
          </StaggerItem>
        </StaggerContainer>

        {/* CTAs */}
        <FadeUp delay={0.2}>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="https://github.com/KCuppens/bugwatch"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-6 py-3 rounded-full font-medium hover:bg-accent/90 transition-colors"
            >
              <Github className="h-5 w-5" />
              View on GitHub
            </Link>
            <Link
              href="/docs/self-hosting"
              className="inline-flex items-center justify-center gap-2 bg-surface-2 border border-border-subtle px-6 py-3 rounded-full font-medium hover:bg-surface-3 transition-colors"
            >
              <Book className="h-5 w-5" />
              Self-Hosting Guide
            </Link>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
