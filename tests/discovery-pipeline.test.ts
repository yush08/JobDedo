import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalStore, type LocalStore } from "@/lib/db/local-store";
import type { ProfileBundle } from "@/lib/db";
import { createGreenhouseAdapter } from "@/features/discovery/adapters/greenhouse";
import { createLeverAdapter } from "@/features/discovery/adapters/lever";
import type { DiscoveryConfig } from "@/features/discovery/config";
import {
  executeDiscoveryRun,
  type DiscoveryRunSummary,
} from "@/features/discovery/pipeline";
import {
  STALE_RUN_MS,
  findInFlightRun,
  releaseRun,
  startDiscoveryRun,
} from "@/features/discovery/run";
import type { FetchLike, SourceAdapter } from "@/features/discovery/types";
import type { DiscoveryRun } from "@/types";
import { makeProfileChildrenSeed } from "./helpers";

/**
 * End-to-end discovery pipeline tests (Milestone 2).
 *
 * Real adapters + a fake HTTP layer + the real local DataStore: these tests
 * prove retrieval → validation → normalisation → dedupe → persistence →
 * run/source bookkeeping, idempotency, partial-failure handling and the
 * bounded verification/matching stages. The fake fetch proves the pipeline's
 * behaviour, NOT live integration (live endpoints were verified separately —
 * see docs/discovery-sources.md).
 *
 * Every test gets its own temp-dir store; `releaseRun()` clears the
 * process-wide claim held by run.ts.
 */

let dir: string;
let store: LocalStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jobdedo-pipeline-"));
  store = createLocalStore(dir);
  await store.ensureProfile();
});

afterEach(async () => {
  releaseRun();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/* ------------------------------ helpers ------------------------------ */

const json = (body: unknown, status = 200): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Fake fetch that records every URL it was asked for. */
function fakeFetch(handler: (url: string) => Response): {
  urls: string[];
  fetchImpl: FetchLike;
} {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  };
  return { urls, fetchImpl };
}

/** A Greenhouse-shaped job on the given board (unique title per id — two
 *  listings with the same company|title|location ARE the same vacancy). */
function ghJob(id: number, board = "northwind", overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Data Analyst Intern ${id}`,
    absolute_url: `https://job-boards.greenhouse.io/${board}/jobs/${id}`,
    location: { name: "Bengaluru, India" },
    first_published: "2026-10-20T09:00:00.000Z",
    content: "&lt;p&gt;Build dashboards with Python and SQL for the analytics team.&lt;/p&gt;",
    company_name: board === "acme" ? "Acme Robotics" : "Northwind Analytics",
    ...overrides,
  };
}

function testConfig(overrides: Partial<DiscoveryConfig> = {}): DiscoveryConfig {
  return {
    enabledSources: ["greenhouse", "lever"],
    greenhouseBoards: ["northwind", "acme"],
    leverPostings: [],
    ashbyBoards: [],
    maxRequestsPerRun: 12,
    concurrency: 2,
    timeoutMs: 5_000,
    maxJobsPerSource: 250,
    // Tests opt in explicitly: no network, no profile access by default.
    verifyLimit: 0,
    matchLimit: 0,
    ...overrides,
  };
}

async function createRun(): Promise<DiscoveryRun> {
  const profile = await store.ensureProfile();
  return store.createDiscoveryRun({
    profile_id: profile.id,
    status: "pending",
    trigger: "manual",
    queries: ["greenhouse:northwind"],
    checkpoint: { phase: "queued", sources: [], queued_at: new Date().toISOString() },
    pages_fetched: 0,
    found_count: 0,
    new_count: 0,
    duplicate_count: 0,
    error: "",
  });
}

/** Rows discovery actually persisted (the store ships with sample listings). */
const discoveredJobs = async () =>
  (await store.listJobsFull()).filter((job) => !job.is_sample);

async function execute(
  fetchImpl: FetchLike,
  adapters: SourceAdapter[],
  overrides: Partial<DiscoveryConfig> = {},
  extra: {
    now?: () => Date;
    resolveProfile?: () => Promise<ProfileBundle>;
  } = {},
): Promise<{ summary: DiscoveryRunSummary; runRow: DiscoveryRun }> {
  const runRow = await createRun();
  const summary = await executeDiscoveryRun({
    runId: runRow.id,
    store,
    adapters,
    config: testConfig(overrides),
    fetchImpl,
    ...extra,
  });
  return { summary, runRow };
}

/* ---------------------------- happy path ----------------------------- */

