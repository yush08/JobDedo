import { describe, expect, it } from "vitest";

import {
  applyJobFilters,
  paginate,
  runJobQuery,
  scoreJobs,
  sortJobs,
} from "@/features/jobs/query";
import { jobQuerySchema } from "@/lib/validation/schemas";
import type { Company, JobWithRelations, Paginated } from "@/types";
import {
  DAY,
  isoAt,
  makeJobWithRelations,
  makePreferences,
  makeProfile,
  makeRole,
} from "./helpers";

/** Build a fully-defaulted query, then override only what a test cares about. */
const q = (overrides: Record<string, unknown> = {}) => jobQuerySchema.parse(overrides);

const company = (name: string): Company => ({
  id: crypto.randomUUID(),
  name,
  domain: "northwind.example",
  official_website_url: "",
  website_status: "not_checked",
  careers_page_url: "",
  careers_discovery_method: "",
  careers_evidence_url: "",
  careers_status: "not_checked",
  description: "",
  logo_url: "",
  industry: "",
  size_bucket: "",
  last_checked_at: null,
  created_at: isoAt(),
});

describe("applyJobFilters", () => {
  const job = makeJobWithRelations();

  it("keeps an open non-sample job under default query settings", () => {
    expect(applyJobFilters([job], q())).toHaveLength(1);
  });

  it("drops sample rows unless include_sample is set", () => {
    const sample = makeJobWithRelations({ is_sample: true });
    expect(applyJobFilters([sample], q())).toHaveLength(1);
    expect(applyJobFilters([sample], q({ include_sample: "false" }))).toHaveLength(0);
    expect(applyJobFilters([sample], q({ include_sample: "true" }))).toHaveLength(1);
  });

  it("drops closed jobs unless include_closed is set", () => {
    const closed = makeJobWithRelations({ job_status: "closed" });
    expect(applyJobFilters([closed], q())).toHaveLength(0);
    expect(applyJobFilters([closed], q({ include_closed: "true" }))).toHaveLength(1);
  });

  it("restricts to saved jobs when saved_only is set", () => {
    const saved = makeJobWithRelations({}, { saved: true });
    const notSaved = makeJobWithRelations({}, { saved: false });
    expect(applyJobFilters([saved, notSaved], q({ saved_only: "true" }))).toEqual([saved]);
    expect(applyJobFilters([saved, notSaved], q({ saved_only: "false" }))).toHaveLength(2);
  });

  it("matches role against role tags and title", () => {
    const other = makeJobWithRelations({ title: "Backend Engineer", role_tags: ["Backend"] });
    expect(applyJobFilters([job, other], q({ role: "data analyst" }))).toEqual([job]);
    expect(applyJobFilters([job, other], q({ role: "backend" }))).toEqual([other]);
  });

  it("matches location as a case-insensitive substring", () => {
    expect(applyJobFilters([job], q({ location: "bengaluru" }))).toHaveLength(1);
    expect(applyJobFilters([job], q({ location: "berlin" }))).toHaveLength(0);
  });

  it("filters work model, employment type and experience level exactly", () => {
    expect(applyJobFilters([job], q({ work_model: "hybrid" }))).toHaveLength(1);
    expect(applyJobFilters([job], q({ work_model: "remote" }))).toHaveLength(0);
    expect(applyJobFilters([job], q({ employment_type: "internship" }))).toHaveLength(1);
    expect(applyJobFilters([job], q({ employment_type: "full_time" }))).toHaveLength(0);
    expect(applyJobFilters([job], q({ experience: "student" }))).toHaveLength(1);
    expect(applyJobFilters([job], q({ experience: "1_2_years" }))).toHaveLength(0);
  });

  it("filters on verification status", () => {
    const verified = makeJobWithRelations({ verification_status: "VERIFIED" });
    expect(applyJobFilters([verified], q({ verification: "VERIFIED" }))).toHaveLength(1);
    expect(applyJobFilters([verified], q({ verification: "INVALID" }))).toHaveLength(0);
  });

  it("matches company name as a substring", () => {
    const withCompany = makeJobWithRelations({}, { company: company("Northwind Analytics") });
    expect(applyJobFilters([withCompany], q({ company: "northwind" }))).toHaveLength(1);
    expect(applyJobFilters([withCompany], q({ company: "acme" }))).toHaveLength(0);
  });

  it("applies min_salary against salary_max, then salary_min, then stipend", () => {
    const salary = makeJobWithRelations({ salary_min: 40_000, salary_max: 60_000 });
    const stipend = makeJobWithRelations({ salary_min: null, salary_max: null, stipend_amount: 25_000 });
    const none = makeJobWithRelations({ salary_min: null, salary_max: null, stipend_amount: null });

    expect(applyJobFilters([salary], q({ min_salary: "60000" }))).toHaveLength(1);
    expect(applyJobFilters([salary], q({ min_salary: "60001" }))).toHaveLength(0);
    expect(applyJobFilters([stipend], q({ min_salary: "25000" }))).toHaveLength(1);
    expect(applyJobFilters([none], q({ min_salary: "1" }))).toHaveLength(0);
  });

  it("honours posted_within_days and rejects rows without a posted date", () => {
    const recent = makeJobWithRelations({ posted_at: new Date(Date.now() - 2 * DAY).toISOString() });
    const old = makeJobWithRelations({ posted_at: new Date(Date.now() - 40 * DAY).toISOString() });
    const undated = makeJobWithRelations({ posted_at: null });

    expect(applyJobFilters([recent, old, undated], q({ posted_within_days: "7" }))).toEqual([
      recent,
    ]);
    expect(applyJobFilters([recent, old, undated], q({ posted_within_days: "60" }))).toEqual([
      recent,
      old,
    ]);
  });

  it("requires every comma-separated skill to be present", () => {
    expect(applyJobFilters([job], q({ skills: "python" }))).toHaveLength(1);
    expect(applyJobFilters([job], q({ skills: "python, sql" }))).toHaveLength(1);
    expect(applyJobFilters([job], q({ skills: "python, rust" }))).toHaveLength(0);
    expect(applyJobFilters([job], q({ skills: " , " }))).toHaveLength(1); // blank list is a no-op
  });

  it("searches title, company, location, description and skills for q", () => {
    expect(applyJobFilters([job], q({ q: "dashboards" }))).toHaveLength(1); // description
    expect(applyJobFilters([job], q({ q: "DATA ANALYST" }))).toHaveLength(1); // title, case-insensitive
    expect(applyJobFilters([job], q({ q: "nonexistent-role" }))).toHaveLength(0);
  });

  it("combines filters conjunctively", () => {
    const kept = makeJobWithRelations({ verification_status: "VERIFIED" }, { saved: true });
    const dropped = makeJobWithRelations({ verification_status: "VERIFIED" }, { saved: false });
    const result = applyJobFilters(
      [kept, dropped],
      q({ saved_only: "true", verification: "VERIFIED", location: "bengaluru" }),
    );
    expect(result).toEqual([kept]);
  });
});

