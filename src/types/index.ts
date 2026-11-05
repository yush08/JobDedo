/**
 * JobDedo domain types.
 *
 * Every type here mirrors a row shape in Supabase (see supabase/migrations)
 * or an entry in the local JSON store used when Supabase is not configured.
 * All timestamps are UTC ISO-8601 strings.
 */

export type ID = string;
export type IsoDateTime = string; // UTC, e.g. 2026-11-03T09:00:00.000Z
export type IsoDate = string; // YYYY-MM-DD

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/**
 * `unknown` exists so a source that does not publish a field can be stored
 * honestly (Milestone 2 normalisation) instead of being given a made-up value.
 */
export const EMPLOYMENT_TYPES = [
  "internship",
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "unknown",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Employment types a user can *prefer* — excludes the honesty sentinel. */
export const PREFERRED_EMPLOYMENT_TYPES = [
  "internship",
  "full_time",
  "part_time",
  "contract",
  "freelance",
] as const;

export const WORK_MODELS = ["remote", "hybrid", "onsite"] as const;
export type WorkModel = (typeof WORK_MODELS)[number];

/** Levels a user can *prefer* — excludes the honesty sentinel `unknown`. */
export const PREFERRED_EXPERIENCE_LEVELS = [
  "student",
  "fresher",
  "entry_level",
  "0_1_years",
  "1_2_years",
  "custom",
] as const;

export const EXPERIENCE_LEVELS = [
  "student",
  "fresher",
  "entry_level",
  "0_1_years",
  "1_2_years",
  "custom",
  "unknown",
] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const VERIFICATION_STATUSES = [
  "VERIFIED",
  "NEEDS_REVIEW",
  "UNVERIFIED",
  "CLOSED",
  "EXPIRED",
  "INVALID",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Employer job status shown on the job card and details. */
export const JOB_STATUSES = ["open", "closed", "removed", "unknown"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Check results for a verification probe. */
export const CHECK_RESULTS = [
  "confirmed",
  "uncertain",
  "not_found",
  "failed",
  "conflict",
  "not_checked",
] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

/** Deadline validation status. */
export const DEADLINE_STATUSES = [
  "valid",
  "expired",
  "not_specified",
  "uncertain",
] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

/** Link check status for application URLs and company/careers pages. */
export const LINK_STATUSES = [
  "working",
  "broken",
  "redirected",
  "unable_to_check",
  "not_checked",
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** Exact official job listing match status. */
export const EXACT_JOB_STATUSES = [
  "confirmed_official",
  "confirmed_platform",
  "not_found_official",
  "unable_to_verify",
  "conflicting",
  "not_checked",
] as const;
export type ExactJobStatus = (typeof EXACT_JOB_STATUSES)[number];

export const APPLICATION_STAGES = [
  "discovered",
  "shortlisted",
  "resume_prepared",
  "ready_for_approval",
  "applied",
  "recruiter_contacted",
  "interview",
  "rejected",
  "offer",
  "withdrawn",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const SAMPLE_ROLES = [
  "Data Analyst",
  "Data Scientist",
  "Software Developer",
  "AI/ML Engineer",
  "Cloud Engineer",
  "UI/UX Designer",
  "Business Analyst",
] as const;

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export interface Education {
  id: ID;
  profile_id: ID;
  institution: string;
  degree: string;
  branch: string;
  start_date: IsoDate;
  graduation_date: IsoDate;
  cgpa: string;
  coursework: string[];
  sort_order: number;
}

export interface CandidateSkill {
  id: ID;
  profile_id: ID;
  category: SkillCategory;
  name: string;
  level: "beginner" | "intermediate" | "advanced";
  years: number | null;
}

export const SKILL_CATEGORIES = [
  "programming_languages",
  "frameworks",
  "databases",
  "cloud",
  "tools",
  "soft_skills",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export interface Project {
  id: ID;
  profile_id: ID;
  title: string;
  description: string;
  technologies: string[];
  responsibilities: string[];
  achievements: string[];
  metrics: string;
  github_url: string;
  live_demo_url: string;
  sort_order: number;
}

export interface Experience {
  id: ID;
  profile_id: ID;
  organization: string;
  role: string;
  start_date: IsoDate;
  end_date: IsoDate;
  responsibilities: string[];
  achievements: string[];
  sort_order: number;
}

export interface Leadership {
  id: ID;
  profile_id: ID;
  organization: string;
  position: string;
  start_date: IsoDate;
  end_date: IsoDate;
  contributions: string[];
  sort_order: number;
}

export interface Certification {
  id: ID;
  profile_id: ID;
  name: string;
  issuer: string;
  issued_date: IsoDate;
  credential_url: string;
  sort_order: number;
}

export interface PersonalInfo {
  full_name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  headline: string;
  summary: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  other_links: { label: string; url: string }[];
}

export interface ProfileData {
  id: ID;
  personal: PersonalInfo;
  education: Education[];
  skills: CandidateSkill[];
  projects: Project[];
  experiences: Experience[];
  leadership: Leadership[];
  certifications: Certification[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export interface RolePreference {
  id: ID;
  profile_id: ID;
  role: string;
  is_custom: boolean;
  priority: number;
}

export interface JobPreferences {
  id: ID;
  profile_id: ID;
  employment_types: EmploymentType[];
  experience_levels: ExperienceLevel[];
  custom_experience_range: string;
  locations: string[];
  work_models: WorkModel[];
  prefer_internship_duration_days: number;
  paid_internship_only: boolean;
  min_stipend: number | null;
  min_salary: number | null;
  compensation_flexible: boolean;
  required_skills: string[];
  preferred_technologies: string[];
  industries: string[];
  company_size: string;
  company_stage: "any" | "startup" | "established";
  application_deadline_within_days: number | null;
  excluded_companies: string[];
  excluded_roles: string[];
  search_frequency_hours: number;
  updated_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Companies & sources                                                 */
/* ------------------------------------------------------------------ */

export interface Company {
  id: ID;
  name: string;
  domain: string;
  official_website_url: string;
  website_status: CheckResult;
  careers_page_url: string;
  careers_discovery_method: string;
  careers_evidence_url: string;
  careers_status: CheckResult;
  description: string;
  logo_url: string;
  industry: string;
  size_bucket: string;
  last_checked_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export interface JobSource {
  id: ID;
  key: string;
  name: string;
  base_url: string;
  kind: "job_board" | "company_careers" | "ats_api" | "feed";
  enabled: boolean;
  last_run_at: IsoDateTime | null;
  last_status: "success" | "partial" | "failure" | "not_run";
  last_message: string;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export interface JobRequirements {
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  eligibility: string;
  experience_text: string;
  benefits: string[];
  about_company: string;
}

export interface JobSourceLink {
  /** Adapter key that produced this sighting (`greenhouse`, `lever`, …). */
  source_key: string;
  /** Listing URL exactly as the source published it. */
  url: string;
  /** External identifier used by that source. */
  source_job_id: string;
  first_seen_at: IsoDateTime;
  last_seen_at: IsoDateTime;
}

export interface Job {
  id: ID;
  company_id: ID;
  source_id: ID | null;
  title: string;
  role_tags: string[];
  description: string;
  city: string;
  country: string;
  location_text: string;
  work_model: WorkModel;
  employment_type: EmploymentType;
  experience_level: ExperienceLevel;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: "month" | "year" | "one_time";
  stipend_amount: number | null;
  duration_days: number | null;
  skills: string[];
  requirements: JobRequirements;
  original_url: string;
  /** Tracking-stripped, normalised form of `original_url` used for dedupe. */
  canonical_url: string;
  application_url: string;
  source_job_id: string;
  dedupe_key: string;
  /** Every source this vacancy was seen on (merged duplicates keep their links). */
  source_links: JobSourceLink[];
  posted_at: IsoDateTime | null;
  closing_date: IsoDate | null;
  first_discovered_at: IsoDateTime;
  /** Timestamp of the most recent discovery run that saw this listing. */
  last_discovered_at: IsoDateTime | null;
  /** Run id of the most recent discovery run that saw this listing. */
  last_discovery_run_id: ID | null;
  last_checked_at: IsoDateTime | null;
  last_verified_at: IsoDateTime | null;
  next_check_at: IsoDateTime | null;
  verification_status: VerificationStatus;
  verification_confidence: number;
  job_status: JobStatus;
  is_sample: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  // M3: Official company website evidence.
  official_company_website_url: string;
  official_company_website_status: LinkStatus;
  // M3: Official careers page evidence.
  official_careers_url: string;
  official_careers_status: LinkStatus;
  // M3: Exact official job listing on employer-controlled source.
  exact_official_job_url: string;
  exact_job_match_status: ExactJobStatus;
  // M3: Direct application link evidence.
  direct_application_url: string;
  application_url_status: LinkStatus;
  // M3: Deadline tracking.
  deadline_status: DeadlineStatus;
  deadline_evidence_url: string;
}

export interface JobWithRelations extends Job {
  company: Company | null;
  source: JobSource | null;
  saved: boolean;
  match_score: number | null;
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export interface ConfidenceBreakdown {
  official_source: number;
  application_link: number;
  active_status: number;
  company_identity: number;
  content_consistency: number;
  freshness: number;
  total: number;
}

export interface JobVerification {
  id: ID;
  job_id: ID;
  company_website_url: string;
  website_status: CheckResult;
  careers_page_url: string;
  careers_status: CheckResult;
  careers_discovery_method: string;
  careers_evidence_url: string;
  exact_job_status: ExactJobStatus;
  /** URL of the exact listing found on the official careers page, when found. */
  exact_job_url: string;
  deadline_status: DeadlineStatus;
  job_status: JobStatus;
  application_link_status: LinkStatus;
  confidence_score: number;
  confidence_breakdown: ConfidenceBreakdown;
  notes: string;
  checked_at: IsoDateTime | null;
  verified_at: IsoDateTime | null;
  updated_at: IsoDateTime;
}

export interface VerificationHistoryEntry {
  id: ID;
  job_id: ID;
  check_type: string;
  result: CheckResult;
  evidence_url: string;
  notes: string;
  source: string;
  created_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export interface MatchBreakdown {
  technical_skills: number;
  projects: number;
  role_alignment: number;
  education: number;
  experience: number;
  location: number;
  additional: number;
}

export interface JobMatch {
  id: ID;
  job_id: ID;
  profile_id: ID;
  score: number;
  breakdown: MatchBreakdown;
  matched_skills: string[];
  missing_skills: string[];
  relevant_projects: string[];
  eligibility_warnings: string[];
  recommendations: string[];
  created_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

export type DiscoveryRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface DiscoveryRun {
  id: ID;
  profile_id: ID;
  status: DiscoveryRunStatus;
  trigger: "manual" | "dashboard_stale" | "schedule";
  queries: string[];
  checkpoint: Record<string, unknown>;
  pages_fetched: number;
  found_count: number;
  new_count: number;
  duplicate_count: number;
  error: string;
  started_at: IsoDateTime;
  finished_at: IsoDateTime | null;
}

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

export interface ApplicationEvent {
  id: ID;
  application_id: ID;
  from_stage: ApplicationStage | null;
  to_stage: ApplicationStage;
  note: string;
  created_at: IsoDateTime;
}

export interface Application {
  id: ID;
  profile_id: ID;
  job_id: ID | null;
  company_name: string;
  job_title: string;
  original_url: string;
  application_url: string;
  match_score: number | null;
  verification_status_at_apply: VerificationStatus | null;
  resume_version_id: ID | null;
  email_draft_id: ID | null;
  applied_at: IsoDateTime | null;
  stage: ApplicationStage;
  notes: string;
  follow_up_at: IsoDateTime | null;
  interview_at: IsoDateTime | null;
  interview_details: string;
  events: ApplicationEvent[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Resume / ATS / Outreach (Milestone 5-6 schemas)                     */
/* ------------------------------------------------------------------ */

export interface Resume {
  id: ID;
  profile_id: ID;
  title: string;
  storage_path: string;
  bucket: string;
  source: "upload" | "generated";
  current_version_id: ID | null;
  original_file_path: string | null;
  original_file_name: string | null;
  original_file_type: string | null;
  created_at: IsoDateTime;
}

export interface ResumeVersion {
  id: ID;
  resume_id: ID;
  profile_id: ID;
  version_number: number;
  raw_text: string;
  parsed: Record<string, unknown> | null;
  tailored_for_job_id: ID | null;
  created_at: IsoDateTime;
}

export interface AtsReport {
  id: ID;
  resume_version_id: ID;
  job_id: ID | null;
  document_quality: number;
  job_coverage: number;
  evidence_alignment: number;
  report: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface Recruiter {
  id: ID;
  company_id: ID | null;
  name: string;
  title: string;
  linkedin_url: string;
  email: string;
  contact_page_url: string;
  evidence_url: string;
  verification_status: "public_confirmed" | "uncertain" | "not_found";
  notes: string;
  created_at: IsoDateTime;
}

export interface EmailDraft {
  id: ID;
  profile_id: ID;
  job_id: ID | null;
  recruiter_id: ID | null;
  draft_type:
    | "internship_outreach"
    | "recruiter_intro"
    | "hiring_manager_intro"
    | "follow_up"
    | "referral_request"
    | "thank_you";
  subject: string;
  body: string;
  status: "draft" | "approved" | "sent";
  created_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Notifications & integrations                                        */
/* ------------------------------------------------------------------ */

export interface AppNotification {
  id: ID;
  type:
    | "strong_match"
    | "deadline"
    | "job_closed"
    | "verification_change"
    | "follow_up"
    | "discovery_failure";
  title: string;
  body: string;
  link: string;
  read_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export interface IntegrationAccount {
  id: ID;
  provider: string;
  kind: "ai" | "email";
  status: "connected" | "not_configured" | "error";
  config: Record<string, string>;
  created_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* API envelope                                                        */
/* ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiErrorBody["error"] };

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ */
/* Resume Studio - Project & Compilation (Milestone 5-6 extended)     */
/* ------------------------------------------------------------------ */

export interface ResumeProject {
  id: ID;
  profile_id: ID;
  name: string;
  original_resume_id: ID | null;
  active_version_id: ID | null;
  template_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ResumeSourceVersion {
  id: ID;
  project_id: ID;
  version_number: number;
  latex_source: string;
  structured_content: Record<string, unknown> | null;
  template_id: string;
  created_at: IsoDateTime;
}

export interface ResumeCompilation {
  id: ID;
  project_id: ID;
  source_version_id: ID;
  status: "pending" | "success" | "failed";
  pdf_artifact_id: ID | null;
  log: string;
  warnings: string[];
  errors: string[];
  created_at: IsoDateTime;
  durationMs?: number;
}

export interface ResumeArtifact {
  id: ID;
  project_id: ID;
  compilation_id: ID | null;
  file_name: string;
  mime_type: string;
  storage_reference: string;
  content_hash: string;
  created_at: IsoDateTime;
}
