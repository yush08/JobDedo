"use client";

import { RefreshCw, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDiscoveryRunner } from "@/components/discovery/use-discovery-runner";

interface Props {
  /** True when at least one configured source can run right now. */
  adaptersReady?: boolean;
  size?: "sm" | "default";
}

/**
 * Manual discovery refresh (also the retry path after a failed run).
 *
 * It never pretends a background job is running: the server either accepts a
 * run — and the button then tracks the persisted run until it finishes — or it
 * explains why nothing was started, and the UI relays that verbatim.
 */
export function RefreshJobsButton({ adaptersReady = true, size = "sm" }: Props) {
  const { start, busy } = useDiscoveryRunner();

  return (
    <Button
      variant="outline"
      size={size}
      onClick={() => void start()}
      disabled={busy}
      title={
        adaptersReady
          ? "Fetch fresh listings from the configured sources"
          : "No discovery source is configured yet"
      }
      aria-label="Refresh discovered jobs"
    >
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw aria-hidden />
      )}
      {busy ? "Discovering…" : "Refresh jobs"}
    </Button>
  );
}