describe("sortJobs", () => {
  const older = makeJobWithRelations(
    {
      posted_at: new Date(Date.now() - 10 * DAY).toISOString(),
      first_discovered_at: new Date(Date.now() - 10 * DAY).toISOString(),
      salary_min: 10_000,
      salary_max: 20_000,
      closing_date: "2027-01-01",
    },
    { match_score: 95 },
  );
  const newer = makeJobWithRelations(
    {
      posted_at: new Date(Date.now() - 1 * DAY).toISOString(),
      first_discovered_at: new Date(Date.now() - 1 * DAY).toISOString(),
      salary_min: null,
      salary_max: null,
      stipend_amount: 5_000,
      closing_date: "2026-12-01",
    },
    { match_score: 90 },
  );
  const closed = makeJobWithRelations(
    {
      job_status: "closed",
      posted_at: new Date(Date.now() - 3 * DAY).toISOString(),
      first_discovered_at: new Date(Date.now() - 3 * DAY).toISOString(),
      salary_min: null,
      salary_max: null,
      stipend_amount: null,
      closing_date: "2026-11-20",
    },
    { match_score: 70 },
  );

  it("sorts by recency of posting", () => {
    expect(sortJobs([older, newer, closed], "recently_posted").map((j) => j.id)).toEqual([
      newer.id,
      closed.id,
      older.id,
    ]);
  });

  it("sorts by discovery time", () => {
    expect(sortJobs([older, newer, closed], "recently_discovered").map((j) => j.id)).toEqual([
      newer.id,
      closed.id,
      older.id,
    ]);
  });

  it("sorts by highest pay, treating nulls as zero", () => {
    expect(sortJobs([newer, older, closed], "highest_salary").map((j) => j.id)).toEqual([
      older.id,
      newer.id,
      closed.id,
    ]);
  });

  it("sorts by deadline, pushing closed and undated jobs to the end", () => {
    const undated = makeJobWithRelations({
      closing_date: null,
      posted_at: new Date(Date.now() - 5 * DAY).toISOString(),
    });
    expect(sortJobs([closed, undated, newer, older], "deadline").map((j) => j.id)).toEqual([
      newer.id,
      older.id,
      closed.id,
      undated.id,
    ]);
  });

  it("defaults to best match (score descending)", () => {
    expect(sortJobs([newer, closed, older], "best_match").map((j) => j.id)).toEqual([
      older.id,
      newer.id,
      closed.id,
    ]);
    // Recency order differs from score order for the same input.
    expect(sortJobs([newer, closed, older], "recently_posted").map((j) => j.id)).not.toEqual([
      older.id,
      newer.id,
      closed.id,
    ]);
  });

  it("does not mutate its input", () => {
    const input = [older, newer];
    const snapshot = input.map((j) => j.id);
    sortJobs(input, "highest_salary");
    expect(input.map((j) => j.id)).toEqual(snapshot);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 25 }, (_, i) => makeJobWithRelations({ id: `job-${i + 1}` }));

  it("slices pages without losing the total", () => {
    const page1 = paginate(rows, 1, 12);
    expect(page1).toMatchObject({ total: 25, page: 1, pageSize: 12 });
    expect(page1.items).toHaveLength(12);
    expect(page1.items[0]!.id).toBe("job-1");

    const page3 = paginate(rows, 3, 12);
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0]!.id).toBe("job-25");
  });

  it("returns an empty page beyond the end while preserving the total", () => {
    const past = paginate(rows, 9, 12);
    expect(past.items).toHaveLength(0);
    expect(past.total).toBe(25);
  });
});

