import { z } from "zod";
import {
  APPLICATION_STAGES,
  PREFERRED_EMPLOYMENT_TYPES,
  PREFERRED_EXPERIENCE_LEVELS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SKILL_CATEGORIES,
  VERIFICATION_STATUSES,
  WORK_MODELS,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const optionalUrl = z
  .union([z.url(), z.literal("")])
  .transform((v) => (v === "" ? "" : v));

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"), z.literal("")])
  .transform((v) => (v === "" ? "" : v));

const nonEmptyList = z.array(z.string().trim().min(1)).default([]);

/* ------------------------------------------------------------------ */
/* Personal + profile                                                  */
/* ------------------------------------------------------------------ */

export const personalInfoSchema = z.object({
  full_name: z.string().trim().max(160).default(""),
  email: z.email().or(z.literal("")).default(""),
  phone: z.string().trim().max(40).default(""),
  city: z.string().trim().max(80).default(""),
  country: z.string().trim().max(80).default(""),
  headline: z.string().trim().max(200).default(""),
  summary: z.string().max(4000).default(""),
  linkedin_url: optionalUrl.default(""),
  github_url: optionalUrl.default(""),
  portfolio_url: optionalUrl.default(""),
  other_links: z
    .array(z.object({ label: z.string().trim().min(1).max(80), url: z.url() }))
    .max(10)
    .default([]),
});

export const educationSchema = z.object({
  id: z.string().default(""),
  profile_id: z.string().default(""),
  institution: z.string().trim().max(200).default(""),
  degree: z.string().trim().max(120).default(""),
  branch: z.string().trim().max(120).default(""),
  start_date: optionalDate.default(""),
  graduation_date: optionalDate.default(""),
  cgpa: z.string().trim().max(20).default(""),
  coursework: nonEmptyList,
  sort_order: z.number().int().default(0),
});

export const skillSchema = z.object({
  id: z.string().default(""),
  profile_id: z.string().default(""),
  category: z.enum(SKILL_CATEGORIES),
  name: z.string().trim().min(1).max(80),
  level: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  years: z.number().min(0).max(60).nullable().default(null),
});

export const projectSchema = z.object({
  id: z.string().default(""),
  profile_id: z.string().default(""),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).default(""),
  technologies: nonEmptyList,
  responsibilities: nonEmptyList,
  achievements: nonEmptyList,
  metrics: z.string().max(500).default(""),
  github_url: optionalUrl.default(""),
  live_demo_url: optionalUrl.default(""),
  sort_order: z.number().int().default(0),
});

export const experienceSchema = z.object({
  id: z.string().default(""),
  profile_id: z.string().default(""),
  organization: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(160),
  start_date: optionalDate.default(""),
  end_date: optionalDate.default(""),
  responsibilities: nonEmptyList,
  achievements: nonEmptyList,
  sort_order: z.number().int().default(0),
});

export const leadershipSchema = z.object({
  id: z.string().default(""),
  profile_id: z.string().default(""),
  organization: z.string().trim().min(1).max(160),
  position: z.string().trim().min(1).max(160),
  start_date: optionalDate.default(""),
  end_date: optionalDate.default(""),
  contributions: nonEmptyList,
  sort_order: z.number().int().default(0),
});

export const certificationSchema = z.object({
  id: z.string().default(""),
  profile_id: z.string().default(""),
  name: z.string().trim().min(1).max(200),
  issuer: z.string().trim().max(160).default(""),
  issued_date: optionalDate.default(""),
  credential_url: optionalUrl.default(""),
  sort_order: z.number().int().default(0),
});

export const profileSchema = z.object({
  personal: personalInfoSchema,
  education: z.array(educationSchema).max(10).default([]),
  skills: z.array(skillSchema).max(300).default([]),
  projects: z.array(projectSchema).max(50).default([]),
  experiences: z.array(experienceSchema).max(50).default([]),
  leadership: z.array(leadershipSchema).max(50).default([]),
  certifications: z.array(certificationSchema).max(50).default([]),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export const rolePreferencesSchema = z.object({
  roles: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(80),
        is_custom: z.boolean().default(false),
        priority: z.number().int().min(0).max(100).default(0),
      }),
    )
    .max(30)
    .default([]),
});