describe("executeDiscoveryRun — happy path", () => {
  it("persists real listings and records run, source and history state", async () => {
    const { urls, fetchImpl } = fakeFetch((url) =>
      url.includes("/boards/northwind/")
        ? json({ jobs: [ghJob(1), ghJob(2)] })
        : json({ jobs: [ghJob(3, "acme")] }),
    );
    const { summary, runRow } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind", "acme"]),
    ]);

    expect(summary.status).toBe("completed");
    expect(summary.error).toBe("");
    expect(summary.found).toBe(3);
    expect(summary.new).toBe(3);
    expect(summary.requests).toBe(2);
    expect(urls).toHaveLength(2);

    const source = summary.sources[0]!;
    expect(source.source_key).toBe("greenhouse");
    expect(source.status).toBe("success");
    expect(source.fetched).toBe(3);
    expect(source.created).toBe(3);
    expect(source.failures).toEqual([]);

    // Persisted rows carry everything the Discover UI needs.
    const jobs = await discoveredJobs();
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.is_sample).toBe(false);
      expect(job.original_url).toMatch(/^https:\/\/job-boards\.greenhouse\.io\//);
      expect(job.canonical_url).toBeTruthy();
      expect(job.application_url).toBeTruthy();
      expect(job.first_discovered_at).toBeTruthy();
      expect(job.last_discovered_at).toBeTruthy();
      expect(job.last_discovery_run_id).toBe(runRow.id);
      expect(job.source_links).toHaveLength(1);
      expect(job.source_links[0]!.source_key).toBe("greenhouse");
      expect(job.source_links[0]!.url).toBe(job.original_url);
      // Normalisation: inferred only from what the posting published.
      expect(job.city).toBe("Bengaluru");
      expect(job.employment_type).toBe("internship");
      expect(job.experience_level).toBe("student");
      expect(job.salary_min).toBeNull(); // Greenhouse published no salary
      expect(job.closing_date).toBeNull(); // …and no deadline
      expect(job.verification_status).toBe("UNVERIFIED");
      expect(job.job_status).toBe("open");
    }

    // Run row: finished, counted, checkpointed to completion.
    const run = await store.getDiscoveryRun(runRow.id);
    expect(run?.status).toBe("completed");
    expect(run?.finished_at).toBeTruthy();
    expect(run?.found_count).toBe(3);
    expect(run?.new_count).toBe(3);
    expect(run?.error).toBe("");
    expect((run?.checkpoint as { phase?: string }).phase).toBe("done");

    // Per-source status + run history are queryable for the dashboard.
    const sources = await store.listSources();
    const greenhouse = sources.find((s) => s.key === "greenhouse");
    expect(greenhouse?.last_status).toBe("success");
    expect(greenhouse?.last_run_at).toBeTruthy();
    expect(greenhouse?.last_message).toContain("3 listings");

    const history = await store.listDiscoveryRuns(10);
    expect(history.map((r) => r.id)).toContain(runRow.id);
    expect(history.find((r) => r.id === runRow.id)?.status).toBe("completed");
  });

  it("is idempotent: a second run merges sightings without losing history", async () => {
    const clock1 = new Date("2026-11-04T12:00:00.000Z");
    const clock2 = new Date("2026-11-04T12:05:00.000Z");
    const { fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1), ghJob(2)] }));
    const adapters = () => [createGreenhouseAdapter(["northwind"])];

    const first = await execute(fetchImpl, adapters(), {}, { now: () => clock1 });
    expect(first.summary.status).toBe("completed");
    expect(first.summary.new).toBe(2);

    const before = await discoveredJobs();
    expect(before).toHaveLength(2);
    const firstSeen = new Map(before.map((j) => [j.id, j.first_discovered_at]));

    const second = await execute(fetchImpl, adapters(), {}, { now: () => clock2 });
    expect(second.summary.status).toBe("completed");
    expect(second.summary.new).toBe(0); // nothing created
    expect(second.summary.duplicate).toBe(2); // both merged into existing rows

    const after = await discoveredJobs();
    expect(after).toHaveLength(2); // still exactly two rows — no duplicates
    for (const job of after) {
      expect(job.first_discovered_at).toBe(firstSeen.get(job.id)); // untouched
      expect(job.last_discovered_at).toBe(clock2.toISOString()); // fresh sighting
      expect(job.last_discovery_run_id).toBe(second.runRow.id);
      expect(job.source_links).toHaveLength(1); // same source, no growth
      expect(job.source_links[0]!.first_seen_at).toBe(clock1.toISOString());
      expect(job.source_links[0]!.last_seen_at).toBe(clock2.toISOString());
    }

    const runs = await store.listDiscoveryRuns(10);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === "completed")).toBe(true);
  });
});

