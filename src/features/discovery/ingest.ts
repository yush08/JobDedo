import type { ID, IsoDateTime, Job, JobSourceLink } from "@/types";
import type { IngestJobContext, JobDraft } from "./types";
import { primaryDedupeKey } from "./dedupe";

/**
 * Draft → row mapping for discovery ingestion.
 *
 * Two operations only:
 *   createJobFromDraft  — first sighting of a vacancy
 *   mergeDiscoveredJob  — a later sighting of a vacancy we already stored
 *
 * Merging is strictly non-destructive: `first_discovered_at`, verification
 * state, `job_status`, `is_sample` and the primary identity fields are never
 * touched, published values are never replaced by nulls, and every original
 * source link is preserved in `source_links`.
 */

export interface IngestContext extends IngestJobContext {
  company_id: ID;
  source_id: ID | null;
}

/** Record a sighting without ever dropping a previously seen source link. */
function upsertSourceLink(
  links: JobSourceLink[],
  draft: JobDraft,
  seenAt: IsoDateTime,
): JobSourceLink[] {
  const next = [...links];
  const index = next.findIndex(
    (link) => link.source_key === draft.source_key && link.url === draft.original_url,
  );
  if (index >= 0) {
    next[index] = { ...next[index]!, last_seen_at: seenAt };
    return next;
  }
  next.push({
    source_key: draft.source_key,
    url: draft.original_url,
    source_job_id: draft.source_job_id,
    first_seen_at: seenAt,
    last_seen_at: seenAt,
  });
  return next;
}

export function createJobFromDraft(draft: JobDraft, ctx: IngestContext): Job {
  return {
    id: crypto.randomUUID(),
    company_id: ctx.company_id,
    source_id: ctx.source_id,
    title: draft.title,
    role_tags: draft.role_tags,
    description: draft.description,
    city: draft.city,
    country: draft.country,
    location_text: draft.location_text,
    work_model: draft.work_model,
    employment_type: draft.employment_type,
    experience_level: draft.experience_level,
    salary_min: draft.salary_min,
    salary_max: draft.salary_max,
    salary_currency: draft.salary_currency,
    salary_period: draft.salary_period,
    stipend_amount: draft.stipend_amount,
    duration_days: draft.duration_days,
    skills: draft.skills,
    requirements: draft.requirements,
    original_url: draft.original_url,
    canonical_url: draft.canonical_url,
    application_url: draft.application_url,
    source_job_id: draft.source_job_id,
    dedupe_key: primaryDedupeKey(draft),
    source_links: upsertSourceLink([], draft, ctx.seen_at),
    posted_at: draft.posted_at,
    closing_date: draft.closing_date,
    first_discovered_at: ctx.seen_at,
    last_discovered_at: ctx.seen_at,
    last_discovery_run_id: ctx.run_id,
    last_checked_at: null,
    last_verified_at: null,
    next_check_at: null,
    verification_status: "UNVERIFIED",
    verification_confidence: 0,
    // M3 fields - default to honest unknown/empty states.
    official_company_website_url: "",
    official_company_website_status: "not_checked" as const,
    official_careers_url: "",
    official_careers_status: "not_checked" as const,
    exact_official_job_url: "",
    exact_job_match_status: "not_checked" as const,
    direct_application_url: "",
    application_url_status: "not_checked" as const,
    deadline_status: "not_specified",
    deadline_evidence_url: "",
    // The source is actively listing this vacancy right now — that is the
    // only claim being made; the verification engine owns every later change.
    job_status: "open",
    is_sample: false,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
}

/** Union of two string lists, deduplicated case-insensitively (never loses stored items). */
function preferList(draft: string[], stored: string[]): string[] {
  const out = stored.filter((item) => item.trim().length > 0);
  const seen = new Set(out.map((item) => item.trim().toLowerCase()));
  for (const item of draft) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function preferText(draft: string, stored: string): string {
  return draft.trim() ? draft : stored;
}

/** Merge a fresh sighting into an existing row. Never erases known facts. */
export function mergeDiscoveredJob(
  existing: Job,
  draft: JobDraft,
  ctx: IngestContext,
): Job {
  const locationChanged =
    Boolean(draft.location_text) && draft.location_text !== existing.location_text;
  const draftPublishesSalary = draft.salary_min !== null || draft.salary_max !== null;

  return {
    ...existing,
    // Content the source re-published wins; empties never overwrite facts.
    title: preferText(draft.title, existing.title),
    role_tags: preferList(draft.role_tags, existing.role_tags),
    description: preferText(draft.description, existing.description),
    city: preferText(draft.city, existing.city),
    country: preferText(draft.country, existing.country),
    location_text: preferText(draft.location_text, existing.location_text),
    work_model: locationChanged ? draft.work_model : existing.work_model,
    // `unknown` from a later sighting must not erase a value we do know.
    employment_type:
      draft.employment_type !== "unknown" ? draft.employment_type : existing.employment_type,
    experience_level:
      draft.experience_level !== "unknown" ? draft.experience_level : existing.experience_level,
    salary_min: draft.salary_min ?? existing.salary_min,
    salary_max: draft.salary_max ?? existing.salary_max,
    salary_currency: draft.salary_currency || existing.salary_currency,
    salary_period: draftPublishesSalary ? draft.salary_period : existing.salary_period,
    stipend_amount: draft.stipend_amount ?? existing.stipend_amount,
    duration_days: draft.duration_days ?? existing.duration_days,
    skills: preferList(draft.skills, existing.skills),
    requirements: {
      required_skills: preferList(
        draft.requirements.required_skills,
        existing.requirements.required_skills,
      ),
      preferred_skills: preferList(
        draft.requirements.preferred_skills,
        existing.requirements.preferred_skills,
      ),
      responsibilities: preferList(
        draft.requirements.responsibilities,
        existing.requirements.responsibilities,
      ),
      eligibility: preferText(draft.requirements.eligibility, existing.requirements.eligibility),
      experience_text: preferText(
        draft.requirements.experience_text,
        existing.requirements.experience_text,
      ),
      benefits: preferList(draft.requirements.benefits, existing.requirements.benefits),
      about_company: preferText(
        draft.requirements.about_company,
        existing.requirements.about_company,
      ),
    },
    original_url: existing.original_url || draft.original_url,
    canonical_url: existing.canonical_url || draft.canonical_url,
    application_url: preferText(draft.application_url, existing.application_url),
    source_links: upsertSourceLink(existing.source_links, draft, ctx.seen_at),
    posted_at: draft.posted_at ?? existing.posted_at,
    closing_date: draft.closing_date ?? existing.closing_date,
    last_discovered_at: ctx.seen_at,
    last_discovery_run_id: ctx.run_id,
    // first_discovered_at, verification fields, job_status, is_sample,
    // dedupe_key, source_id, company_id, id and created_at stay untouched.
    updated_at: ctx.now,
  };
}
