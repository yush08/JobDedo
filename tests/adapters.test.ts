import { describe, expect, it } from "vitest";

import type { AdapterContext, FetchLike } from "@/features/discovery/types";
import { createGreenhouseAdapter } from "@/features/discovery/adapters/greenhouse";
import { createLeverAdapter, parseLeverTargets } from "@/features/discovery/adapters/lever";
import { createAshbyAdapter, parseAshbyTargets } from "@/features/discovery/adapters/ashby";
import { takeBudget } from "@/features/discovery/adapters/http";

/**
 * Source adapter contracts (Milestone 2).
 *
 * These tests use a FAKE fetch — they prove the adapters validate, map and
 * normalise payloads correctly, and that failures are recorded instead of
 * thrown. They are not evidence of live integration; the live endpoints were
 * verified separately during the milestone (see docs/discovery-sources.md).
 */

function ctx(fetchImpl: FetchLike, budget?: { remaining: number }): AdapterContext {
  return { fetchImpl, timeoutMs: 5_000, ...(budget ? { budget } : {}) };
}

const json = (body: unknown, status = 200): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Fake fetch that records every URL it was asked for. */
function recorder(handler: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  };
  return { urls, fetchImpl };
}

/* ------------------------------------------------------------------ */
/* Greenhouse                                                          */
/* ------------------------------------------------------------------ */

const greenhouseJob = {
  id: 678901,
  title: "Data Analyst Intern",
  absolute_url: "https://job-boards.greenhouse.io/dropbox/jobs/678901?ref=nl",
  location: { name: "Bengaluru, India" },
  first_published: "2026-10-20T09:00:00.000Z",
  content:
    "&lt;p&gt;Build dashboards with &lt;b&gt;Python&lt;/b&gt; and SQL.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Own weekly reports&lt;/li&gt;&lt;/ul&gt;",
  company_name: "Dropbox",
};

