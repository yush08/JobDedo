import "server-only";

import type { DataStore } from "@/lib/db/types";
import type { DiscoveryRun, ID, JobVerification } from "@/types";
import type { AdapterContext, FetchLike, JobDraft, SourceAdapter } from "./types";
import type { DiscoveryConfig } from "./config";
import type { ProfileBundle } from "@/lib/db";
import { defaultFetch } from "./adapters/http";
import { compositeDedupeKey, isSameVacancy, primaryDedupeKey } from "./dedupe";
import { runManualRecheck } from "@/features/verification/recheck";
import {
  computeConfidence,
  deriveVerificationStatus,
} from "@/features/verification/confidence";
import { computeMatch } from "@/features/matching/score";
import { getProfileBundle, toProfileData } from "@/lib/db";

/**
 * Discovery execution (Milestone 2).
 *
 * Pipeline: adapters → raw listing validation → normalisation → dedupe →
 * persistence → verification engine → matching engine → dashboard reads.
 *
 * Rules honoured here:
 * - the run is bounded (request budget, jobs-per-source, verify/match limits)
 *   and checkpoints after every source, so progress survives a killed process;
 * - one broken board/source never aborts the run: failures are recorded per
 *   source and the run finishes with whatever succeeded;
 * - ingestion is idempotent — re-running the same source updates rows instead
 *   of inserting duplicates, and never touches history fields;
 * - verification and matching reuse the existing engines untouched.
 */

export interface DiscoverySourceResult {
  source_key: string;
  name: string;
  status: "success" | "partial" | "failure";
  /** Configured targets for this source. */
  targets: number;
  /** Raw listings returned by the source. */
  fetched: number;
  /** Listings that passed validation + normalisation. */
  normalised: number;
  /** Listings rejected by validation (missing id/title/url, wrong shape…). */
  invalid: number;
  /** Rows inserted for the first time. */
  created: number;
  /** Existing rows updated with a fresh sighting. */
  merged: number;
  /** Listings skipped because they duplicated another listing in this run. */
  deduplicated: number;
  /** Rows that could not be persisted (recorded, run continues). */
  persist_errors: number;
  /** HTTP requests actually issued for this source. */
  requests: number;
  /** Source-level error (adapter crashed), empty when none. */
  error: string;
  failures: Array<{ target: string; error: string }> | undefined;
}

export interface DiscoveryRunSummary {
  run_id: ID;
  status: "completed" | "failed";
  sources: DiscoverySourceResult[];
  found: number;
  new: number;
  duplicate: number;
  invalid: number;
  verified: number;
  matched: number;
  requests: number;
  error: string;
}

