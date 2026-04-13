import Link from "next/link";
import { Github } from "lucide-react";
import { FadeUp } from "./motion";

const footerLinks = {
  Product: [
    { name: "Features", href: "/#features" },
    { name: "Pricing", href: "/#pricing" },
    { name: "Changelog", href: "https://github.com/KCuppens/bugwatch/releases" },
    { name: "Roadmap", href: "https://github.com/KCuppens/bugwatch/projects" },
  ],
  Resources: [
    { name: "Documentation", href: "/docs" },
    { name: "API Reference", href: "/docs/api-reference" },
    { name: "SDKs", href: "/docs/sdks" },
    { name: "Self-Hosting", href: "/docs/self-hosting" },
  ],
  Company: [
    { name: "Status", href: "https://status.bugwatch.dev" },
    { name: "Contact", href: "mailto:support@bugwatch.dev" },
  ],
  Legal: [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "License (MIT)", href: "https://github.com/KCuppens/bugwatch/blob/main/LICENSE" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="container mx-auto px-4 py-16">
        <FadeUp>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm shadow-accent/25">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                  <path d="M8 2v3" />
                  <path d="M16 2v3" />
                  <rect x="4" y="6" width="16" height="14" rx="5" />
                  <path d="M4 13h16" />
                </svg>
              </span>
              <span className="font-display font-bold text-xl tracking-tight">BugWatch</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Open source error tracking for modern teams.
            </p>
            <div className="flex gap-3">
              <Link
                href="https://github.com/KCuppens/bugwatch"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-surface-2 border border-border-subtle hover:bg-surface-3 transition-colors text-muted-foreground hover:text-foreground"
              >
                <Github className="h-5 w-5" />
              </Link>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="font-semibold mb-4">{category}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        </FadeUp>

        <div className="mt-12 pt-8 border-t border-border-subtle text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} BugWatch. Open source under MIT license.</p>
        </div>
      </div>
    </footer>
  );
}
