"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { Loader2, AlertCircle, Check, Mail, Lock, User, Eye, EyeOff } from "lucide-react";

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

function getPasswordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 2) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 4) return { score, label: "Medium", color: "bg-orange-500" };
  return { score, label: "Strong", color: "bg-emerald-500" };
}

// Loose RFC-5322-style sanity check: catches obvious mistakes (no @, no dot in
// domain). We rely on the server for authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const inputClass =
  "w-full h-11 pl-10 pr-4 rounded-lg bg-[hsl(var(--surface-3))] border border-[hsl(var(--border-subtle))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]/50 focus:border-[hsl(var(--accent))]/50 transition-all disabled:opacity-50 text-sm aria-[invalid=true]:border-red-500/60 aria-[invalid=true]:focus:ring-red-500/50";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Tracks fields the user has interacted with, so we don't flash red errors
  // before they've had a chance to type.
  const [touched, setTouched] = useState({
    email: false,
    password: false,
    confirmPassword: false,
  });

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Browser password managers and Chrome autofill can populate inputs BEFORE
  // React hydrates. The DOM shows the value but React state stays empty, so
  // controlled-input validation gets stuck on "Enter your email…". After
  // hydration we read the actual DOM values back into state.
  useEffect(() => {
    const sync = () => {
      if (nameRef.current?.value) setName((v) => v || nameRef.current!.value);
      if (emailRef.current?.value) setEmail((v) => v || emailRef.current!.value);
      if (passwordRef.current?.value) setPassword((v) => v || passwordRef.current!.value);
      if (confirmRef.current?.value)
        setConfirmPassword((v) => v || confirmRef.current!.value);
    };
    sync();
    // Some browsers (Safari, Firefox) fire autofill slightly after mount.
    const t = setTimeout(sync, 250);
    return () => clearTimeout(t);
  }, []);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const isEmailValid = EMAIL_RE.test(email);
  const isPasswordValid =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword;
  const formValid =
    isEmailValid && isPasswordValid && confirmPassword.length > 0 && passwordsMatch;

  const disabledReason = !email
    ? "Enter your email to continue."
    : !isEmailValid
      ? "Enter a valid email address."
      : !password
        ? "Choose a password to continue."
        : password.length < 8
          ? `Password must be at least 8 characters (${password.length}/8).`
          : !isPasswordValid
            ? "Password needs uppercase, lowercase, and a number."
            : !confirmPassword
              ? "Confirm your password to continue."
              : !passwordsMatch
                ? "Passwords do not match."
                : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    // Force-touch all so any remaining inline errors show up if the user
    // submits via Enter without ever blurring a field.
    setTouched({ email: true, password: true, confirmPassword: true });

    if (!formValid) return;

    setIsLoading(true);
    try {
      await signup(email, password, name || undefined);
      router.push("/welcome");
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
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-[hsl(var(--surface-1))] overflow-y-auto">
        <div className="w-full max-w-[400px] space-y-6">
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
            <h1 className="font-sans text-2xl font-bold text-[hsl(var(--foreground))]">Create your account</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Start tracking errors in minutes</p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 p-4 text-sm rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <span className="text-red-300">{error}</span>
              </div>
            )}

            {/* Name (optional) */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium text-[hsl(var(--foreground))]">
                Name <span className="text-[hsl(var(--muted-foreground))] font-normal">(optional)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <input
                  ref={nameRef}
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                  disabled={isLoading}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-[hsl(var(--foreground))]">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <input
                  ref={emailRef}
                  id="email"
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  required
                  autoComplete="email"
                  disabled={isLoading}
                  aria-invalid={touched.email && !!email && !isEmailValid}
                  aria-describedby="email-hint"
                  className={inputClass}
                />
              </div>
              {touched.email && !!email && !isEmailValid && (
                <p id="email-hint" className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Enter a valid email address.
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-[hsl(var(--foreground))]">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  required
                  autoComplete="new-password"
                  disabled={isLoading}
                  aria-invalid={touched.password && !!password && !isPasswordValid}
                  aria-describedby="password-hint"
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div id="password-hint" aria-live="polite" aria-atomic="true">
                {password ? (
                  <div className="space-y-1.5 pt-1">
                    <div
                      className="flex gap-1"
                      role="img"
                      aria-label={`Password strength: ${passwordStrength.label}`}
                    >
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= passwordStrength.score ? passwordStrength.color : "bg-[hsl(var(--surface-3))]"
                          }`}
                        />
                      ))}
                    </div>
                    {isPasswordValid ? (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        Password strength:{" "}
                        <span className="font-medium text-[hsl(var(--foreground))]">{passwordStrength.label}</span>
                      </p>
                    ) : password.length > 0 && password.length < 8 ? (
                      <p className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Password must be at least 8 characters ({password.length}/8).
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Needs uppercase, lowercase, and a number.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] pt-1">8+ characters, uppercase, lowercase, and a number.</p>
                )}
              </div>
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-[hsl(var(--foreground))]">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <input
                  ref={confirmRef}
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
                  required
                  autoComplete="new-password"
                  disabled={isLoading}
                  aria-invalid={touched.confirmPassword && !!confirmPassword && !passwordsMatch}
                  aria-describedby="confirm-password-hint"
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div
                id="confirm-password-hint"
                aria-live="polite"
                className="flex items-center gap-1.5 text-xs mt-1"
              >
                {!confirmPassword ? (
                  <span className="text-[hsl(var(--muted-foreground))]">Re-enter your password to confirm.</span>
                ) : passwordsMatch ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[hsl(var(--accent))]" />
                    <span className="text-[hsl(var(--accent))]">Passwords match</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                    <span className="text-red-400">Passwords do not match</span>
                  </>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !formValid}
              className="w-full h-11 rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-sans font-semibold text-sm hover:bg-[hsl(var(--accent-2))] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Creating account...
                </>
              ) : (
                "Create account"
              )}
            </button>
            {disabledReason && !isLoading && (
              <p
                role="status"
                aria-live="polite"
                className="flex items-center justify-center gap-1.5 text-sm font-medium text-amber-300"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {disabledReason}
              </p>
            )}
          </form>

          <p className="text-xs text-center text-[hsl(var(--muted-foreground))]">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="text-[hsl(var(--accent))] hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-[hsl(var(--accent))] hover:underline">
              Privacy Policy
            </Link>
          </p>

          <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[hsl(var(--accent))] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