/* --------------------------- dedupe in-run --------------------------- */

describe("executeDiscoveryRun — deduplication", () => {
  it("collapses the same vacancy seen on two sources within one run", async () => {
    const { fetchImpl } = fakeFetch((url) =>
      url.includes("boards-api.greenhouse.io")
        ? json({ jobs: [ghJob(1)] })
        : json([
            {
              id: "lever-1",
              text: "Data Analyst Intern 1",
              hostedUrl: "https://jobs.lever.co/northwind/lever-1",
              categories: { location: "Bengaluru, India", commitment: "Internship" },
              descriptionPlain:
                "Build dashboards with Python and SQL for the analytics team every week.",
            },
          ]),
    );
    const { summary } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind"]),
      createLeverAdapter(["northwind=Northwind Analytics"]),
    ]);

    expect(summary.status).toBe("completed");
    // One source created it, the other recognised the same vacancy.
    expect(summary.new).toBe(1);
    expect(summary.duplicate).toBe(1);

    const jobs = await discoveredJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.title).toBe("Data Analyst Intern 1");
    expect(jobs[0]!.source_links).toHaveLength(1); // loser's link never persisted
    expect(["greenhouse", "lever"]).toContain(jobs[0]!.source_links[0]!.source_key);
  });

  it("collapses a listing repeated across boards of the same source", async () => {
    const { fetchImpl } = fakeFetch((url) =>
      url.includes("/boards/northwind/")
        ? json({ jobs: [ghJob(1), ghJob(2)] })
        : json({ jobs: [ghJob(2), ghJob(3, "acme")] }), // job 2 again on acme
    );
    const { summary } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind", "acme"]),
    ]);

    expect(summary.status).toBe("completed");
    expect(summary.new).toBe(3);
    expect(summary.duplicate).toBe(1);
    expect(summary.sources[0]!.deduplicated).toBe(1);
    expect(await discoveredJobs()).toHaveLength(3);
  });

  it("counts invalid listings and still persists the valid ones", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({
        jobs: [
          ghJob(1),
          { id: 99, absolute_url: "https://job-boards.greenhouse.io/northwind/jobs/99" }, // no title
        ],
      }),
    );
    const { summary } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind"]),
    ]);

    expect(summary.status).toBe("completed");
    expect(summary.invalid).toBe(1);
    expect(summary.new).toBe(1);
    expect(summary.sources[0]!.status).toBe("partial"); // invalid > 0 → partial
    expect(summary.sources[0]!.invalid).toBe(1);
    expect(await discoveredJobs()).toHaveLength(1);
  });
});

/* -------------------------- failure handling ------------------------- */

describe("executeDiscoveryRun — partial failures", () => {
  it("records a broken board as partial without losing the working one", async () => {
    const { fetchImpl } = fakeFetch((url) =>
      url.includes("/boards/northwind/")
        ? json({ jobs: [ghJob(1), ghJob(2)] })
        : json("Not Found", 404),
    );
    const { summary } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind", "acme"]),
    ]);

    expect(summary.status).toBe("completed"); // one source still succeeded
    const source = summary.sources[0]!;
    expect(source.status).toBe("partial");
    expect(source.created).toBe(2);
    expect(source.failures).toHaveLength(1);
    expect(source.failures[0]!.target).toBe("acme");
    expect(source.failures[0]!.error).toContain("HTTP 404");

    const run = await store.getDiscoveryRun(summary.run_id);
    expect(run?.status).toBe("completed");
    expect(run?.error).toBe("");
    expect(run?.finished_at).toBeTruthy();
    expect(await discoveredJobs()).toHaveLength(2);

    const greenhouse = (await store.listSources()).find((s) => s.key === "greenhouse");
    expect(greenhouse?.last_status).toBe("partial");
    expect(greenhouse?.last_message).toContain("HTTP 404");
  });

  it("marks the run failed when every source fails, persisting no rows", async () => {
    const { fetchImpl } = fakeFetch(() => json("Not Found", 404));
    const { summary } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind", "acme"]),
    ]);

    expect(summary.status).toBe("failed");
    expect(summary.error).toContain("Every source failed");
    expect(summary.sources[0]!.status).toBe("failure");

    const run = await store.getDiscoveryRun(summary.run_id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Every source failed");
    expect(run?.finished_at).toBeTruthy();
    expect(await discoveredJobs()).toHaveLength(0);

    const greenhouse = (await store.listSources()).find((s) => s.key === "greenhouse");
    expect(greenhouse?.last_status).toBe("failure");
  });

  it("keeps a checkpoint of progress when a source crashes outright", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error("connection reset by peer");
    });
    const { summary } = await execute(fetchImpl, [
      createGreenhouseAdapter(["northwind"]),
    ]);

    expect(summary.status).toBe("failed");
    expect(summary.sources[0]!.failures[0]!.error).toContain("connection reset by peer");
    const run = await store.getDiscoveryRun(summary.run_id);
    expect(run?.error).toContain("connection reset by peer"); // surfaced in run error
    expect((run?.checkpoint as { phase?: string }).phase).toBe("failed");
  });
});

