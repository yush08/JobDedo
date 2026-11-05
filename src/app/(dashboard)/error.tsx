"use client";

import Link from "next/link";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Route-group error boundary (Next 16: receives `error` + `retry`).
 * Shows an honest failure state with recovery actions — never a fake retry
 * that pretends to work.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">
        Something went wrong loading this page
      </h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RefreshCw aria-hidden />
          Try again
        </Button>
        <Link href="/overview">
          <Button variant="outline">
            <Home aria-hidden />
            Back to Overview
          </Button>
        </Link>
      </div>
    </div>
  );
}
