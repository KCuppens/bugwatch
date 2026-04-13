"use client";

import Link from "next/link";
import { ArrowLeft, AlertCircle, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gradient-mesh">
      <div className="relative w-full max-w-[420px] space-y-8">
        {/* Logo & Header */}
        <div className="text-center space-y-3">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-lg shadow-accent/25 group-hover:scale-105 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                <path d="M8 2v3" />
                <path d="M16 2v3" />
                <rect x="4" y="6" width="16" height="14" rx="5" />
                <path d="M4 13h16" />
              </svg>
            </span>
            <span className="font-display font-bold text-2xl tracking-tight">BugWatch</span>
          </Link>
          <div>
            <h1 className="font-display text-heading-lg">
              Reset your password
            </h1>
            <p className="text-body-sm text-muted-foreground mt-1">
              Password reset is not currently available
            </p>
          </div>
        </div>

        {/* Auth Card */}
        <div className="glass-card rounded-xl p-8 space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 text-sm rounded-lg bg-blue-500/10 border border-blue-500/20">
            <AlertCircle className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
            <span className="text-blue-200">
              Password reset is not yet available. Please contact support if you need to reset your password.
            </span>
          </div>

          <a
            href="mailto:support@bugwatch.dev"
            className="w-full h-12 rounded-lg bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
          >
            <Mail className="h-5 w-5" />
            Contact Support
          </a>
        </div>

        {/* Footer */}
        <Link
          href="/login"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
