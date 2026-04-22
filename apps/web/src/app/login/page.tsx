"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { Loader2, AlertCircle, Mail, Lock, Eye, EyeOff } from "lucide-react";

function AuthWatermark() {
  return (
    <div className="hidden md:flex flex-1 bg-[hsl(var(--background))] items-center justify-center relative overflow-hidden border-r border-[hsl(var(--border-subtle))]">
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
      >
        <span
          className="font-mono font-bold text-[hsl(var(--accent))] tracking-widest"
          style={{
            fontSize: "clamp(2.5rem, 9vh, 5.5rem)",
            opacity: 0.07,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            letterSpacing: "0.2em",
          }}
        >
          BUGWATCH
        </span>
      </div>
      <div className="relative z-10 text-center px-12">
        <Link href="/" className="inline-flex items-center gap-2 mb-8">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
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
          <span className="font-sans font-bold text-xl tracking-tight text-[hsl(var(--foreground))]">BugWatch</span>
        </Link>
        <p className="font-mono text-sm text-[hsl(var(--muted-foreground))] leading-relaxed max-w-xs">
          Open-source error tracking.
          <br />
          Flat pricing. No surprises.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(email, password);
      const next = searchParams.get("next") ?? "";
      const SAFE_PATH_RE = /^\/[a-zA-Z0-9_\-./]*$/
      const destination = next && SAFE_PATH_RE.test(next) ? next : "/dashboard";
      router.push(destination);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-[hsl(var(--background))]">
      <AuthWatermark />

      {/* Right: Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-[hsl(var(--surface-1))]">
        <div className="w-full max-w-[400px] space-y-8">
          {/* Mobile logo */}
          <Link href="/" className="md:hidden inline-flex items-center gap-2 mb-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
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
            <span className="font-sans font-bold text-xl tracking-tight text-[hsl(var(--foreground))]">BugWatch</span>
          </Link>

          <div>
            <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">Welcome back</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Sign in to continue to your dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                role="alert"
                aria-live="polite"
                aria-atomic="true"
                className="flex items-start gap-3 p-4 text-sm rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <span className="text-red-300">{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-[hsl(var(--foreground))]">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={isLoading}
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-[hsl(var(--surface-3))] border border-[hsl(var(--border-subtle))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]/50 focus:border-[hsl(var(--accent))]/50 transition-all disabled:opacity-50 text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-[hsl(var(--accent))] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isLoading}
                  className="w-full h-11 pl-10 pr-10 rounded-lg bg-[hsl(var(--surface-3))] border border-[hsl(var(--border-subtle))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]/50 focus:border-[hsl(var(--accent))]/50 transition-all disabled:opacity-50 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-sans font-semibold text-sm hover:bg-[hsl(var(--accent-2))] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-[hsl(var(--accent))] hover:underline">
              Sign up for free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
