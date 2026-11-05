import { describe, expect, it } from "vitest";

import {
  candidateDedupeKeys,
  compositeDedupeKey,
  descriptionSimilarity,
  findExistingJob,
  isSameVacancy,
  primaryDedupeKey,
  titleSimilarity,
} from "@/features/discovery/dedupe";
import type { Job } from "@/types";
import type { JobDraft } from "@/features/discovery/types";
import { makeDraft, makeJob } from "./helpers";

/**
 * Deduplication contract (Milestone 2).
 *
 * Two properties are asserted everywhere:
 *  1. a listing that IS the same vacancy collapses (all original links kept);
 *  2. two genuinely different vacancies NEVER merge — especially when their
 *     titles merely look alike.
 */

const COMPANY_ID = "00000000-0000-4000-8000-0000000000c1";
const NAMES = new Map([[COMPANY_ID, "Northwind Analytics"]]);

/** A long, distinctive description — >80 chars so similarity has evidence. */
const LONG_DESCRIPTION =
  "Build and own the analytics pipelines that power weekly executive reporting " +
  "across the company, partnering closely with finance and operations teams to " +
  "turn raw event data into decisions the business can act on every single day.";

/** Substantial but topically unrelated — must never reach 0.75 similarity. */
const UNRELATED_DESCRIPTION =
  "Design and ship machine learning models for search ranking, working closely " +
  "with the infrastructure team to serve predictions at low latency worldwide " +
  "while keeping every training pipeline reproducible, monitored and documented.";

/**
 * A 10-token title: adding one token ("Remote") yields Jaccard 10/11 ≈ 0.91,
 * which clears the ≥0.9 similarity gate the merge rule requires.
 */
const LONG_TITLE =
  "Senior Data Analyst For Revenue Growth Analytics And Business Intelligence";

describe("dedupe keys", () => {
  it("builds the primary key from source + external id", () => {
    const draft = makeDraft({ source_key: "lever", source_job_id: "abc123" });
    expect(primaryDedupeKey(draft)).toBe("lever|abc123");
  });

  it("builds the composite key from company|title|city, slugified", () => {
    const draft = makeDraft();
    expect(compositeDedupeKey(draft)).toBe("northwind-analytics|data-analyst-intern|bengaluru");
    // City wins over the full location text when present…
    expect(
      compositeDedupeKey(makeDraft({ city: "", location_text: "Bengaluru, India" })),
    ).toBe("northwind-analytics|data-analyst-intern|bengaluru-india");
  });

  it("lists both candidate keys, collapsing to one when identical", () => {
    const draft = makeDraft();
    expect(candidateDedupeKeys(draft)).toEqual([
      "greenhouse|12345",
      "northwind-analytics|data-analyst-intern|bengaluru",
    ]);
    // A draft whose primary key happens to equal its composite yields one entry.
    const same = makeDraft({
      source_key: "northwind-analytics",
      source_job_id: "data-analyst-intern|bengaluru",
    });
    expect(candidateDedupeKeys(same)).toEqual([
      "northwind-analytics|data-analyst-intern|bengaluru",
    ]);
  });
});

