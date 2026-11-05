import { createAdapters, loadDiscoveryConfig } from "./config";

/**
 * Discovery service registry (Milestone 2).
 *
 * The three prioritised sources — Greenhouse, Lever, Ashby — are real
 * adapters over their official public JSON endpoints. Whether one of them
 * actually runs depends on its configuration (board tokens / company slugs),
 * which `enabled` and `status` report honestly.
 *
 * The four remaining sources are deliberately NOT implemented: none offers a
 * public, permitted feed, and bypassing their login walls / anti-bot
 * protection is out of scope. `status` states the reason for each.
 */

export interface DiscoveryAdapter {
  key: string;
  name: string;
  /** Whether this adapter can actually fetch jobs today. */
  enabled: boolean;
  /** Human-readable status shown in the UI. */
  status: string;
}

/** Sources that exist as product concepts but have no permitted access path. */
const UNSUPPORTED: DiscoveryAdapter[] = [
  {
    key: "internshala",
    name: "Internshala",
    enabled: false,
    status: "Not integrated — no public API; listings require an authenticated session.",
  },
  {
    key: "linkedin",
    name: "LinkedIn Jobs",
    enabled: false,
    status: "Not integrated — no public postings API, and scraping is prohibited by its Terms of Service.",
  },
  {
    key: "naukri",
    name: "Naukri",
    enabled: false,
    status: "Not integrated — no public API and anti-bot protection on listing pages.",
  },
  {
    key: "indeed",
    name: "Indeed",
    enabled: false,
    status: "Not integrated — no public feed, and its publisher agreement prohibits scraping.",
  },
  {
    key: "unstop",
    name: "Unstop",
    enabled: false,
    status: "Not integrated — no public feed; manual URL import available.",
  },
];

/**
 * Registered source adapters: the implemented ones first (in run order),
 * then the sources that cannot be supported today.
 */
export function listDiscoveryAdapters(): DiscoveryAdapter[] {
  const implemented = createAdapters(loadDiscoveryConfig()).map((adapter) => ({
    key: adapter.key,
    name: adapter.name,
    enabled: adapter.enabled,
    status: adapter.status,
  }));
  return [...implemented, ...UNSUPPORTED];
}

/** True when at least one configured source can be fetched right now. */
export function discoveryReady(): boolean {
  return listDiscoveryAdapters().some((adapter) => adapter.enabled);
}

/** How stale the latest run is, in milliseconds (null when no run exists). */
export function stalenessMs(
  lastRun: { finished_at: string | null; started_at: string } | null,
  searchFrequencyHours: number,
  now = Date.now(),
): { stale: boolean; ageMs: number | null; thresholdMs: number } {
  const thresholdMs = searchFrequencyHours * 3_600_000;
  if (!lastRun) return { stale: true, ageMs: null, thresholdMs };
  const end = lastRun.finished_at ?? lastRun.started_at;
  const ageMs = now - new Date(end).getTime();
  return { stale: ageMs > thresholdMs, ageMs, thresholdMs };
}
