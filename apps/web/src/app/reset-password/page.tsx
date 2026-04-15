"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { toast } from "sonner";

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
            fontSize: "clamp(5rem, 14vw, 11rem)",
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

const inputClass =
  "w-full h-11 px-3 rounded-lg bg-[hsl(var(--surface-3))] border border-[hsl(var(--border-subtle))] text-[hsl(var(--foreground))] text-sm placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]/50 focus:border-[hsl(var(--accent))]/50 transition-all";

function friendlyResetError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 401 || err.status === 410) {
      return "This reset link is invalid or has expired. Please request a new one.";
    }
    return err.message;
  }
  return "Failed to reset password. The link may have expired.";
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!token) setError("Invalid or missing reset token. Please request a new link.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      if (!mountedRef.current) return;
      setDone(true);
      toast.success("Password reset! Redirecting to login…");
      // router.replace removes the token URL from history
      redirectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) router.replace("/login");
      }, 3000);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(friendlyResetError(err));
    } finally {
      if (mountedRef.current) setLoading(false);
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
            <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">Choose a new password</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {done ? "All done!" : "Must be at least 8 characters"}
            </p>
          </div>

          {done ? (
            <div
              role="status"
              aria-live="polite"
              className="surface-card p-6 rounded-lg flex flex-col items-center gap-4"
            >
              <CheckCircle className="h-12 w-12 text-green-400" aria-hidden="true" />
              <p className="text-sm text-center text-[hsl(var(--muted-foreground))]">
                Your password has been reset. Redirecting to login…
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {error && (
                <div
                  className="flex items-start gap-3 p-4 text-sm rounded-lg bg-red-500/10 border border-red-500/20"
                  role="alert"
                >
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="text-red-300">{error}</span>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-sm font-medium text-[hsl(var(--foreground))]">
                    New password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="confirm" className="text-sm font-medium text-[hsl(var(--foreground))]">
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your new password"
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !token || !password || !confirm}
                  className="w-full h-12 rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-sans font-semibold hover:bg-[hsl(var(--accent-2))] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loading ? "Resetting…" : "Reset password"}
                </button>
              </form>

              <Link
                href="/login"
                className="flex items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