export const jobPreferencesSchema = z.object({
  // Preferences use the "preferred" lists: `unknown` is an honesty sentinel
  // for stored jobs, never something a candidate can ask for.
  employment_types: z.array(z.enum(PREFERRED_EMPLOYMENT_TYPES)).default([]),
  experience_levels: z.array(z.enum(PREFERRED_EXPERIENCE_LEVELS)).default([]),
  custom_experience_range: z.string().trim().max(60).default(""),
  locations: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  work_models: z.array(z.enum(WORK_MODELS)).default([]),
  prefer_internship_duration_days: z.number().int().min(0).max(730).default(60),
  paid_internship_only: z.boolean().default(false),
  min_stipend: z.number().int().min(0).nullable().default(null),
  min_salary: z.number().int().min(0).nullable().default(null),
  compensation_flexible: z.boolean().default(true),
  required_skills: z.array(z.string().trim().min(1)).max(60).default([]),
  preferred_technologies: z.array(z.string().trim().min(1)).max(60).default([]),
  industries: z.array(z.string().trim().min(1)).max(30).default([]),
  company_size: z.string().trim().max(60).default("any"),
  company_stage: z.enum(["any", "startup", "established"]).default("any"),
  application_deadline_within_days: z.number().int().min(1).max(365).nullable().default(null),
  excluded_companies: z.array(z.string().trim().min(1)).max(100).default([]),
  excluded_roles: z.array(z.string().trim().min(1)).max(100).default([]),
  search_frequency_hours: z.number().int().min(1).max(168).default(24),
});

export const preferencesPayloadSchema = z.object({
  roles: rolePreferencesSchema.shape.roles,
  preferences: jobPreferencesSchema,
});

export type PreferencesPayload = z.infer<typeof preferencesPayloadSchema>;

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export const jobQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  role: z.string().trim().max(80).default(""),
  location: z.string().trim().max(80).default(""),
  work_model: z.enum(WORK_MODELS).or(z.literal("")).default(""),
  employment_type: z.enum(EMPLOYMENT_TYPES).or(z.literal("")).default(""),
  experience: z.enum(EXPERIENCE_LEVELS).or(z.literal("")).default(""),
  verification: z.enum(VERIFICATION_STATUSES).or(z.literal("")).default(""),
  company: z.string().trim().max(120).default(""),
  skills: z.string().trim().max(300).default(""),
  min_salary: z.coerce.number().int().min(0).optional(),
  posted_within_days: z.coerce.number().int().min(1).max(365).optional(),
  saved_only: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .default(false),
  include_sample: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v !== false && v !== "false")
    .default(true),
  include_closed: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .default(false),
  sort: z
    .enum(["best_match", "recently_posted", "recently_discovered", "highest_salary", "deadline"])
    .default("best_match"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

export type JobQueryInput = z.infer<typeof jobQuerySchema>;

export const saveJobSchema = z.object({
  saved: z.boolean().optional(),
});

export const matchJobSchema = z.object({
  force: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/** Source adapters that can actually run (mirrors `createAdapters`). */
export const DISCOVERY_SOURCES = ["greenhouse", "lever", "ashby"] as const;

/**
 * POST /api/v1/discovery/run body. Empty body is valid (`{}` → defaults),
 * so the dashboard's plain `fetch(url, { method: "POST" })` keeps working.
 */
export const discoveryRunSchema = z.object({
  trigger: z.enum(["manual", "dashboard_stale", "schedule"]).default("manual"),
  /** Optional subset of the configured sources to run. */
  sources: z.array(z.enum(DISCOVERY_SOURCES)).min(1).optional(),
});

export type DiscoveryRunInput = z.infer<typeof discoveryRunSchema>;

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

export const createApplicationSchema = z.object({
  job_id: z.string().uuid().optional().nullable(),
  company_name: z.string().trim().min(1).max(160),
  job_title: z.string().trim().min(1).max(200),
  original_url: optionalUrl.default(""),
  application_url: optionalUrl.default(""),
  stage: z.enum(APPLICATION_STAGES).default("discovered"),
  notes: z.string().max(4000).default(""),
  applied_at: z.string().datetime().optional().nullable(),
  follow_up_at: z.string().datetime().optional().nullable(),
  interview_at: z.string().datetime().optional().nullable(),
  interview_details: z.string().max(4000).default(""),
  resume_version_id: z.string().uuid().optional().nullable(),
  email_draft_id: z.string().uuid().optional().nullable(),
  confirmed_applied: z.boolean().default(false),
});

export const patchApplicationSchema = createApplicationSchema.partial().extend({
  stage: z.enum(APPLICATION_STAGES).optional(),
  stage_note: z.string().max(1000).optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type PatchApplicationInput = z.infer<typeof patchApplicationSchema>;
