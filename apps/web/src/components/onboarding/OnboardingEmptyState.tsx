"use client";

import Link from "next/link";
import { CodeBlock } from "@/components/onboarding/CodeBlock";
import type { Project } from "@/lib/api";

interface OnboardingEmptyStateProps {
  project: Project | null;
}

const PLATFORM_INSTALL: Record<string, string> = {
  javascript: "npm install @bugwatch/nextjs",
  python: "pip install bugwatch",
  rust: "cargo add bugwatch",
  go: "go get github.com/KCuppens/bugwatch-go",
  java: "# See docs for Maven/Gradle",
  ruby: "gem install bugwatch",
  php: "composer require bugwatch/bugwatch",
};

export function OnboardingEmptyState({ project }: OnboardingEmptyStateProps) {
  const installCmd = (project?.platform ? PLATFORM_INSTALL[project.platform] : null) ?? "npm install @bugwatch/nextjs";

  return (
    <div className="py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Column 1 — Setup CTA */}
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-2xl font-bold">No errors yet</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              That&apos;s expected — your SDK is listening.
            </p>
          </div>

          <CodeBlock code={installCmd} language="bash" />

          <Link href="/dashboard/projects/new" className="text-sm text-[hsl(var(--accent))] hover:underline">
            Complete setup guide →
          </Link>
        </div>

        {/* Column 2 — Radar animation */}
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="relative flex items-center justify-center h-24 w-24" aria-hidden="true">
            <div
              className="absolute inset-0 rounded-full border-2 border-[hsl(var(--accent))]/30 animate-ping"
              style={{ animationDuration: "2s" }}
            />
            <div
              className="absolute inset-2 rounded-full border-2 border-[hsl(var(--accent))]/20 animate-ping"
              style={{ animationDuration: "2.5s", animationDelay: "0.5s" }}
            />
            <div
              className="absolute inset-4 rounded-full border-2 border-[hsl(var(--accent))]/10 animate-ping"
              style={{ animationDuration: "3s", animationDelay: "1s" }}
            />
            <div className="h-4 w-4 rounded-full bg-[hsl(var(--accent))]" />
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))] text-center">
            We&apos;re listening for your first error...
          </p>
        </div>

        {/* Column 3 — Social proof */}
        <div className="surface-card p-6 flex flex-col gap-4">
          <div className="flex -space-x-2">
            <div className="h-8 w-8 rounded-full bg-blue-500/20 border-2 border-[hsl(var(--surface-1))] flex items-center justify-center text-xs text-blue-400">
              A
            </div>
            <div className="h-8 w-8 rounded-full bg-purple-500/20 border-2 border-[hsl(var(--surface-1))] flex items-center justify-center text-xs text-purple-400">
              K
            </div>
            <div className="h-8 w-8 rounded-full bg-green-500/20 border-2 border-[hsl(var(--surface-1))] flex items-center justify-center text-xs text-green-400">
              M
            </div>
          </div>
          <p className="text-sm font-medium">2,000+ engineering teams</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Trust BugWatch to catch errors before their users do.
          </p>
        </div>
      </div>
    </div>
  );
}
