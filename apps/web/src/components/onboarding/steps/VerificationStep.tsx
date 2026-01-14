"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  PartyPopper,
} from "lucide-react";
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
}

type VerificationStatus = "idle" | "checking" | "success" | "timeout";

export function VerificationStep({
  projectId,
  platform,
  framework,
  apiKey,
  onComplete,
  onBack,
}: VerificationStepProps) {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [eventCount, setEventCount] = useState(0);
  const [pollCount, setPollCount] = useState(0);

  const sdkContent = getSDKContent(platform, framework);

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
    setStatus("checking");
    setPollCount(0);

    // Check immediately first
    const immediate = await checkForEvents();
    if (immediate) return;

    // Poll every 2 seconds for up to 60 seconds (30 attempts)
    const maxAttempts = 30;
    let attempts = 0;

    const pollInterval = setInterval(async () => {
      attempts++;
      setPollCount(attempts);

      const found = await checkForEvents();
      if (found) {
        clearInterval(pollInterval);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        setStatus("timeout");
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [checkForEvents]);

  // Auto-start verification on mount
  useEffect(() => {
    startVerification();
  }, [startVerification]);

  const handleSkip = async () => {
    try {
      await projectsApi.completeOnboarding(projectId);
      onComplete();
    } catch (error) {
      console.error("Error completing onboarding:", error);
      onComplete();
    }
  };

  const handleFinish = async () => {
    try {
      await projectsApi.completeOnboarding(projectId);
      onComplete();
    } catch (error) {
      console.error("Error completing onboarding:", error);
      onComplete();
    }
  };

  if (status === "success") {
    return (
      <div className="space-y-8">
        <div className="flex flex-col items-center justify-center space-y-4 py-12">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <PartyPopper className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold">You&apos;re All Set!</h2>
            <p className="text-muted-foreground max-w-md">
              We received {eventCount} event{eventCount > 1 ? "s" : ""} from your
              application. Bugwatch is now monitoring your project for errors.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="h-4 w-4" />
            Integration verified successfully
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <Button onClick={handleFinish} size="lg" className="px-8">
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Verify Your Installation</h2>
        <p className="text-muted-foreground">
          Send a test error to confirm everything is working
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Status indicator */}
        <div className="flex flex-col items-center justify-center space-y-4 py-8 rounded-lg border bg-muted/30">
          {status === "checking" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">Listening for events...</p>
                <p className="text-sm text-muted-foreground">
                  Waiting for your first error ({pollCount * 2}s)
                </p>
              </div>
            </>
          )}
          {status === "timeout" && (
            <>
              <AlertCircle className="h-12 w-12 text-amber-500" />
              <div className="text-center">
                <p className="font-medium">No events received yet</p>
                <p className="text-sm text-muted-foreground">
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
              <div className="h-12 w-12 rounded-full border-4 border-muted" />
              <p className="text-muted-foreground">Ready to verify</p>
            </>
          )}
        </div>

        {/* Test code */}
        {sdkContent && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Send a Test Error</h3>
              <span className="text-xs text-muted-foreground">
                Run this code in your application
              </span>
            </div>
            <CodeBlock
              code={interpolateApiKey(sdkContent.verificationCode, apiKey)}
              language={
                platform === "python"
                  ? "python"
                  : platform === "rust"
                    ? "rust"
                    : "javascript"
              }
            />
          </div>
        )}

        {/* Help link */}
        <div className="flex items-center justify-center gap-2 pt-4">
          <a
            href={sdkContent?.docsUrl || "https://docs.bugwatch.dev"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            Having trouble? View troubleshooting guide
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button variant="outline" onClick={handleSkip}>
          Skip & Finish Later
        </Button>
      </div>
    </div>
  );
}
