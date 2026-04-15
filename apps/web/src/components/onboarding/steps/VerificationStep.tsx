"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { CodeBlock } from "../CodeBlock";
import { getSDKContent, interpolateApiKey } from "@/lib/sdk-config";
import { projectsApi } from "@/lib/api";
import type { Platform, Framework } from "@/lib/api";

interface VerificationStepProps {
  projectId: string;
  platform: Platform;
  framework: Framework;
  apiKey: string;
  onComplete: () => void;
  onBack: () => void;
  backDisabled?: boolean;
}

type VerificationStatus = "idle" | "checking" | "success" | "timeout";

export function VerificationStep({
  projectId,
  platform,
  framework,
  apiKey,
  onComplete,
  onBack,
  backDisabled,
}: VerificationStepProps) {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [eventCount, setEventCount] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mountedRef = useRef(true);

  const sdkContent = getSDKContent(platform, framework);

  // Canvas confetti — fires once when status transitions to "success"
  useEffect(() => {
    if (status !== "success") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      rotation: number;
      rotationSpeed: number;
    };

    const colors = ["#2ed573", "#F0F4F8", "#60A5FA", "#F97316", "#EF4444", "#A78BFA"];
    const particles: Particle[] = Array.from({ length: 120 }, () => ({
      x: canvas.width / 2,
      y: canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.9) * 14,
      color: colors[Math.floor(Math.random() * colors.length)] ?? "#2ed573",
      size: Math.random() * 7 + 3,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.25,
    }));

    let startTime: number | null = null;
    const duration = 1500;
    let animFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }

      if (elapsed < duration) {
        animFrame = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    animFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrame);
  }, [status]);

  const checkForEvents = useCallback(async () => {
    try {
      const response = await projectsApi.verifyEvents(projectId);
      if (response.data.status === "success" && response.data.event_count > 0) {
        setEventCount(response.data.event_count);
        setStatus("success");
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error checking for events:", error);
      return false;
    }
  }, [projectId]);

  const startVerification = useCallback(async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setStatus("checking");
    setPollCount(0);

    const immediate = await checkForEvents();
    if (immediate) return;

    let attempts = 0;
    const maxAttempts = 60;

    pollIntervalRef.current = setInterval(async () => {
      attempts++;
      if (!mountedRef.current) return;
      setPollCount(attempts);

      const found = await checkForEvents();
      if (!mountedRef.current) return; // component unmounted during await
      if (found || attempts >= maxAttempts) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (!found) setStatus("timeout");
      }
    }, 2000);
  }, [checkForEvents]);

  useEffect(() => {
    mountedRef.current = true;
    startVerification();
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [startVerification]);

  const handleSkip = async () => {
    try {
      await projectsApi.completeOnboarding(projectId);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      toast.error("Could not save onboarding progress — you can finish setup from Settings.");
    }
    onComplete();
  };

  const handleFinish = async () => {
    try {
      await projectsApi.completeOnboarding(projectId);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      toast.error("Could not save onboarding progress — you can finish setup from Settings.");
    }
    onComplete();
  };

  if (status === "success") {
    return (
      <div className="space-y-8">
        {/* Canvas confetti overlay */}
        <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-50" aria-hidden="true" />

        <div className="flex flex-col items-center justify-center space-y-6 py-12">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--accent))]/10 border border-[hsl(var(--accent))]/30">
            <Check className="h-10 w-10 text-[hsl(var(--accent))]" />
          </div>
          <div className="text-center space-y-3">
            <h2 className="font-sans text-3xl font-bold text-[hsl(var(--foreground))]">You&apos;re live.</h2>
            <p className="text-[hsl(var(--muted-foreground))] max-w-md">
              We received {eventCount} event{eventCount > 1 ? "s" : ""} from your application. BugWatch is now
              monitoring your project for errors.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--accent))]">
            <Check className="h-4 w-4" />
            Integration verified successfully
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <Button
            onClick={handleFinish}
            size="lg"
            className="px-8 bg-[#2ed573] text-[#080B10] hover:bg-[#1a9e52] font-sans font-semibold border-0"
          >
            Go to Dashboard →
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="font-sans text-2xl font-bold">Verify Your Installation</h2>
        <p className="text-[hsl(var(--muted-foreground))]">Send a test error to confirm everything is working</p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Status indicator */}
        <div className="flex flex-col items-center justify-center space-y-4 py-8 rounded-lg border bg-[hsl(var(--surface-2))]">
          {status === "checking" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-[hsl(var(--accent))]" />
              <div className="text-center">
                <p className="font-medium">Listening for events...</p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Waiting for your first error ({pollCount * 2}s)
                </p>
                {pollCount * 2 >= 60 && (
                  <a
                    href={sdkContent?.docsUrl || "/docs"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[hsl(var(--accent))] hover:underline mt-2 inline-flex items-center gap-1"
                  >
                    Still waiting? Check the installation guide
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </>
          )}
          {status === "timeout" && (
            <>
              <AlertCircle className="h-12 w-12 text-amber-500" />
              <div className="text-center">
                <p className="font-medium">No events received yet</p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Make sure you&apos;ve sent a test error from your application
                </p>
              </div>
              <Button variant="outline" onClick={() => startVerification()}>
                Try Again
              </Button>
            </>
          )}
          {status === "idle" && (
            <>
              <div className="h-12 w-12 rounded-full border-4 border-[hsl(var(--border))]" />
              <p className="text-[hsl(var(--muted-foreground))]">Ready to verify</p>
            </>
          )}
        </div>

        {/* Test code */}
        {sdkContent && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Send a Test Error</h3>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Run this code in your application</span>
            </div>
            <CodeBlock
              code={interpolateApiKey(sdkContent.verificationCode, apiKey)}
              language={platform === "python" ? "python" : platform === "rust" ? "rust" : "javascript"}
            />
          </div>
        )}

        {/* Help link */}
        <div className="flex items-center justify-center gap-2 pt-4">
          <a
            href={sdkContent?.docsUrl || "/docs"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors inline-flex items-center gap-1"
          >
            Having trouble? View troubleshooting guide
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <div className="relative group">
          <Button variant="ghost" onClick={onBack} disabled={backDisabled}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {backDisabled && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground border shadow-sm">
              Project already created
            </span>
          )}
        </div>
        <Button variant="outline" onClick={handleSkip}>
          Skip & Finish Later
        </Button>
      </div>
    </div>
  );
}