describe("scoreJobs", () => {
  it("attaches a numeric match score to every row", () => {
    const rows = scoreJobs(
      [makeJobWithRelations()],
      makeProfile(),
      makePreferences(),
      [makeRole("Data Analyst")],
    );
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]!.match_score).toBe("number");
    expect(rows[0]!.match_score).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.match_score).toBeLessThanOrEqual(100);
  });
});

describe("runJobQuery — end-to-end pipeline", () => {
  it("scores, filters, sorts and paginates in one pass", () => {
    const strong = makeJobWithRelations({
      id: "strong",
      title: "Data Analyst Intern",
      role_tags: ["Data Analyst"],
      is_sample: false,
    });
    const sample = makeJobWithRelations({ id: "sample", is_sample: true });
    const weakRole = makeJobWithRelations({
      id: "other",
      title: "Chef",
      role_tags: ["Hospitality"],
      is_sample: false,
    });

    const result = runJobQuery(
      [weakRole, sample, strong],
      q({ include_sample: "false", pageSize: 10 }),
      makeProfile(),
      makePreferences(),
      [makeRole("Data Analyst")],
    );

    expect(result.total).toBe(2); // sample filtered out
    expect(result.items.map((j) => j.id)).toEqual(["strong", "other"]); // best match first
    expect(result.items[0]!.match_score).toBeGreaterThan(result.items[1]!.match_score ?? 0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it("returns a stable empty page for a query that matches nothing", () => {
    const result: Paginated<JobWithRelations> = runJobQuery(
      [makeJobWithRelations()],
      q({ q: "no-such-job-anywhere" }),
      null,
      null,
      [],
    );
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 12 });
  });
});