describe("Greenhouse adapter", () => {
  const adapter = createGreenhouseAdapter(["dropbox", "vercel"]);

  it("is enabled only when boards are configured", () => {
    expect(adapter.enabled).toBe(true);
    expect(createGreenhouseAdapter([]).enabled).toBe(false);
    expect(createGreenhouseAdapter([]).status).toContain("No Greenhouse boards");
  });

  it("fetches each board from the public boards API", async () => {
    const { urls, fetchImpl } = recorder(() => json({ jobs: [greenhouseJob] }));
    const result = await adapter.fetchAll(ctx(fetchImpl));

    expect(urls).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs?content=true",
      "https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=true",
    ]);
    expect(result.requests).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]._target).toBe("dropbox");
  });

  it("records a 404 board as a per-target failure instead of throwing", async () => {
    const { fetchImpl } = recorder((url) =>
      url.includes("dropbox") ? json({ jobs: [greenhouseJob] }) : json("Not Found", 404),
    );
    const result = await adapter.fetchAll(ctx(fetchImpl));

    expect(result.listings).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.target).toBe("vercel");
    expect(result.failures[0]!.error).toContain("HTTP 404");
  });

  it("records invalid JSON and malformed envelopes as failures", async () => {
    const badJson = await createGreenhouseAdapter(["a"]).fetchAll(
      ctx(async () => json("<html>rate limited</html>")),
    );
    expect(badJson.listings).toHaveLength(0);
    expect(badJson.failures[0]!.error).toContain("Invalid JSON");

    const noJobs = await createGreenhouseAdapter(["a"]).fetchAll(
      ctx(async () => json({ jobs: "surprise" })),
    );
    expect(noJobs.failures[0]!.error).toContain('no "jobs" array');
  });

  it("stops fetching when the shared request budget is spent", async () => {
    const budget = { remaining: 1 };
    const { urls, fetchImpl } = recorder(() => json({ jobs: [greenhouseJob] }));
    const result = await adapter.fetchAll(ctx(fetchImpl, budget));

    expect(urls).toHaveLength(1); // only the first board was requested
    expect(result.requests).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.error).toContain("budget exhausted");
    expect(budget.remaining).toBe(0);
  });

  it("normalises a published job into an honest draft", () => {
    const outcome = adapter.normalise({ ...greenhouseJob, _target: "dropbox" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const draft = outcome.draft;

    expect(draft.source_key).toBe("greenhouse");
    expect(draft.source_job_id).toBe("678901");
    expect(draft.company.name).toBe("Dropbox");
    expect(draft.title).toBe("Data Analyst Intern");
    expect(draft.description).toContain("Build dashboards with Python and SQL.");
    expect(draft.description).toContain("• Own weekly reports");
    expect(draft.city).toBe("Bengaluru");
    expect(draft.country).toBe("India");
    // Inferred from the posting's own words — "Intern" makes it an internship.
    expect(draft.employment_type).toBe("internship");
    expect(draft.experience_level).toBe("student");
    expect(draft.posted_at).toBe("2026-10-20T09:00:00.000Z");
    // Greenhouse publishes no deadline / employment type / salary for this board.
    expect(draft.closing_date).toBeNull();
    expect(draft.salary_min).toBeNull();
    // Original URL preserved verbatim; canonical form strips tracking only.
    expect(draft.original_url).toContain("ref=nl");
    expect(draft.canonical_url).toBe("https://job-boards.greenhouse.io/dropbox/jobs/678901");
    // No separate apply URL is published — the listing page IS the apply page.
    expect(draft.application_url).toBe(draft.original_url);
    // No company website is published — never invented.
    expect(draft.company.official_website_url).toBe("");
  });

  it("derives the company from the board token when none is published", () => {
    const outcome = adapter.normalise({ ...greenhouseJob, company_name: undefined });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.draft.company.name).toBe("dropbox");
  });

  it("rejects listings with no id, title or URL", () => {
    expect(adapter.normalise({ ...greenhouseJob, id: undefined })).toEqual({
      ok: false,
      error: "missing or invalid `id`",
    });
    expect(adapter.normalise({ ...greenhouseJob, title: undefined })).toEqual({
      ok: false,
      error: "missing `title`",
    });
    expect(adapter.normalise({ ...greenhouseJob, absolute_url: undefined })).toEqual({
      ok: false,
      error: "missing `absolute_url`",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Lever                                                               */
/* ------------------------------------------------------------------ */

describe("Lever adapter", () => {
  const adapter = createLeverAdapter(["spotify=Spotify"]);

  it("parses slug=Name targets and drops empty entries", () => {
    expect(parseLeverTargets(["spotify=Spotify", "palantir", "  "])).toEqual([
      { slug: "spotify", name: "Spotify" },
      { slug: "palantir", name: "" },
    ]);
    expect(createLeverAdapter([]).enabled).toBe(false);
  });

  it("fetches each slug from the public postings API", async () => {
    const posting = { id: "abc", text: "Engineer", hostedUrl: "https://jobs.lever.co/x/abc" };
    const { urls, fetchImpl } = recorder(() => json([posting]));
    const result = await adapter.fetchAll(ctx(fetchImpl));

    expect(urls).toEqual(["https://api.lever.co/v0/postings/spotify?mode=json"]);
    expect(result.requests).toBe(1);
    expect(result.listings[0]._target).toBe("spotify");
    expect(result.failures).toEqual([]);
  });

  it("records non-array payloads and HTTP errors as failures", () => {
    return (async () => {
      const notArray = await adapter.fetchAll(ctx(async () => json({ jobs: [] })));
      expect(notArray.failures[0]!.error).toContain("JSON array");

      const missing = await createLeverAdapter(["ghost"]).fetchAll(
        ctx(async () => json("nope", 404)),
      );
      expect(missing.failures[0]!.error).toContain("HTTP 404");
    })();
  });

  it("normalises a published posting into an honest draft", async () => {
    const posting = {
      id: "2a55d6c9",
      text: "Data Analyst - Commercial",
      hostedUrl: "https://jobs.lever.co/spotify/2a55d6c9",
      applyUrl: "https://jobs.lever.co/spotify/2a55d6c9/apply",
      createdAt: 1_730_000_000_000,
      categories: { location: "Stockholm, Sweden", commitment: "Full-time" },
      workplaceType: "remote",
      country: "Sweden",
      descriptionPlain: "We build products used by millions of people.",
      lists: [
        {
          text: "Qualifications",
          content: "<ul><li>Python</li><li>SQL</li></ul>",
        },
      ],
      additionalPlain: "Apply with a short note.",
    };
    const { fetchImpl } = recorder(() => json([posting]));
    const fetched = await adapter.fetchAll(ctx(fetchImpl));
    const outcome = adapter.normalise(fetched.listings[0]!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const draft = outcome.draft;

    // Lever publishes no company name — it comes from the configured slug.
    expect(draft.company.name).toBe("Spotify");
    expect(draft.source_job_id).toBe("2a55d6c9");
    expect(draft.employment_type).toBe("full_time"); // from categories.commitment
    expect(draft.work_model).toBe("remote"); // from workplaceType
    expect(draft.posted_at).toBe(new Date(1_730_000_000_000).toISOString());
    // Lever publishes no application deadline.
    expect(draft.closing_date).toBeNull();
    expect(draft.original_url).toBe("https://jobs.lever.co/spotify/2a55d6c9");
    expect(draft.application_url).toContain("/apply");
    expect(draft.city).toBe("Stockholm");
    // Line structure survives so source headings are still parseable…
    expect(draft.description).toContain("Qualifications\n• Python");
    expect(draft.requirements.required_skills).toEqual(["Python", "SQL"]);
    // …and the plain description plus extra text are all kept.
    expect(draft.description).toContain("millions of people.");
    expect(draft.description).toContain("Apply with a short note.");
    // No salary figure was published — nothing invented.
    expect(draft.salary_min).toBeNull();
    expect(draft.stipend_amount).toBeNull();
  });

  it("rejects postings with no id, title or hosted URL", () => {
    const base = {
      id: "abc",
      text: "Engineer",
      hostedUrl: "https://jobs.lever.co/s/abc",
    };
    expect(adapter.normalise({ ...base, id: undefined }).ok).toBe(false);
    expect(adapter.normalise({ ...base, text: undefined }).ok).toBe(false);
    expect(adapter.normalise({ ...base, hostedUrl: undefined }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Ashby                                                               */
/* ------------------------------------------------------------------ */

describe("Ashby adapter", () => {
  const adapter = createAshbyAdapter(["Linear=Linear Technologies"]);

  it("parses Board=Name targets", () => {
    expect(parseAshbyTargets(["Linear=Linear Technologies", "Notion", ""])).toEqual([
      { board: "Linear", name: "Linear Technologies" },
      { board: "Notion", name: "" },
    ]);
    expect(createAshbyAdapter([]).enabled).toBe(false);
  });

  it("fetches each board and skips private (isListed: false) listings", async () => {
    const job = {
      id: "j1",
      title: "Engineer",
      jobUrl: "https://jobs.ashbyhq.com/Linear/j1",
      isListed: true,
      descriptionPlain: "Build.",
    };
    const hidden = { ...job, id: "j2", title: "Hidden", isListed: false };
    const { urls, fetchImpl } = recorder(() => json({ apiVersion: "1", jobs: [job, hidden] }));
    const result = await adapter.fetchAll(ctx(fetchImpl));

    expect(urls).toEqual(["https://api.ashbyhq.com/posting-api/job-board/Linear"]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].id).toBe("j1");
    expect(result.failures).toEqual([]);
  });

  it("records missing-job-array envelopes as failures", async () => {
    const result = await adapter.fetchAll(ctx(async () => json({ apiVersion: "1" })));
    expect(result.failures[0]!.error).toContain('no "jobs" array');
    expect(result.listings).toHaveLength(0);
  });

  it("normalises a published listing into an honest draft", () => {
    const raw = {
      id: "d3bc1ced",
      title: "Senior / Staff Fullstack Engineer",
      employmentType: "FullTime",
      workplaceType: "Remote",
      isRemote: true,
      location: "Europe",
      publishedAt: "2026-10-01T12:00:00.000+00:00",
      jobUrl: "https://jobs.ashbyhq.com/Linear/d3bc1ced",
      applyUrl: "https://jobs.ashbyhq.com/Linear/d3bc1ced/application",
      descriptionPlain: "Build the product.\n\nRequirements\n- TypeScript",
      isListed: true,
      _target: "Linear",
    };
    const outcome = adapter.normalise(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const draft = outcome.draft;

    // Board name from config supplies the company Ashby does not publish.
    expect(draft.company.name).toBe("Linear Technologies");
    expect(draft.employment_type).toBe("full_time"); // Ashby's own taxonomy
    expect(draft.work_model).toBe("remote");
    expect(draft.posted_at).toBe("2026-10-01T12:00:00.000+00:00");
    expect(draft.original_url).toBe("https://jobs.ashbyhq.com/Linear/d3bc1ced");
    expect(draft.application_url).toContain("/application");
    expect(draft.description).toContain("Requirements\n- TypeScript");
    // Ashby publishes no salary / deadline for this board.
    expect(draft.salary_min).toBeNull();
    expect(draft.closing_date).toBeNull();
  });

  it("stores unknown when the source publishes no employment type", () => {
    const outcome = adapter.normalise({
      id: "j9",
      title: "Backend Engineer",
      jobUrl: "https://jobs.ashbyhq.com/Linear/j9",
      employmentType: null,
      descriptionPlain: "Build APIs.",
      isListed: true,
      _target: "Linear",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.draft.employment_type).toBe("unknown");
  });

  it("rejects private listings and missing required fields", () => {
    const base = {
      id: "j1",
      title: "Engineer",
      jobUrl: "https://jobs.ashbyhq.com/Linear/j1",
      isListed: true,
    };
    expect(adapter.normalise({ ...base, isListed: false }).ok).toBe(false);
    expect(adapter.normalise({ ...base, id: "" }).ok).toBe(false);
    expect(adapter.normalise({ ...base, title: "" }).ok).toBe(false);
    expect(adapter.normalise({ ...base, jobUrl: "" }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Shared HTTP helper                                                  */
/* ------------------------------------------------------------------ */

describe("request budget accounting", () => {
  it("takeBudget consumes one unit at a time and refuses at zero", () => {
    const budget = { remaining: 2 };
    const context = ctx(async () => json({}), budget);
    expect(takeBudget(context)).toBe(true);
    expect(takeBudget(context)).toBe(true);
    expect(takeBudget(context)).toBe(false);
    expect(budget.remaining).toBe(0);
  });

  it("takeBudget is a no-op when no budget is attached", () => {
    expect(takeBudget(ctx(async () => json({})))).toBe(true);
  });
});
