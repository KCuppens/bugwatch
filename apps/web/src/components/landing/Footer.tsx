import Link from "next/link";
import { Github } from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();

const navLinks = [
  { name: "Docs", href: "/docs" },
  { name: "Pricing", href: "/#pricing" },
  { name: "Changelog", href: "https://github.com/KCuppens/bugwatch/releases" },
  { name: "Self-Host", href: "/docs/self-hosting" },
  { name: "Privacy", href: "/privacy" },
  { name: "Terms", href: "/terms" },
];

export function Footer() {
  return (
    <footer className="border-t border-[hsl(var(--border-subtle))]">
      <div className="container mx-auto px-4 py-8">
        {/* Top row: logo mark + nav links + GitHub */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M8 2v3" />
                <path d="M16 2v3" />
                <rect x="4" y="6" width="16" height="14" rx="5" />
                <path d="M4 13h16" />
              </svg>
            </span>
            <span className="font-sans font-bold text-base tracking-tight text-[hsl(var(--foreground))]">BugWatch</span>
          </Link>

          <nav aria-label="Footer navigation" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </nav>

          <Link
            href="https://github.com/KCuppens/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="BugWatch on GitHub"
            className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors shrink-0"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            <span>GitHub</span>
          </Link>
        </div>

        {/* Bottom row: copyright + tagline */}
        <div className="mt-6 pt-6 border-t border-[hsl(var(--border-subtle))] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span>© {CURRENT_YEAR} BugWatch</span>
          <span>Open source. Self-host free.</span>
        </div>
      </div>
    </footer>
  );
}