/* ------------------------------ bounds ------------------------------- */

describe("executeDiscoveryRun — bounded execution", () => {
  it("stops fetching at the configured request budget", async () => {
    const { urls, fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1)] }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind", "acme", "vercel"])],
      { maxRequestsPerRun: 1 },
    );

    expect(summary.requests).toBe(1);
    expect(urls).toHaveLength(1); // second board never requested
    const source = summary.sources[0]!;
    expect(source.status).toBe("partial");
    expect(source.failures.some((f) => f.error.includes("budget exhausted"))).toBe(true);
    expect(await discoveredJobs()).toHaveLength(1); // what the first board gave us
  });

  it("caps listings per source at maxJobsPerSource", async () => {
    const jobs = [1, 2, 3, 4, 5].map((id) => ghJob(id));
    const { fetchImpl } = fakeFetch(() => json({ jobs }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind"])],
      { maxJobsPerSource: 2 },
    );

    expect(summary.new).toBe(2);
    const source = summary.sources[0]!;
    expect(source.created).toBe(2);
    expect(
      source.failures.some((f) => f.error.includes("Stopped after 2 listings")),
    ).toBe(true);
    expect(source.status).toBe("partial");
    expect(await discoveredJobs()).toHaveLength(2);
  });
});

/* ------------------------ verification stage ------------------------- */

describe("executeDiscoveryRun — verification stage", () => {
  it("probes new listings with the verification engine when enabled", async () => {
    const head = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", head);

    const { fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1), ghJob(2)] }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind"])],
      { verifyLimit: 2 },
    );

    expect(summary.status).toBe("completed");
    expect(summary.verified).toBe(2);
    expect(head).toHaveBeenCalled(); // real HTTP probe, stubbed at global fetch

    const jobs = await discoveredJobs();
    for (const job of jobs) {
      expect(job.last_checked_at).toBeTruthy();
      const verification = await store.getVerification(job.id);
      expect(verification).not.toBeNull();
      expect(verification!.checked_at).toBeTruthy();
      expect(verification!.application_link_status).toBe("working");
      const history = await store.listVerificationHistory(job.id);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]!.result).toBe("confirmed");
      expect(history[0]!.evidence_url).toBe(job.original_url);
    }
  });

  it("keeps listings persisted when every probe fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );

    const { fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1), ghJob(2)] }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind"])],
      { verifyLimit: 2 },
    );

    // The probe failing must never abort or roll back the run.
    expect(summary.status).toBe("completed");
    expect(summary.verified).toBe(2); // outcome recorded, even "unable to check"
    const jobs = await discoveredJobs();
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      const verification = await store.getVerification(job.id);
      expect(verification!.application_link_status).toBe("unable_to_check");
    }
  });

  it("does not probe beyond verifyLimit", async () => {
    const head = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", head);

    const { fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1), ghJob(2), ghJob(3)] }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind"])],
      { verifyLimit: 1 },
    );

    expect(summary.verified).toBe(1);
    expect(head).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------- matching stage ---------------------------- */

describe("executeDiscoveryRun — matching stage", () => {
  it("scores touched listings with the matching engine when enabled", async () => {
    await store.saveProfileChildren(makeProfileChildrenSeed());
    const resolveProfile = async (): Promise<ProfileBundle> => {
      const profile = await store.ensureProfile();
      const [children, prefs] = await Promise.all([
        store.listProfileChildren(),
        store.getPreferences(),
      ]);
      return {
        profile,
        ...children,
        roles: prefs.roles,
        preferences: prefs.preferences,
      };
    };

    const { fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1), ghJob(2)] }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind"])],
      { matchLimit: 10 },
      { resolveProfile },
    );

    expect(summary.status).toBe("completed");
    expect(summary.matched).toBe(2);

    const jobs = await discoveredJobs();
    for (const job of jobs) {
      const match = await store.getLatestMatch(job.id);
      expect(match).not.toBeNull();
      expect(typeof match!.score).toBe("number");
      expect(match!.profile_id).toBe((await store.ensureProfile()).id);
    }
  });

  it("survives a profile-resolution failure without aborting the run", async () => {
    const { fetchImpl } = fakeFetch(() => json({ jobs: [ghJob(1)] }));
    const { summary } = await execute(
      fetchImpl,
      [createGreenhouseAdapter(["northwind"])],
      { matchLimit: 10 },
      {
        resolveProfile: async () => {
          throw new Error("profile store unavailable");
        },
      },
    );

    expect(summary.status).toBe("completed");
    expect(summary.matched).toBe(0);
    expect(await discoveredJobs()).toHaveLength(1); // listing still persisted
  });
});

