import type { SourceAdapter } from "./types";
import { createGreenhouseAdapter } from "./adapters/greenhouse";
import { createLeverAdapter } from "./adapters/lever";
import { createAshbyAdapter } from "./adapters/ashby";

/**
 * Discovery configuration (Milestone 2).
 *
 * Every value comes from the environment with a safe default, so a fresh
 * clone runs real discovery with no setup. The default boards were chosen
 * because their public endpoints were verified live during this milestone and
 * their payloads are small enough for a bounded run.
 *
 * See docs/discovery-sources.md for the access method, limits and env vars of
 * every source.
 */

export interface DiscoveryConfig {
  /** Adapter keys included in a run (`greenhouse`, `lever`, `ashby`). */
  enabledSources: string[];
  greenhouseBoards: string[];
  leverPostings: string[];
  ashbyBoards: string[];
  /** Hard cap on HTTP requests for the whole run. */
  maxRequestsPerRun: number;
  /** How many adapters may fetch at the same time. */
  concurrency: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Cap on listings normalised per source (bounds run size and memory). */
  maxJobsPerSource: number;
  /** New jobs probed by the verification engine during a run. */
  verifyLimit: number;
  /** New jobs scored by the matching engine during a run. */
  matchLimit: number;
}

const DEFAULTS = {
  enabledSources: "greenhouse,lever,ashby",
  // Verified live during Milestone 2: 31 / 88 listings, ~0.7-0.8 MB payloads.
  greenhouseBoards: "dropbox,vercel",
  // Verified live: 85 postings, ~0.8 MB payload. `slug=Display Name` supplies
  // the company name Lever does not publish.
  leverPostings: "spotify=Spotify",
  // Verified live: 31 listings, ~0.4 MB payload.
  ashbyBoards: "Linear",
  maxRequestsPerRun: 12,
  concurrency: 2,
  timeoutMs: 15_000,
  maxJobsPerSource: 250,
  verifyLimit: 8,
  matchLimit: 50,
} as const;

function csv(value: string | undefined, fallback: string): string[] {
  const raw = value ?? fallback;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function intInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadDiscoveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): DiscoveryConfig {
  return {
    enabledSources: csv(env.DISCOVERY_SOURCES_ENABLED, DEFAULTS.enabledSources).map((s) =>
      s.toLowerCase(),
    ),
    greenhouseBoards: csv(env.DISCOVERY_GREENHOUSE_BOARDS, DEFAULTS.greenhouseBoards),
    leverPostings: csv(env.DISCOVERY_LEVER_POSTINGS, DEFAULTS.leverPostings),
    ashbyBoards: csv(env.DISCOVERY_ASHBY_BOARDS, DEFAULTS.ashbyBoards),
    maxRequestsPerRun: intInRange(
      env.JOBDEDO_DISCOVERY_MAX_REQUESTS_PER_RUN,
      DEFAULTS.maxRequestsPerRun,
      1,
      200,
    ),
    concurrency: intInRange(env.JOBDEDO_DISCOVERY_CONCURRENCY, DEFAULTS.concurrency, 1, 6),
    timeoutMs: intInRange(env.JOBDEDO_DISCOVERY_TIMEOUT_MS, DEFAULTS.timeoutMs, 1_000, 60_000),
    maxJobsPerSource: intInRange(
      env.JOBDEDO_DISCOVERY_MAX_JOBS_PER_SOURCE,
      DEFAULTS.maxJobsPerSource,
      1,
      5_000,
    ),
    verifyLimit: intInRange(env.JOBDEDO_DISCOVERY_VERIFY_LIMIT, DEFAULTS.verifyLimit, 0, 50),
    matchLimit: intInRange(env.JOBDEDO_DISCOVERY_MATCH_LIMIT, DEFAULTS.matchLimit, 0, 500),
  };
}

/**
 * Build the adapters a run should execute, in a stable order.
 * Disabled sources are simply not constructed — a run can never touch a
 * source the operator turned off.
 */
export function createAdapters(config: DiscoveryConfig): SourceAdapter[] {
  const enabled = new Set(config.enabledSources);
  const adapters: SourceAdapter[] = [];
  if (enabled.has("greenhouse")) {
    adapters.push(createGreenhouseAdapter(config.greenhouseBoards));
  }
  if (enabled.has("lever")) adapters.push(createLeverAdapter(config.leverPostings));
  if (enabled.has("ashby")) adapters.push(createAshbyAdapter(config.ashbyBoards));
  return adapters;
}