export interface ExecuteDiscoveryRunOptions {
  runId: ID;
  store: DataStore;
  adapters: SourceAdapter[];
  config: DiscoveryConfig;
  /** Source fetch implementation (tests inject a fake; default = global fetch). */
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Profile used by the matching engine (tests inject their own store's). */
  resolveProfile?: () => Promise<ProfileBundle>;
}

/* ------------------------------------------------------------------ */
/* Execution                                                          */
/* ------------------------------------------------------------------ */

export async function executeDiscoveryRun(
  options: ExecuteDiscoveryRunOptions,
): Promise<DiscoveryRunSummary> {
  const { runId, store, adapters, config } = options;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const iso = () => now().toISOString();

  const summary: DiscoveryRunSummary = {
    run_id: runId,
    status: "failed",
    sources: [],
    found: 0,
    new: 0,
    duplicate: 0,
    invalid: 0,
    verified: 0,
    matched: 0,
    requests: 0,
    error: "",
  };

  const existing = await store.getDiscoveryRun(runId);
  if (!existing) {
    summary.error = `Discovery run ${runId} not found`;
    return summary;
  }

  const newJobIds = new Set<ID>();
  const touchedJobIds = new Set<ID>();
  const budget = { remaining: config.maxRequestsPerRun };
  const ctx: AdapterContext = { fetchImpl, timeoutMs: config.timeoutMs, budget };

  // Within-run dedupe structures (cheap keys first, similarity only inside a
  // company+location bucket so large runs stay linear-ish).
  const seenPrimary = new Set<string>();
  const seenCanonical = new Set<string>();
  const buckets = new Map<string, JobDraft[]>();

  const remember = (draft: JobDraft): boolean => {
    const primary = primaryDedupeKey(draft);
    const composite = compositeDedupeKey(draft);
    const bucket = buckets.get(composite);
    const duplicate =
      seenPrimary.has(primary) ||
      (draft.canonical_url !== "" && seenCanonical.has(draft.canonical_url)) ||
      (bucket !== undefined && bucket.some((other) => isSameVacancy(other, draft)));

    seenPrimary.add(primary);
    if (draft.canonical_url !== "") seenCanonical.add(draft.canonical_url);
    if (bucket) bucket.push(draft);
    else buckets.set(composite, [draft]);
    return duplicate;
  };

  const totals = () => ({
    // NB: the persisted run column is `found_count` — writing `found` here
    // silently passed the type checker (spread) but never updated the row.
    found_count: summary.found,
    new_count: summary.new,
    duplicate_count: summary.duplicate,
    pages_fetched: summary.requests,
  });

  const checkpoint = (phase: string, sources: DiscoverySourceResult[]) => ({
    phase,
    sources,
    verified: summary.verified,
    matched: summary.matched,
    requests: summary.requests,
    budget_remaining: budget.remaining,
    updated_at: iso(),
  });

  await store.updateDiscoveryRun(runId, {
    status: "running",
    checkpoint: checkpoint("fetching", []),
    ...totals(),
  });

  const runSource = async (adapter: SourceAdapter): Promise<DiscoverySourceResult> => {
    const result: DiscoverySourceResult = {
      source_key: adapter.key,
      name: adapter.name,
      status: "failure",
      targets: adapter.targets.length,
      fetched: 0,
      normalised: 0,
      invalid: 0,
      created: 0,
      merged: 0,
      deduplicated: 0,
      persist_errors: 0,
      requests: 0,
      failures: [],
      error: "",
    };

    let fetched;
    try {
      fetched = await adapter.fetchAll(ctx);
    } catch (error) {
      // An adapter must not throw, but if it does the run still continues.
      result.error = errorMessage(error);
      result.failures.push({ target: adapter.key, error: result.error });
      return finishSource(result);
    }

    result.requests = fetched.requests;
    result.failures = [...fetched.failures];
    result.fetched = fetched.listings.length;
    summary.requests += fetched.requests;
    summary.found += fetched.listings.length;

    const seen_at = iso();
    let processed = 0;

    for (const raw of fetched.listings) {
      if (processed >= config.maxJobsPerSource) {
        result.failures.push({
          target: adapter.key,
          error: `Stopped after ${config.maxJobsPerSource} listings (max jobs per source for this run)`,
        });
        break;
      }
      processed += 1;

      const normalised = adapter.normalise(raw);
      if (!normalised.ok) {
        result.invalid += 1;
        summary.invalid += 1;
        continue;
      }
      result.normalised += 1;
      const draft = normalised.draft;

      if (remember(draft)) {
        result.deduplicated += 1;
        summary.duplicate += 1;
        continue;
      }

      try {
        const { job, created } = await store.ingestJob(draft, {
          run_id: runId,
          seen_at,
          now: iso(),
        });
        touchedJobIds.add(job.id);
        newJobIds.add(job.id);
        if (created) {
          result.created += 1;
          summary.new += 1;
        } else {
          result.merged += 1;
          summary.duplicate += 1;
        }
      } catch (error) {
        // Never lose the whole run over one row; record it and continue.
        result.persist_errors += 1;
        result.failures.push({
          target: adapter.key,
          error: `Could not persist "${draft.title}": ${errorMessage(error)}`,
        });
      }
    }

    return finishSource(result);
  };

  const finishSource = (result: DiscoverySourceResult): DiscoverySourceResult => {
    const problems =
      result.failures.length > 0 || result.invalid > 0 || result.persist_errors > 0;
    if (result.error) result.status = "failure";
    else if (problems) result.status = result.fetched > 0 ? "partial" : "failure";
    else result.status = "success";
    return result;
  };

  try {
    const resultsArr = new Array<DiscoverySourceResult>(adapters.length);
    const completed = (): DiscoverySourceResult[] =>
      resultsArr.filter((r): r is DiscoverySourceResult => r !== undefined);

    const results = await mapWithConcurrency(
      adapters,
      config.concurrency,
      async (adapter, index) => {
        const result = await runSource(adapter);
        resultsArr[index] = result;
        // Persist progress after every source so a killed run still reports
        // exactly what it managed to do.
        await store.updateDiscoveryRun(runId, {
          checkpoint: checkpoint("fetching", completed()),
          ...totals(),
        });
        await store.updateSourceStatus(result.source_key, {
          enabled: true,
          last_run_at: iso(),
          last_status:
            result.status === "success"
              ? "success"
              : result.status === "partial"
                ? "partial"
                : "failure",
          last_message: sourceMessage(result),
        });
        return result;
      },
    );
    summary.sources = completed();

    const succeeded = results.filter((r) => r.status !== "failure");
    if (results.length === 0) {
      summary.error = "No discovery sources were configured for this run.";
      summary.status = "failed";
    } else if (succeeded.length === 0) {
      summary.error = `Every source failed: ${results
        .map((r) => `${r.name} (${r.failures[0]?.error ?? r.error ?? "unknown error"})`)
        .join("; ")}`;
      summary.status = "failed";
    } else {
      // Some sources succeeded — the run is completed and verification/matching
      // may proceed below.
      summary.status = "completed";
    }
    // Individual source failures are recorded in the run history; a run that
    // fetched some jobs from some sources is still valid (partial status).

    /* ---- verification engine (bounded, real HTTP probes) ---- */
    // Skip verification when all sources failed — there are no new jobs to verify.
    if (summary.status !== "failed") {
      await store.updateDiscoveryRun(runId, {
        checkpoint: checkpoint("verifying", [...summary.sources]),
        ...totals(),
      });
      summary.verified = await verifyNewJobs(
        [...touchedJobIds].slice(0, config.verifyLimit),
        store,
        iso,
      );
    }

    /* ---- matching engine (bounded) ---- */
    // Skip matching when all sources failed — there are no touched jobs to score.
    if (summary.status !== "failed") {
      await store.updateDiscoveryRun(runId, {
        checkpoint: checkpoint("matching", [...summary.sources]),
        ...totals(),
      });
      summary.matched = await scoreTouchedJobs(
        [...touchedJobIds].slice(0, config.matchLimit),
        store,
        options.resolveProfile ?? getProfileBundle,
      );
    }

    // summary.status is already set correctly above; do not unconditionally override.
  } catch (error) {
    summary.error = summary.error || errorMessage(error);
    summary.status = "failed";
  }

  const finishedAt = iso();
  await store.updateDiscoveryRun(runId, {
    status: summary.status,
    checkpoint: checkpoint(summary.status === "completed" ? "done" : "failed", [
      ...summary.sources,
    ]),
    ...totals(),
    error: summary.error,
    finished_at: finishedAt,
  });

  return summary;
}

/* ------------------------------------------------------------------ */
/* Post-ingest stages                                                  */
/* ------------------------------------------------------------------ */

/**
 * Reuse the existing manual recheck engine for the newest listings.
 * Every outcome — including "could not check" — is persisted exactly as the
 * verify route does it, so history is appended and never overwritten.
 */
async function verifyNewJobs(
  jobIds: ID[],
  store: DataStore,
  iso: () => string,
): Promise<number> {
  let verified = 0;
  for (const jobId of jobIds) {
    try {
      const job = await store.getJobFull(jobId);
      if (!job) continue;
      const current = await store.getVerification(jobId);
      const outcome = await runManualRecheck(job, current);
      const breakdown = computeConfidence(outcome.verification, {
        job_status: outcome.jobStatus,
      });
      const status = deriveVerificationStatus({
        jobStatus: outcome.jobStatus,
        deadlineStatus: outcome.verification.deadline_status,
        confidence: breakdown.total,
      });
      const verification: JobVerification = {
        ...outcome.verification,
        confidence_breakdown: breakdown,
        confidence_score: breakdown.total,
        job_status: outcome.jobStatus,
        updated_at: iso(),
      };
      await Promise.all([
        store.saveVerification(verification),
        store.appendVerificationHistory(outcome.history),
        store.updateJobVerificationFields(jobId, {
          verification_status: status,
          verification_confidence: breakdown.total,
          last_checked_at: verification.checked_at,
          last_verified_at: status === "VERIFIED" ? verification.checked_at : undefined,
          job_status: outcome.jobStatus,
        }),
      ]);
      verified += 1;
    } catch {
      // A failed probe must never abort the run — the listing stays persisted.
    }
  }
  return verified;
}

/** Score touched listings with the existing matching engine. */
async function scoreTouchedJobs(
  jobIds: ID[],
  store: DataStore,
  resolveProfile: () => Promise<ProfileBundle>,
): Promise<number> {
  if (jobIds.length === 0) return 0;
  let bundle: ProfileBundle;
  try {
    bundle = await resolveProfile();
  } catch {
    return 0; // No profile yet — dashboard computes scores on read instead.
  }
  const profile = toProfileData(bundle);
  let matched = 0;
  for (const jobId of jobIds) {
    try {
      const job = await store.getJobFull(jobId);
      if (!job) continue;
      const match = computeMatch(job, profile, bundle.preferences, bundle.roles);
      await store.upsertMatch({
        job_id: job.id,
        profile_id: bundle.profile.id,
        score: match.score,
        breakdown: match.breakdown,
        matched_skills: match.matched_skills,
        missing_skills: match.missing_skills,
        relevant_projects: match.relevant_projects,
        eligibility_warnings: match.eligibility_warnings,
        recommendations: match.recommendations,
      });
      matched += 1;
    } catch {
      // Scoring is best-effort; the listing itself is already persisted.
    }
  }
  return matched;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length || 1)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

function sourceMessage(result: DiscoverySourceResult): string {
  const parts = [
    `${result.fetched} listing${result.fetched === 1 ? "" : "s"}`,
    `${result.created} new`,
    `${result.merged + result.deduplicated} duplicate${result.merged + result.deduplicated === 1 ? "" : "s"}`,
  ];
  if (result.invalid > 0) parts.push(`${result.invalid} invalid`);
  if (result.persist_errors > 0) parts.push(`${result.persist_errors} not persisted`);
  const firstError = result.failures[0]?.error ?? result.error;
  if (firstError) parts.push(`first error: ${firstError}`);
  return `${parts.join(" · ")}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Re-exported so callers can type the run rows they read back. */
export type { DiscoveryRun };