import type { Job } from "@/types";
import type { JobDraft } from "./types";
import { slug, squash } from "./normalize";

/**
 * Deduplication rules (Milestone 2).
 *
 * A listing is the SAME vacancy when any of these hold:
 *   1. same source + same external id          (`source|external_id`)
 *   2. same canonical URL (tracking stripped)
 *   3. same company + same title + same location (the classic composite key)
 *   4. near-identical titles at the same company AND location, but only when
 *      the descriptions are substantial and agree — similar titles alone
 *      NEVER merge two rows.
 *
 * Every rule is conservative on purpose: merging two genuinely different
 * vacancies is worse than showing a duplicate, because the loser's original
 * link becomes unreachable.
 */

/** Primary stored key for a draft (the value written to `jobs.dedupe_key`). */
export function primaryDedupeKey(draft: JobDraft): string {
  return `${draft.source_key}|${draft.source_job_id}`;
}

/** Composite company|title|location key (cross-source identity). */
export function compositeDedupeKey(draft: JobDraft): string {
  return [
    slug(draft.company.name),
    slug(draft.title),
    slug(draft.city || draft.location_text),
  ].join("|");
}

/** Every key under which this draft may already exist as a stored row. */
export function candidateDedupeKeys(draft: JobDraft): string[] {
  const primary = primaryDedupeKey(draft);
  const composite = compositeDedupeKey(draft);
  return primary === composite ? [primary] : [primary, composite];
}

/**
 * Find the stored row this draft refers to.
 * `companyNameById` lets us recompute the composite key for rows whose stored
 * key came from a different source.
 */
export function findExistingJob(
  jobs: readonly Job[],
  draft: JobDraft,
  companyNameById: ReadonlyMap<string, string>,
): Job | null {
  const candidates = candidateDedupeKeys(draft);
  const sourceLinkMatch = (job: Job) =>
    job.source_links.some(
      (link) =>
        link.source_key === draft.source_key &&
        link.source_job_id === draft.source_job_id,
    );

  for (const job of jobs) {
    if (job.is_sample) continue; // sample rows are never targets of ingestion
    if (job.dedupe_key && candidates.includes(job.dedupe_key)) return job;
    if (job.canonical_url && job.canonical_url === draft.canonical_url) return job;
    if (sourceLinkMatch(job)) return job;
    const company = companyNameById.get(job.company_id);
    if (company && compositeKeyOf(job, company) === compositeDedupeKey(draft)) {
      return job;
    }
  }
  return null;
}

function compositeKeyOf(job: Job, companyName: string): string {
  return [slug(companyName), slug(job.title), slug(job.city || job.location_text)].join("|");
}

/* ------------------------------------------------------------------ */
/* Within-run similarity                                               */
/* ------------------------------------------------------------------ */

function tokens(value: string): Set<string> {
  return new Set(
    slug(value)
      .split("-")
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Title similarity in [0,1] over word tokens. */
export function titleSimilarity(a: string, b: string): number {
  return jaccard(tokens(a), tokens(b));
}

/** Description similarity in [0,1]; short texts are treated as no evidence. */
export function descriptionSimilarity(a: string, b: string): number {
  const left = squash(a);
  const right = squash(b);
  if (left.length < 80 || right.length < 80) return 0;
  return jaccard(tokens(left), tokens(right));
}

/**
 * Would these two raw listings collapse into one row? Used to dedupe inside a
 * single run before anything is persisted (and to prove idempotency in tests).
 */
export function isSameVacancy(a: JobDraft, b: JobDraft): boolean {
  if (a.source_key === b.source_key && a.source_job_id === b.source_job_id) return true;
  if (a.canonical_url && a.canonical_url === b.canonical_url) return true;
  if (slug(a.company.name) !== slug(b.company.name)) return false;
  if (slug(a.city || a.location_text) !== slug(b.city || b.location_text)) return false;
  if (slug(a.title) === slug(b.title)) return true;
  // Near-identical titles: require the descriptions to agree as well, so two
  // genuinely different roles with similar titles stay separate.
  return (
    titleSimilarity(a.title, b.title) >= 0.9 &&
    descriptionSimilarity(a.description, b.description) >= 0.75
  );
}
