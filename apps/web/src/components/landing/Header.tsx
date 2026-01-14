import Link from "next/link";
import { Github, Star } from "lucide-react";

export function Header() {
  return (
    <header className="glass border-b border-white/10 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐛</span>
          <span className="font-bold text-xl">BugWatch</span>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="https://github.com/bugwatch/bugwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-4 w-4" />
            <Star className="h-3 w-3" />
            <span>Star</span>
          </Link>
          <Link
            href="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </Link>
          <Link
            href="#pricing"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="bg-accent text-accent-foreground px-4 py-2 rounded-full text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile menu button */}
        <button className="md:hidden p-2 glass rounded-lg">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  );
}
