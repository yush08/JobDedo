import type {
  Application,
  AppNotification,
  Job,
  JobPreferences,
  JobWithRelations,
  PersonalInfo,
  ProfileData,
  RolePreference,
} from "@/types";
import type { JobDraft } from "@/features/discovery/types";

/**
 * Shared fixtures for JobDedo unit tests.
 *
 * Time-based helpers take an explicit clock where the code under test accepts
 * one (`computeConfidence`, `rateLimit`); otherwise values are derived from the
 * real `Date.now()` so relative assertions stay valid whenever tests run.
 */

export const NOW = Date.parse("2026-11-03T12:00:00.000Z");
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** ISO timestamp at `NOW + offsetMs` (fixed clock). */
export const isoAt = (offsetMs = 0): string => new Date(NOW + offsetMs).toISOString();

/** YYYY-MM-DD offset from the real current date. */
export const dateIn = (days: number): string =>
  new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export const PROFILE_ID = "00000000-0000-4000-8000-000000000001";

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: crypto.randomUUID(),
    company_id: "00000000-0000-4000-8000-0000000000c1",
    source_id: null,
    title: "Data Analyst Intern",
    role_tags: ["Data Analyst"],
    description: "Build dashboards and reports for the analytics team.",
    city: "Bengaluru",
    country: "India",
    location_text: "Bengaluru, India",
    work_model: "hybrid",
    employment_type: "internship",
    experience_level: "student",
    salary_min: null,
    salary_max: null,
    salary_currency: "INR",
    salary_period: "month",
    stipend_amount: 25_000,
    duration_days: 60,
    skills: ["python", "sql"],
    requirements: {
      required_skills: ["python", "sql"],
      preferred_skills: ["pandas"],
      responsibilities: ["Build dashboards"],
      eligibility: "Open to current students",
      experience_text: "0 years — internship",
      benefits: [],
      about_company: "",
    },
    original_url: "",
    canonical_url: "",
    application_url: "",
    source_job_id: "sample-test-1",
    dedupe_key: `sample|test|${crypto.randomUUID()}`,
    source_links: [],
    posted_at: new Date(Date.now() - 2 * DAY).toISOString(),
    closing_date: null,
    first_discovered_at: new Date(Date.now() - 2 * DAY).toISOString(),
    last_discovered_at: null,
    last_discovery_run_id: null,
    last_checked_at: null,
    last_verified_at: null,
    next_check_at: null,
    verification_status: "UNVERIFIED",
    verification_confidence: 0,
    job_status: "open",
    is_sample: false,
    created_at: isoAt(-2 * DAY),
    updated_at: isoAt(-2 * DAY),
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
  ...overrides,
  };
}

export function makeJobWithRelations(
  overrides: Partial<Job> = {},
  rel: Partial<Pick<JobWithRelations, "company" | "source" | "saved" | "match_score">> = {},
): JobWithRelations {
  return {
    ...makeJob(overrides),
    company: null,
    source: null,
    saved: false,
    match_score: null,
    ...rel,
  };
}

export function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  const id = PROFILE_ID;
  return {
    id,
    personal: makePersonal(),
    education: [
      {
        id: crypto.randomUUID(),
        profile_id: id,
        institution: "Test University",
        degree: "B.Tech",
        branch: "Computer Science",
        start_date: "2022-08-01",
        graduation_date: "2026-06-01",
        cgpa: "8.5",
        coursework: ["Statistics"],
        sort_order: 0,
      },
    ],
    skills: [
      {
        id: crypto.randomUUID(),
        profile_id: id,
        category: "programming_languages",
        name: "Python",
        level: "advanced",
        years: 3,
      },
      {
        id: crypto.randomUUID(),
        profile_id: id,
        category: "databases",
        name: "SQL",
        level: "intermediate",
        years: 2,
      },
      {
        id: crypto.randomUUID(),
        profile_id: id,
        category: "tools",
        name: "Pandas",
        level: "intermediate",
        years: 2,
      },
    ],
    projects: [
      {
        id: crypto.randomUUID(),
        profile_id: id,
        title: "Sales Dashboard",
        description: "Interactive sales dashboard.",
        technologies: ["python", "tableau"],
        responsibilities: ["Built dashboards"],
        achievements: [],
        metrics: "",
        github_url: "",
        live_demo_url: "",
        sort_order: 0,
      },
    ],
    experiences: [
      {
        id: crypto.randomUUID(),
        profile_id: id,
        organization: "Acme",
        role: "Intern",
        start_date: "2025-06-01",
        end_date: "2025-08-01",
        responsibilities: [],
        achievements: [],
        sort_order: 0,
      },
    ],
    leadership: [],
    certifications: [],
    created_at: isoAt(-30 * DAY),
    updated_at: isoAt(-30 * DAY),
    ...overrides,
  };
}

