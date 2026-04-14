"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Github, Star, X } from "lucide-react";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Lock body scroll when mobile menu is open; move focus into drawer for a11y
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      drawerRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Shared handler for both desktop and mobile Pricing anchors
  const scrollToPricing = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false);
    document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 liquid-glass transition-all duration-300">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-lg shadow-accent/25">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[18px] w-[18px]"
              aria-hidden="true"
            >
              <path d="M8 2v3" />
              <path d="M16 2v3" />
              <rect x="4" y="6" width="16" height="14" rx="5" />
              <path d="M4 13h16" />
              <path d="M2 15h2" />
              <path d="M20 15h2" />
              <path d="M2 10h2" />
              <path d="M20 10h2" />
            </svg>
          </span>
          <span className="font-display font-bold text-xl tracking-tight">BugWatch</span>
        </Link>

        <nav aria-label="Main" className="hidden md:flex items-center gap-6">
          <Link
            href="https://github.com/KCuppens/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-border-subtle text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-4 w-4" />
            <Star className="h-3 w-3" />
            <span>Star</span>
          </Link>
          <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Docs
          </Link>
          <a
            href="#pricing"
            onClick={scrollToPricing}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </a>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Login
          </Link>
          <Link
            href="/signup"
            className="bg-accent text-accent-foreground px-4 py-2 rounded-full text-sm font-medium hover:bg-accent/90 transition-all shadow-glow-blue-sm hover:shadow-glow-blue"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile menu button */}
        <button
          className="md:hidden p-2 bg-surface-2 border border-border-subtle rounded-lg"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Mobile menu backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile menu drawer */}
      <div
        ref={drawerRef}
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`fixed top-0 right-0 h-full w-72 bg-background border-l border-border-subtle z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <span className="font-bold text-lg">Menu</span>
          <button
            className="p-2 rounded-lg bg-surface-2 border border-border-subtle"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Mobile menu" className="flex flex-col p-4 gap-2">
          <Link
            href="https://github.com/KCuppens/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            <Github className="h-4 w-4" />
            <Star className="h-3 w-3" />
            <span>Star on GitHub</span>
          </Link>
          <Link
            href="/docs"
            className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Docs
          </Link>
          <a
            href="#pricing"
            onClick={scrollToPricing}
            className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
          >
            Pricing
          </a>
          <Link
            href="/login"
            className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="mt-2 bg-accent text-accent-foreground px-4 py-3 rounded-lg text-sm font-medium text-center hover:bg-accent/90 transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Get Started
          </Link>
        </nav>
      </div>
    </header>
  );
}
