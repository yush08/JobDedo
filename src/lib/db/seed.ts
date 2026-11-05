import type {
  Company,
  Job,
  JobPreferences,
  JobSource,
  JobVerification,
  ID,
  IsoDateTime,
  ResumeArtifact,
  ResumeCompilation,
  ResumeProject,
  ResumeSourceVersion,
} from "@/types";
import type { Collections } from "@/lib/db/types";
import { computeConfidence } from "@/features/verification/confidence";

/**
 * No fictional seeded jobs are included in the production dataset.
 * 
 * Previously, `buildSeedCollections` created 12 fictional companies
 * (`*.example` domains) and 12 sample jobs (`is_sample: true`) that appeared
 * in the UI even when no real discovery run had occurred. That automatic
 * seeding behavior has been removed. A fresh local-store instance will now
 * show an honest empty state until a real discovery run produces listings.
 * 
 * Test fixtures remain inside automated tests only.
 */

/* ------------------------------------------------------------------ */
/* Company seed — intentionally left empty so the local store starts */
/* without fictional companies.  Real companies come from discovery.   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Job seed — intentionally left empty so the local store starts      */
/* without fictional jobs.  Real jobs come from discovery runs.       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Sources — unsupported sources are registered with a clear reason.  */
/* ------------------------------------------------------------------ */

export const SAMPLE_SOURCE_KEYS = [
  { key: "internshala", name: "Internshala", base_url: "https://internshala.com", id: "00000000-0000-4000-8000-0000000000a1", kind: "job_board" as const, enabled: false, last_run_at: null },
  { key: "linkedin", name: "LinkedIn Jobs", base_url: "https://linkedin.com/jobs", id: "00000000-0000-4000-8000-0000000000a2", kind: "job_board" as const, enabled: false, last_run_at: null },
  { key: "naukri", name: "Naukri", base_url: "https://naukri.com", id: "00000000-0000-4000-8000-0000000000a3", kind: "job_board" as const, enabled: false, last_run_at: null },
  { key: "indeed", name: "Indeed", base_url: "https://indeed.com", id: "00000000-0000-4000-8000-0000000000a4", kind: "job_board" as const, enabled: false, last_run_at: null },
  { key: "unstop", name: "Unstop", base_url: "https://unstop.com", id: "00000000-0000-4000-8000-0000000000a5", kind: "job_board" as const, enabled: false, last_run_at: null },
] as const;

/** Source keys that have no permitted public feed. */
export const UNSUPPORTED_SOURCE_KEYS = new Set([
  "internshala",
  "linkedin",
  "naukri",
  "indeed",
]);

/** Source keys that have a permitted public feed (Milestone 2). */
export const SUPPORTED_SOURCE_KEYS = [
  "greenhouse",
  "lever",
  "ashby",
] as const;

/** Build a completely empty local dataset (no sample jobs, no fictional companies). */
export function buildEmptyCollections(profileId: ID): Omit<Collections, "profile"> {
  return {
    education: [],
    skills: [],
    projects: [],
    experiences: [],
    leadership: [],
    certifications: [],
    roles: [
      { id: "00000000-0000-4000-8000-0000000000b1", profile_id: profileId, role: "Data Analyst", is_custom: false, priority: 0 },
      { id: "00000000-0000-4000-8000-0000000000b2", profile_id: profileId, role: "Data Scientist", is_custom: false, priority: 1 },
      { id: "00000000-0000-4000-8000-0000000000b3", profile_id: profileId, role: "Software Developer", is_custom: false, priority: 2 },
    ],
    preferences: defaultPreferences(profileId),
    companies: [],
    sources: buildEmptySources(),
    jobs: [],
    verifications: [],
    verificationHistory: [],
    matches: [],
    savedJobs: [],
    discoveryRuns: [],
    applications: [],
    resumes: [],
    resumeVersions: [],
    resumeProjects: [],
    resumeSourceVersions: [],
    resumeCompilations: [],
    resumeArtifacts: [],
    atsReports: [],
    recruiters: [],
    emailDrafts: [],
    notifications: [],
    integrations: [],
  };
}

export function buildEmptySources(): (typeof SAMPLE_SOURCE_KEYS)[number][] {
  return SAMPLE_SOURCE_KEYS.map((s) => ({
    id: `00000000-0000-4000-8000-0000000000a${SAMPLE_SOURCE_KEYS.indexOf(s) + 1}`,
    key: s.key,
    name: s.name,
    base_url: s.base_url,
    kind: "job_board" as const,
    enabled: false,
    last_run_at: null,
    last_status: "not_run" as const,
    last_message: "Not integrated — no permitted public feed (see docs/discovery-sources.md).",
  }));
}

export function defaultPreferences(profileId: ID): JobPreferences {
  const now: IsoDateTime = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    profile_id: profileId,
    employment_types: ["internship", "full_time"],
    experience_levels: ["student", "fresher", "entry_level", "0_1_years"],
    custom_experience_range: "",
    locations: ["India", "Worldwide remote"],
    work_models: ["remote", "hybrid"],
    prefer_internship_duration_days: 60,
    paid_internship_only: false,
    min_stipend: null,
    min_salary: null,
    compensation_flexible: true,
    required_skills: [],
    preferred_technologies: [],
    industries: [],
    company_size: "any",
    company_stage: "any",
    application_deadline_within_days: null,
    excluded_companies: [],
    excluded_roles: [],
    search_frequency_hours: 24,
    updated_at: now,
  };
}

export const DEFAULT_PROFILE_ID =
  "00000000-0000-4000-8000-000000000001" as const;