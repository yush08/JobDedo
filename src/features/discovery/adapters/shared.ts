import type {
  EmploymentType,
  JobSource,
  WorkModel,
} from "@/types";
import type { CompanyDraft, JobDraft, RawListing } from "../types";
import {
  canonicalizeUrl,
  employmentTypeFromText,
  experienceLevelFromText,
  extractRoleTags,
  extractSkills,
  parseCompensation,
  parseDescriptionSections,
  parseDurationDays,
  splitLocation,
} from "../normalize";

/* ------------------------------------------------------------------ */
/* Raw payload guards                                                  */
/* ------------------------------------------------------------------ */

/** Trimmed string, or null when the field is missing/empty/not a string. */
export function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Finite number (or numeric string), else null. */
export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function asRecord(value: unknown): RawListing | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawListing)
    : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* Shared draft assembly                                               */
/* ------------------------------------------------------------------ */

export interface DraftInput {
  source_key: string;
  source_name: string;
  source_base_url: string;
  source_kind: JobSource["kind"];
  source_job_id: string;
  company: CompanyDraft;
  title: string;
  description: string;
  /** Raw location string exactly as the source published it. */
  location_text: string;
  /** Country the source published separately (ISO-2 etc.), if any. */
  source_country?: string;
  /** Work model the source published explicitly, else derived from text. */
  work_model?: WorkModel;
  /** Employment type the source published explicitly, else "unknown". */
  employment_type?: EmploymentType;
  original_url: string;
  application_url: string;
  posted_at: string | null;
  closing_date: string | null;
}

/**
 * Field extraction every adapter shares: skills, role tags, sectioned
 * requirements, published compensation/duration, experience level.
 *
 * Inference only ever looks at text the source published, and anything the
 * text does not support stays `unknown` / `null` / `""`.
 */
export function assembleDraft(input: DraftInput): JobDraft {
  const location = splitLocation(input.location_text, {
    country: input.source_country,
    ...(input.work_model ? { workModel: input.work_model } : {}),
  });
  const text = `${input.title}\n${input.description}`;
  const sections = parseDescriptionSections(input.description);

  const employment_type: EmploymentType =
    input.employment_type && input.employment_type !== "unknown"
      ? input.employment_type
      : employmentTypeFromText(text);

  const pay = parseCompensation(text);
  const isInternship = employment_type === "internship";
  const stipend_amount = isInternship ? (pay?.min ?? null) : null;
  const duration_days = parseDurationDays(text);

  return {
    source_key: input.source_key,
    source_name: input.source_name,
    source_base_url: input.source_base_url,
    source_kind: input.source_kind,
    source_job_id: input.source_job_id,
    company: input.company,
    title: input.title,
    description: input.description,
    city: location.city,
    country: location.country,
    location_text: location.location_text,
    work_model: location.work_model,
    employment_type,
    experience_level: experienceLevelFromText(input.title, input.description),
    role_tags: extractRoleTags(input.title, input.description),
    skills: extractSkills(text),
    requirements: {
      required_skills: sections.required_skills,
      preferred_skills: sections.preferred_skills,
      responsibilities: sections.responsibilities,
      eligibility: sections.eligibility,
      experience_text: sections.experience_text,
      benefits: sections.benefits,
      about_company: "",
    },
    // Published money only; internships record it as a stipend, never as salary.
    salary_min: pay && !isInternship ? pay.min : null,
    salary_max: pay && !isInternship ? pay.max : null,
    salary_currency: pay ? pay.currency : "",
    salary_period: pay?.period ?? "month",
    stipend_amount,
    duration_days,
    original_url: input.original_url,
    canonical_url: canonicalizeUrl(input.original_url),
    application_url: input.application_url || input.original_url,
    posted_at: input.posted_at,
    closing_date: input.closing_date,
  };
}
