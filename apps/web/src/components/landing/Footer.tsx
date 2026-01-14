import Link from "next/link";
import { Github, Twitter } from "lucide-react";

const footerLinks = {
  Product: [
    { name: "Features", href: "/#features" },
    { name: "Pricing", href: "/#pricing" },
    { name: "Changelog", href: "/changelog" },
    { name: "Roadmap", href: "https://github.com/bugwatch/bugwatch/projects" },
  ],
  Resources: [
    { name: "Documentation", href: "/docs" },
    { name: "API Reference", href: "/docs/api" },
    { name: "SDKs", href: "/docs/sdks" },
    { name: "Self-Hosting", href: "/docs/self-hosting" },
  ],
  Company: [
    { name: "About", href: "/about" },
    { name: "Blog", href: "/blog" },
    { name: "Status", href: "https://status.bugwatch.dev" },
    { name: "Contact", href: "/contact" },
  ],
  Legal: [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "License (MIT)", href: "https://github.com/bugwatch/bugwatch/blob/main/LICENSE" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🐛</span>
              <span className="font-bold text-xl">BugWatch</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Open source error tracking for modern teams.
            </p>
            <div className="flex gap-3">
              <Link
                href="https://github.com/bugwatch/bugwatch"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full glass hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
              >
                <Github className="h-5 w-5" />
              </Link>
              <Link
                href="https://twitter.com/bugwatch"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full glass hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
              >
                <Twitter className="h-5 w-5" />
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

        <div className="mt-12 pt-8 border-t border-white/10 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} BugWatch. Open source under MIT license.</p>
        </div>
      </div>
    </footer>
  );
}
