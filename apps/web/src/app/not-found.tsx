import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "404 — Page Not Found | BugWatch",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-mesh">
      <div className="text-center max-w-md">
        <p className="font-display text-display-lg text-muted-foreground/40 tabular-nums mb-4">
          404
        </p>
        <h1 className="font-display text-heading-lg mb-3">Page not found</h1>
        <p className="text-body-sm text-muted-foreground mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/">
          <Button>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to home
          </Button>
        </Link>
      </div>
    </div>
  );
}
