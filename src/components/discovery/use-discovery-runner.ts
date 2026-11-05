"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { ApiErrorBody, DiscoveryRun } from "@/types";

/**
 * Client-side discovery runner: starts a run, then polls the persisted run
 * history until the run reaches a terminal state.
 *
 * The server returns immediately (the work happens in Next `after()`), so the
 * UI never assumes a run is progressing just because a request was accepted —
 * every number it shows comes back from the persisted `discovery_runs` rows.
 *
 * One poll loop drives everything: it runs while a run is active (started
 * here, on another page, or in another tab) and stops as soon as the server
 * reports nothing in flight.
 */

export interface RunSourceResult {
  source_key: string;
  name: string;
  status: "success" | "partial" | "failure";
  targets: number;
  fetched: number;
  normalised: number;
  invalid: number;
  created: number;
  merged: number;
  deduplicated: number;
  persist_errors: number;
  requests: number;
  failures: { target: string; error: string }[];
  error: string;
}

interface StatusPayload {
  latest_run: DiscoveryRun | null;
  has_run: boolean;
  active: boolean;
  recent_runs: DiscoveryRun[];
}

/** Per-source results persisted in `run.checkpoint.sources`. */
export function readRunSources(run: DiscoveryRun | null): RunSourceResult[] {
  const sources = run?.checkpoint?.sources;
  return Array.isArray(sources) ? (sources as RunSourceResult[]) : [];
}

/** Pipeline phase persisted in `run.checkpoint.phase`. */
export function readRunPhase(run: DiscoveryRun | null): string {
  const phase = run?.checkpoint?.phase;
  return typeof phase === "string" ? phase : "";
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 750;
const MAX_POLLS = 160; // ~2 minutes; longer runs are reported as "check again"

/** Several components can mount the runner; each run is announced only once. */
const notifiedRuns = new Set<string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifySettled(run: DiscoveryRun) {
  if (notifiedRuns.has(run.id)) return;
  notifiedRuns.add(run.id);
  const failed = readRunSources(run).filter((s) => s.status !== "success");

  if (run.status === "completed") {
    toast.success("Discovery finished", {
      description: `${run.new_count} new of ${run.found_count} found${
        run.duplicate_count > 0 ? ` · ${run.duplicate_count} duplicates` : ""
      }.`,
    });
    if (failed.length > 0) {
      toast.warning(`${failed.length} source${failed.length === 1 ? "" : "s"} did not finish`, {
        description: failed
          .map((s) => `${s.name}: ${s.failures[0]?.error ?? s.error ?? "unknown error"}`)
          .join(" · ")
          .slice(0, 400),
        duration: 9000,
      });
    }
    return;
  }

  toast.error(run.status === "cancelled" ? "Discovery cancelled" : "Discovery failed", {
    description: (run.error || "The run stopped before it finished.").slice(0, 400),
    duration: 9000,
  });
}

export interface DiscoveryRunnerState {
  /** True between "POST accepted" and "run reached a terminal state". */
  busy: boolean;
  run: DiscoveryRun | null;
  runs: DiscoveryRun[];
  active: boolean;
}

export function useDiscoveryRunner(initial?: {
  run?: DiscoveryRun | null;
  runs?: DiscoveryRun[];
  active?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<DiscoveryRunnerState>({
    busy: false,
    run: initial?.run ?? null,
    runs: initial?.runs ?? [],
    // Server-known activity is adopted once, at mount (the useState
    // initializer). While mounted, later prop changes are picked up by the
    // poll loop below — state is never synchronously set inside an effect.
    active: initial?.active ?? false,
  });
  const serverActive = initial?.active ?? false;

  const start = useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const res = await fetch("/api/v1/discovery/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = (await res.json()) as
        | { ok: true; data: { run: DiscoveryRun } }
        | ApiErrorBody;

      if (res.status === 409) {
        const details = "error" in json ? json.error.details : null;
        const run =
          details && typeof details === "object" && "run" in details
            ? ((details as { run?: DiscoveryRun | null }).run ?? null)
            : null;
        toast.info("Discovery already running", {
          description: run
            ? `Tracking run ${run.id.slice(0, 8)}…`
            : "Waiting for it to finish…",
        });
        setState((s) => ({ ...s, busy: true, active: true, run: run ?? s.run }));
        return;
      }

      if (!res.ok || !("ok" in json)) {
        const message =
          "error" in json ? json.error.message : "Discovery could not be started.";
        setState((s) => ({ ...s, busy: false }));
        toast.error("No run started", { description: message, duration: 8000 });
        return;
      }

      const run = json.data.run;
      toast.success("Discovery run started", {
        description: `Run ${run.id.slice(0, 8)} · tracking progress…`,
      });
      setState((s) => ({ ...s, busy: true, active: true, run }));
      // Re-render the server components so sibling panels see the new run too.
      router.refresh();
    } catch (error) {
      setState((s) => ({ ...s, busy: false }));
      toast.error("Could not reach the discovery endpoint.", {
        description: errorMessage(error),
      });
    }
  }, [router]);

  // Single poll loop: runs while something is in flight, then stops.
  // It also arms when the *server* reports an active run (started on another
  // page or tab) even though this instance's local state is still idle.
  useEffect(() => {
    if (!state.active && !state.busy && !serverActive) return;
    let cancelled = false;

    const loop = async () => {
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        await sleep(POLL_MS);
        if (cancelled) return;

        let data: StatusPayload | null = null;
        try {
          const res = await fetch("/api/v1/discovery/status", { cache: "no-store" });
          if (res.ok) data = ((await res.json()) as { data: StatusPayload }).data;
        } catch {
          // Transient network error: the run itself is safe on the server.
        }
        if (!data || cancelled) continue;

        const settled = !data.active;
        setState({
          busy: !settled,
          run: data.latest_run,
          runs: data.recent_runs,
          active: data.active,
        });

        if (settled) {
          if (data.latest_run && TERMINAL.has(data.latest_run.status)) {
            notifySettled(data.latest_run);
          }
          router.refresh();
          return;
        }
      }

      if (cancelled) return;
      setState((s) => ({ ...s, busy: false, active: false }));
      toast.message("Discovery is still running.", {
        description: "Refresh the page in a moment to see its progress.",
      });
      router.refresh();
    };

    void loop();
    return () => {
      cancelled = true;
    };
  }, [state.active, state.busy, serverActive, router]);

  return { ...state, start };
}
