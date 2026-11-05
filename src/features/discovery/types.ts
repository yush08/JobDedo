import type {
  EmploymentType,
  ExperienceLevel,
  ID,
  IsoDateTime,
  JobRequirements,
  JobSource,
  WorkModel,
} from "@/types";

/**
 * Discovery domain types (Milestone 2).
 *
 * `JobDraft` is the single normalisation target: every source adapter maps its
 * raw payload into this shape, and the data layer persists it. Fields a source
 * does not publish stay empty (`""`) or `null` — a draft never contains an
 * invented deadline, salary, link or eligibility claim.
 */

/** Company identity as published by a source. */
export interface CompanyDraft {
  /** Display name exactly as the source publishes it. */
  name: string;
  /** Registrable domain when derivable from a published URL, else "". */
  domain: string;
  /** Official website when the source publishes one, else "". */
  official_website_url: string;
  /** Company careers page when the source publishes one, else "". */
  careers_page_url: string;
  /** Industry when the source publishes one, else "". */
  industry: string;
}

export interface JobDraft {
  /** Adapter key that produced this listing (`greenhouse`, `lever`, `ashby`). */
  source_key: string;
  /** Human-readable source name for the `job_sources` row. */
  source_name: string;
  /** Base URL of the source platform for the `job_sources` row. */
  source_base_url: string;
  /** How the source classifies itself in `job_sources.kind`. */
  source_kind: JobSource["kind"];
  /** External identifier from the source (required for dedupe). */
  source_job_id: string;

  company: CompanyDraft;
  title: string;
  /** Plain text (HTML stripped by the normaliser). */
  description: string;
  city: string;
  country: string;
  location_text: string;
  work_model: WorkModel;
  employment_type: EmploymentType;
  experience_level: ExperienceLevel;
  role_tags: string[];
  skills: string[];
  requirements: JobRequirements;

  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: "month" | "year" | "one_time";
  stipend_amount: number | null;
  duration_days: number | null;

  /** Listing URL exactly as published (original, unmodified). */
  original_url: string;
  /** Normalised form used for deduplication. */
  canonical_url: string;
  /** Official application URL when the source publishes one, else "". */
  application_url: string;

  /** Employer posting timestamp when published, else null. */
  posted_at: IsoDateTime | null;
  /** Application deadline when published as a date, else null. */
  closing_date: string | null;
}

/** A raw JSON object exactly as the source returned it (pre-validation). */
export type RawListing = Record<string, unknown>;

/** Discovery-run context attached to every persisted sighting. */
export interface IngestJobContext {
  /** Run id that produced this sighting. */
  run_id: ID;
  /** When the source was queried. */
  seen_at: IsoDateTime;
  /** Row write timestamp. */
  now: IsoDateTime;
}

export interface AdapterFailure {
  /** Board token / company slug / board name the failure belongs to. */
  target: string;
  error: string;
}

export interface AdapterFetchResult {
  source_key: string;
  /** Raw listings that passed shape validation at the adapter boundary. */
  listings: RawListing[];
  /** Per-target failures — one broken board never fails the whole source. */
  failures: AdapterFailure[];
  /** Number of HTTP requests actually made (budget accounting). */
  requests: number;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface AdapterContext {
  fetchImpl: FetchLike;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Optional cancellation (run timeout / shutdown). */
  signal?: AbortSignal;
  /**
   * Shared request budget for the whole run. Adapters decrement it before
   * each HTTP request and stop fetching when it is exhausted, so a run can
   * never issue more requests than configured.
   */
  budget?: { remaining: number };
}

/** Result of validating + normalising one raw listing. */
export type NormaliseResult =
  | { ok: true; draft: JobDraft }
  | { ok: false; error: string };

export interface SourceAdapter {
  key: string;
  name: string;
  /** True when the adapter is implemented AND has at least one target. */
  enabled: boolean;
  /** Human-readable status shown in the UI (never claims work it cannot do). */
  status: string;
  /** Configured targets (board tokens / company slugs / board names). */
  targets: string[];
  /** Fetch every configured target; partial failures are reported, not thrown. */
  fetchAll(ctx: AdapterContext): Promise<AdapterFetchResult>;
  /** Validate + normalise a raw listing into a `JobDraft`. */
  normalise(raw: RawListing): NormaliseResult;
}