export function makePersonal(overrides: Partial<PersonalInfo> = {}): PersonalInfo {
  return {
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "",
    city: "Bengaluru",
    country: "India",
    headline: "Aspiring data analyst",
    summary: "",
    linkedin_url: "",
    github_url: "",
    portfolio_url: "",
    other_links: [],
    ...overrides,
  };
}

export function makePreferences(overrides: Partial<JobPreferences> = {}): JobPreferences {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    profile_id: PROFILE_ID,
    employment_types: ["internship", "full_time"],
    experience_levels: ["student", "fresher"],
    custom_experience_range: "",
    locations: ["Bengaluru"],
    work_models: ["hybrid"],
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
    updated_at: isoAt(),
    ...overrides,
  };
}

export function makeRole(role = "Data Analyst", priority = 0): RolePreference {
  return {
    id: crypto.randomUUID(),
    profile_id: PROFILE_ID,
    role,
    is_custom: false,
    priority,
  };
}

/**
 * Discovery `JobDraft` fixture (Milestone 2). Every field a real source does
 * not publish stays empty/null so tests can assert the honesty rules hold.
 */
export function makeDraft(overrides: Partial<JobDraft> = {}): JobDraft {
  const url = "https://job-boards.greenhouse.io/northwind/jobs/12345";
  return {
    source_key: "greenhouse",
    source_name: "Greenhouse",
    source_base_url: "https://boards-api.greenhouse.io",
    source_kind: "ats_api",
    source_job_id: "12345",
    company: {
      name: "Northwind Analytics",
      domain: "",
      official_website_url: "",
      careers_page_url: "",
      industry: "",
    },
    title: "Data Analyst Intern",
    description:
      "Build dashboards and reports for the analytics team with Python and SQL.",
    city: "Bengaluru",
    country: "India",
    location_text: "Bengaluru, India",
    work_model: "hybrid",
    employment_type: "internship",
    experience_level: "student",
    role_tags: ["Data Analyst"],
    skills: ["Python", "SQL"],
    requirements: {
      required_skills: ["Python"],
      preferred_skills: [],
      responsibilities: [],
      eligibility: "",
      experience_text: "",
      benefits: [],
      about_company: "",
    },
    salary_min: null,
    salary_max: null,
    salary_currency: "",
    salary_period: "month",
    stipend_amount: null,
    duration_days: null,
    original_url: url,
    canonical_url: url,
    application_url: url,
    posted_at: null,
    closing_date: null,
    ...overrides,
  };
}

export function makeApplication(overrides: Partial<Application> = {}): Application {
  const ts = isoAt(-5 * DAY);
  return {
    id: crypto.randomUUID(),
    profile_id: PROFILE_ID,
    job_id: null,
    company_name: "Northwind Analytics",
    job_title: "Data Analyst Intern",
    original_url: "",
    application_url: "",
    match_score: null,
    verification_status_at_apply: null,
    resume_version_id: null,
    email_draft_id: null,
    applied_at: null,
    stage: "discovered",
    notes: "",
    follow_up_at: null,
    interview_at: null,
    interview_details: "",
    events: [],
    created_at: ts,
    updated_at: ts,
    ...overrides,
  };
}

export function makeNotification(
  overrides: Partial<AppNotification> = {},
): AppNotification {
  return {
    id: crypto.randomUUID(),
    type: "strong_match",
    title: "Strong match found",
    body: "A listing scored 80+ against your profile.",
    link: "/discover",
    read_at: null,
    created_at: isoAt(-1 * DAY),
    ...overrides,
  };
}

/**
 * Profile child collections with empty ids, so tests can prove the store
 * generates ids and binds rows to the profile on save.
 */
export function makeProfileChildrenSeed() {
  return {
    education: [
      {
        id: "",
        profile_id: "",
        institution: "Test University",
        degree: "B.Tech",
        branch: "Computer Science",
        start_date: "2022-08-01",
        graduation_date: "2026-06-01",
        cgpa: "8.5",
        coursework: ["Statistics"],
        sort_order: 0,
      },
    ],
    skills: [
      {
        id: "",
        profile_id: "",
        category: "tools" as const,
        name: "SQL",
        level: "intermediate" as const,
        years: 2,
      },
    ],
    projects: [
      {
        id: "",
        profile_id: "",
        title: "Sales Dashboard",
        description: "",
        technologies: ["python"],
        responsibilities: [],
        achievements: [],
        metrics: "",
        github_url: "",
        live_demo_url: "",
        sort_order: 0,
      },
    ],
    experiences: [
      {
        id: "",
        profile_id: "",
        organization: "Acme",
        role: "Intern",
        start_date: "2025-06-01",
        end_date: "2025-08-01",
        responsibilities: [],
        achievements: [],
        sort_order: 0,
      },
    ],
    leadership: [],
    certifications: [],
  };
}