describe("findExistingJob (stored-row lookup)", () => {
  const draft = makeDraft();

  it("matches a stored row by primary dedupe key", () => {
    const job = makeJob({ dedupe_key: "greenhouse|12345" });
    expect(findExistingJob([job], draft, NAMES)).toBe(job);
  });

  it("matches a stored row by canonical URL", () => {
    const job = makeJob({
      dedupe_key: "other-source|999",
      canonical_url: "https://job-boards.greenhouse.io/northwind/jobs/12345",
    });
    expect(findExistingJob([job], draft, NAMES)).toBe(job);
  });

  it("matches a stored row through a previously merged source link", () => {
    const job = makeJob({
      dedupe_key: "lever|old-id",
      canonical_url: "",
      source_links: [
        {
          source_key: "greenhouse",
          source_job_id: "12345",
          url: "https://job-boards.greenhouse.io/northwind/jobs/12345",
          first_seen_at: "2026-11-01T00:00:00.000Z",
          last_seen_at: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    expect(findExistingJob([job], draft, NAMES)).toBe(job);
  });

  it("matches a cross-source row by recomputing its composite key", () => {
    // The stored row came from Lever: different dedupe_key and URL, but the
    // same company|title|city — the classic cross-source duplicate.
    const job = makeJob({
      dedupe_key: "lever|abc123",
      canonical_url: "https://jobs.lever.co/northwind/abc123",
      title: "Data Analyst Intern",
      city: "Bengaluru",
      location_text: "Bengaluru, India",
    });
    expect(findExistingJob([job], draft, NAMES)).toBe(job);
  });

  it("never targets a sample row, even on an exact key match", () => {
    const sample = makeJob({
      is_sample: true,
      dedupe_key: "greenhouse|12345",
      canonical_url: "https://job-boards.greenhouse.io/northwind/jobs/12345",
    });
    expect(findExistingJob([sample], draft, NAMES)).toBeNull();
  });

  it("returns null when nothing matches (first sighting)", () => {
    const unrelated = makeJob({
      dedupe_key: "greenhouse|777",
      canonical_url: "https://job-boards.greenhouse.io/other/jobs/777",
      title: "Backend Engineer",
      city: "Pune",
      location_text: "Pune, India",
    });
    expect(findExistingJob([unrelated], draft, NAMES)).toBeNull();
    expect(findExistingJob([], draft, NAMES)).toBeNull();
  });

  it("ignores rows whose company name cannot be resolved", () => {
    // Same company|title|city as the draft, but no key/URL/link match and no
    // company name available to recompute the composite — the comparison must
    // be skipped, not guessed from an empty map.
    const job = makeJob({
      dedupe_key: "greenhouse|999",
      canonical_url: "",
      title: "Data Analyst Intern",
      city: "Bengaluru",
      location_text: "Bengaluru, India",
    });
    expect(findExistingJob([job], draft, new Map())).toBeNull();
  });
});

describe("isSameVacancy (within-run collapse)", () => {
  const base = makeDraft();

  /**
   * A fresh draft that can never match `base` by rule 1 (source|id) or
   * rule 2 (canonical URL), so tests reach the composite/similarity rules.
   */
  let seq = 0;
  const variant = (overrides: Partial<JobDraft> = {}) => {
    seq += 1;
    const url = `https://job-boards.greenhouse.io/northwind/jobs/v${seq}`;
    return makeDraft({
      source_job_id: `v${seq}`,
      original_url: url,
      canonical_url: url,
      ...overrides,
    });
  };

  it("collapses the same source + external id", () => {
    expect(isSameVacancy(base, makeDraft())).toBe(true);
    // Different id AND different canonical URL AND different title → no rule fires.
    expect(isSameVacancy(base, variant({ title: "Backend Engineer" }))).toBe(false);
  });

  it("collapses the same canonical URL across sources", () => {
    const other = makeDraft({
      source_key: "lever",
      source_job_id: "abc",
      canonical_url: base.canonical_url,
    });
    expect(isSameVacancy(base, other)).toBe(true);
  });

  it("collapses an identical company|title|location (composite rule)", () => {
    // Different source, id and URL — only the composite key matches.
    const other = variant({ source_key: "lever" });
    expect(isSameVacancy(base, other)).toBe(true);
  });

  it("keeps genuinely different vacancies apart", () => {
    expect(
      isSameVacancy(base, variant({ company: { ...base.company, name: "Vercel" } })),
    ).toBe(false);
    expect(isSameVacancy(base, variant({ title: "Backend Engineer" }))).toBe(false);
    expect(isSameVacancy(base, variant({ city: "Pune", location_text: "Pune, India" }))).toBe(
      false,
    );
  });

  it("never merges on similar titles alone when descriptions are short", () => {
    const a = makeDraft({ title: LONG_TITLE, description: "Short blurb about the role." });
    const b = variant({
      title: `${LONG_TITLE} Remote`,
      description: "Another short blurb about the role.",
    });
    expect(titleSimilarity(a.title, b.title)).toBeGreaterThanOrEqual(0.9);
    // Under 80 chars → zero evidence → no merge.
    expect(descriptionSimilarity(a.description, b.description)).toBe(0);
    expect(isSameVacancy(a, b)).toBe(false);
  });

  it("merges near-identical titles only when substantial descriptions agree", () => {
    const a = makeDraft({ title: LONG_TITLE, description: LONG_DESCRIPTION });
    const b = variant({
      source_key: "lever",
      title: `${LONG_TITLE} Remote`,
      description: LONG_DESCRIPTION,
    });
    expect(titleSimilarity(a.title, b.title)).toBeGreaterThanOrEqual(0.9);
    expect(descriptionSimilarity(a.description, b.description)).toBeGreaterThanOrEqual(0.75);
    expect(isSameVacancy(a, b)).toBe(true);
  });

  it("keeps similar titles apart when the descriptions disagree", () => {
    const a = makeDraft({ title: LONG_TITLE, description: LONG_DESCRIPTION });
    const b = variant({
      source_key: "lever",
      title: `${LONG_TITLE} Remote`,
      description: UNRELATED_DESCRIPTION,
    });
    expect(titleSimilarity(a.title, b.title)).toBeGreaterThanOrEqual(0.9);
    expect(descriptionSimilarity(a.description, b.description)).toBeLessThan(0.75);
    expect(isSameVacancy(a, b)).toBe(false);
  });

  it("requires BOTH company and location to agree for the similarity path", () => {
    const a = makeDraft({ title: LONG_TITLE, description: LONG_DESCRIPTION });
    const sameText = {
      title: `${LONG_TITLE} Remote`,
      description: LONG_DESCRIPTION,
    };
    expect(
      isSameVacancy(a, variant({ ...sameText, city: "Pune", location_text: "Pune, India" })),
    ).toBe(false);
    expect(
      isSameVacancy(a, variant({ ...sameText, company: { ...a.company, name: "Vercel" } })),
    ).toBe(false);
  });
});

describe("similarity metrics", () => {
  it("scores identical and disjoint texts", () => {
    expect(titleSimilarity("Data Analyst", "Data Analyst")).toBe(1);
    expect(titleSimilarity("Data Analyst", "Backend Engineer")).toBe(0);
  });

  it("treats short descriptions as no evidence", () => {
    expect(descriptionSimilarity("short", "short text about roles here")).toBe(0);
    expect(descriptionSimilarity("", "")).toBe(0);
  });

  it("scores substantial overlapping descriptions", () => {
    const text = LONG_DESCRIPTION;
    const edited = text.replace("executive", "weekly");
    expect(descriptionSimilarity(text, edited)).toBeGreaterThan(0.75);
    expect(descriptionSimilarity(text, text)).toBe(1);
  });
});

describe("candidate keys never collide across different vacancies", () => {
  it("produces distinct keys for distinct drafts", () => {
    const a = makeDraft();
    const b = makeDraft({
      source_job_id: "678",
      title: "Backend Engineer",
      city: "Pune",
      location_text: "Pune, India",
      canonical_url: "https://job-boards.greenhouse.io/northwind/jobs/678",
    });
    const keysA = new Set(candidateDedupeKeys(a));
    const keysB = candidateDedupeKeys(b);
    expect(keysB.some((k) => keysA.has(k))).toBe(false);
  });

  it("returns null for a row with no key, no URL and a different composite", () => {
    const draft = makeDraft();
    const job: Job = makeJob({
      dedupe_key: "",
      canonical_url: "",
      title: "Backend Engineer",
      city: "Pune",
      location_text: "Pune, India",
    });
    expect(findExistingJob([job], draft, NAMES)).toBeNull();
  });
});