/* ----------------------- run control (run.ts) ------------------------ */

describe("startDiscoveryRun — validation and duplicate prevention", () => {
  const config = () => testConfig({ greenhouseBoards: ["northwind"] });

  it("starts a run and rejects a second one while it is in flight", async () => {
    const first = await startDiscoveryRun({ store, config: config() });
    expect(first.status).toBe("started");
    if (first.status !== "started") return;
    expect(first.run.status).toBe("pending");
    expect(first.adapters.map((a) => a.key)).toEqual(["greenhouse"]);

    // Layer 1: in-process claim.
    const second = await startDiscoveryRun({ store, config: config() });
    expect(second.status).toBe("conflict");
    if (second.status === "conflict") expect(second.run?.id).toBe(first.run.id);

    // Layer 2: persisted pending row — still blocked after the claim is free.
    releaseRun();
    const third = await startDiscoveryRun({ store, config: config() });
    expect(third.status).toBe("conflict");
    if (third.status === "conflict") expect(third.run?.id).toBe(first.run.id);
    // …and the conflict path must not leak the claim it acquired.
    releaseRun();
  });

  it("reports unavailable when no source is enabled or targeted", async () => {
    const noAdapters = await startDiscoveryRun({
      store,
      config: testConfig({ enabledSources: [] }),
    });
    expect(noAdapters.status).toBe("unavailable");
    if (noAdapters.status === "unavailable") expect(noAdapters.code).toBe("NO_ADAPTERS");

    const noTargets = await startDiscoveryRun({
      store,
      config: testConfig({ greenhouseBoards: [], leverPostings: [], ashbyBoards: [] }),
    });
    expect(noTargets.status).toBe("unavailable");
    if (noTargets.status === "unavailable") expect(noTargets.code).toBe("NO_TARGETS");
  });

  it("rejects a persisted run left behind by a crashed process after 10 minutes", async () => {
    // Simulate another instance's run that never finished.
    const crashed = await store.createDiscoveryRun({
      profile_id: (await store.ensureProfile()).id,
      status: "running",
      trigger: "manual",
      queries: ["greenhouse:northwind"],
      checkpoint: { phase: "fetching", sources: [] },
      pages_fetched: 1,
      found_count: 0,
      new_count: 0,
      duplicate_count: 0,
      error: "",
    });

    // Fresh → blocks, exactly like a healthy in-flight run.
    expect(await findInFlightRun(store)).toMatchObject({ id: crashed.id });
    expect((await startDiscoveryRun({ store, config: config() })).status).toBe("conflict");
    releaseRun();

    // Backdate its start past STALE_RUN_MS (the store writes plain JSON).
    const file = path.join(dir, ".data", "jobdedo.local.json");
    const state = JSON.parse(await readFile(file, "utf8")) as {
      discoveryRuns: DiscoveryRun[];
    };
    const row = state.discoveryRuns.find((r) => r.id === crashed.id)!;
    row.started_at = new Date(Date.now() - STALE_RUN_MS - 60_000).toISOString();
    await writeFile(file, JSON.stringify(state));

    // The stale run is failed (truthfully recorded) and no longer blocks.
    expect(await findInFlightRun(store)).toBeNull();
    const failed = await store.getDiscoveryRun(crashed.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("no heartbeat");

    const next = await startDiscoveryRun({ store, config: config() });
    expect(next.status).toBe("started");
    if (next.status === "started") expect(next.run.id).not.toBe(crashed.id);
  });

  it("restricts a run to the requested, enabled sources", async () => {
    const outcome = await startDiscoveryRun({
      store,
      config: testConfig({ greenhouseBoards: ["northwind"] }),
      sources: ["lever"], // enabled in config but explicitly requested only
    });
    // lever has no configured postings → filtered runnable set is empty.
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") expect(outcome.code).toBe("NO_TARGETS");
  });
});
