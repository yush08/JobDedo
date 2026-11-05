import "server-only";

import type { DiscoveryRun } from "@/types";
import type { DataStore } from "@/lib/db/types";
import type { DiscoveryConfig } from "./config";
import type { SourceAdapter } from "./types";
import { createAdapters, loadDiscoveryConfig } from "./config";

/**
 * Discovery run control (Milestone 2): validation, duplicate-run prevention
 * and run creation. Execution itself lives in `pipeline.ts` and is scheduled
 * *after* the HTTP response (Next `after()`), so a request never waits for a
 * full discovery run — which is also what a GitHub Actions scheduler needs.
 *
 * Duplicate-run prevention has two layers:
 *   1. an in-process claim (two requests in the same instance cannot race);
 *   2. a persisted `pending`/`running` row younger than `STALE_RUN_MS`
 *      (a run killed mid-flight is marked failed after 10 minutes instead of
 *      blocking discovery forever).
 * Without a shared lock table the two layers cannot coordinate across
 * separate serverless instances — documented in docs/discovery-sources.md.
 */

/** A run still marked pending/running after this long is considered crashed. */
export const STALE_RUN_MS = 10 * 60_000;

const CLAIM = "__claiming__";
let activeRunId: string | null = null;

/** Id of the run this process is executing (or the claim token), if any. */
export function getActiveRunId(): string | null {
  return activeRunId;
}

/** Claim the process. Returns false when a run is already in flight here. */
export function claimRun(): boolean {
  if (activeRunId !== null) return false;
  activeRunId = CLAIM;
  return true;
}

/** Attach the real run id once the row exists. */
export function assignRunId(runId: string): void {
  if (activeRunId === CLAIM) activeRunId = runId;
}

/** Release the process (always call this when a run finishes or fails). */
export function releaseRun(): void {
  activeRunId = null;
}

export interface StartDiscoveryRunInput {
  store: DataStore;
  trigger?: DiscoveryRun["trigger"];
  /** Restrict the run to these adapter keys (already validated by the route). */
  sources?: string[];
  config?: DiscoveryConfig;
  now?: () => Date;
}

export type StartDiscoveryRunOutcome =
  | {
      status: "started";
      run: DiscoveryRun;
      adapters: SourceAdapter[];
      config: DiscoveryConfig;
    }
  | { status: "conflict"; run: DiscoveryRun | null }
  | { status: "unavailable"; code: "NO_ADAPTERS" | "NO_TARGETS"; message: string };

/** The newest run that is still pending/running, if any. */
export async function findInFlightRun(store: DataStore): Promise<DiscoveryRun | null> {
  const runs = await store.listDiscoveryRuns(20);
  const cutoff = Date.now() - STALE_RUN_MS;
  const inFlight = runs.find(
    (run) => run.status === "pending" || run.status === "running",
  );
  if (!inFlight) return null;

  if (Date.parse(inFlight.started_at) <= cutoff) {
    // Crashed (serverless timeout, process kill): record the truth and unblock.
    await store.updateDiscoveryRun(inFlight.id, {
      status: "failed",
      error: "Run stopped without completing (no heartbeat for 10 minutes).",
      finished_at: new Date().toISOString(),
    });
    return null;
  }
  return inFlight;
}

/**
 * Validate + create a discovery run row. Never starts execution itself.
 * Returns why a run could not start instead of pretending one did.
 */
export async function startDiscoveryRun(
  input: StartDiscoveryRunInput,
): Promise<StartDiscoveryRunOutcome> {
  const config = input.config ?? loadDiscoveryConfig();
  const store = input.store;
  const now = input.now ?? (() => new Date());

  const configured = createAdapters(config);
  const adapters = input.sources?.length
    ? configured.filter((adapter) => input.sources!.includes(adapter.key))
    : configured;

  if (adapters.length === 0) {
    return {
      status: "unavailable",
      code: "NO_ADAPTERS",
      message:
        input.sources && input.sources.length > 0
          ? "None of the requested sources are enabled."
          : "No discovery sources are enabled. Set DISCOVERY_SOURCES_ENABLED (default: greenhouse,lever,ashby).",
    };
  }

  const runnable = adapters.filter((adapter) => adapter.enabled);
  if (runnable.length === 0) {
    return {
      status: "unavailable",
      code: "NO_TARGETS",
      message:
        "Enabled sources have no configured targets. Set DISCOVERY_GREENHOUSE_BOARDS, DISCOVERY_LEVER_POSTINGS and/or DISCOVERY_ASHBY_BOARDS.",
    };
  }

  if (!claimRun()) {
    const active = await store.getDiscoveryRun(getActiveRunId() ?? "");
    return { status: "conflict", run: active };
  }

  try {
    const inFlight = await findInFlightRun(store);
    // This caller owns the claim, but no run row was created — release before
    // returning, otherwise the process would stay locked on `__claiming__`
    // forever (the route only releases after a run it actually started).
    if (inFlight) {
      releaseRun();
      return { status: "conflict", run: inFlight };
    }

    const run = await store.createDiscoveryRun({
      profile_id: (await store.ensureProfile()).id,
      status: "pending",
      trigger: input.trigger ?? "manual",
      queries: runnable.flatMap((adapter) =>
        adapter.targets.map((target) => `${adapter.key}:${target}`),
      ),
      checkpoint: {
        phase: "queued",
        sources: [],
        queued_at: now().toISOString(),
      },
      pages_fetched: 0,
      found_count: 0,
      new_count: 0,
      duplicate_count: 0,
      error: "",
    });
    assignRunId(run.id);
    return { status: "started", run, adapters: runnable, config };
  } catch (error) {
    releaseRun();
    throw error;
  }
}
