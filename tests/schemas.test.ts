import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createApplicationSchema,
  educationSchema,
  jobPreferencesSchema,
  jobQuerySchema,
  personalInfoSchema,
  preferencesPayloadSchema,
  profileSchema,
  skillSchema,
} from "@/lib/validation/schemas";

/**
 * Validation is the API's first line of defence: query strings coerce,
 * defaults fill gaps, and malformed payloads fail loudly (422 upstream).
 */

describe("jobQuerySchema", () => {
  it("fills every documented default from an empty query", () => {
    expect(jobQuerySchema.parse({})).toEqual({
      q: "",
      role: "",
      location: "",
      work_model: "",
      employment_type: "",
      experience: "",
      verification: "",
      company: "",
      skills: "",
      min_salary: undefined,
      posted_within_days: undefined,
      saved_only: false,
      include_sample: true,
      include_closed: false,
      sort: "best_match",
      page: 1,
      pageSize: 12,
    });
  });

  it("coerces numeric query strings and clamps nothing silently", () => {
    const parsed = jobQuerySchema.parse({
      page: "3",
      pageSize: "50",
      min_salary: "25000",
      posted_within_days: "14",
    });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.min_salary).toBe(25_000);
    expect(parsed.posted_within_days).toBe(14);
  });

  it("accepts boolean-ish flags in either string or boolean form", () => {
    expect(jobQuerySchema.parse({ saved_only: "true" }).saved_only).toBe(true);
    expect(jobQuerySchema.parse({ saved_only: true }).saved_only).toBe(true);
    expect(jobQuerySchema.parse({ saved_only: "false" }).saved_only).toBe(false);
    expect(jobQuerySchema.parse({ include_sample: "false" }).include_sample).toBe(false);
    expect(jobQuerySchema.parse({ include_closed: "true" }).include_closed).toBe(true);
  });

  it("rejects out-of-range and unknown values", () => {
    expect(jobQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ posted_within_days: "0" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ posted_within_days: "366" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ sort: "cheapest" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ work_model: "orbital" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ verification: "TRUSTED" }).success).toBe(false);
    expect(jobQuerySchema.safeParse({ min_salary: "-1" }).success).toBe(false);
  });

  it("trims free-text fields", () => {
    expect(jobQuerySchema.parse({ q: "  analyst  " }).q).toBe("analyst");
  });
});

describe("personalInfoSchema", () => {
  it("defaults an empty payload to a blank profile", () => {
    expect(personalInfoSchema.parse({})).toEqual({
      full_name: "",
      email: "",
      phone: "",
      city: "",
      country: "",
      headline: "",
      summary: "",
      linkedin_url: "",
      github_url: "",
      portfolio_url: "",
      other_links: [],
    });
  });

  it("accepts an empty string for optional URLs but not a malformed one", () => {
    expect(personalInfoSchema.parse({ linkedin_url: "" }).linkedin_url).toBe("");
    expect(
      personalInfoSchema.parse({ linkedin_url: "https://linkedin.com/in/ada" }).linkedin_url,
    ).toBe("https://linkedin.com/in/ada");
    expect(personalInfoSchema.safeParse({ linkedin_url: "not a url" }).success).toBe(false);
  });

  it("rejects malformed emails but allows the field to stay blank", () => {
    expect(personalInfoSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(personalInfoSchema.parse({ email: "" }).email).toBe("");
    expect(personalInfoSchema.parse({ email: "ada@example.com" }).email).toBe("ada@example.com");
  });

  it("requires labelled links with real URLs", () => {
    expect(
      personalInfoSchema.safeParse({
        other_links: [{ label: "Blog", url: "https://example.com" }],
      }).success,
    ).toBe(true);
    expect(
      personalInfoSchema.safeParse({ other_links: [{ label: "", url: "https://example.com" }] })
        .success,
    ).toBe(false);
    expect(
      personalInfoSchema.safeParse({ other_links: [{ label: "Blog", url: "nope" }] }).success,
    ).toBe(false);
  });

  it("rejects names beyond the column limit", () => {
    expect(personalInfoSchema.safeParse({ full_name: "x".repeat(161) }).success).toBe(false);
  });
});

describe("educationSchema / skillSchema", () => {
  it("allows empty date strings but demands YYYY-MM-DD otherwise", () => {
    expect(educationSchema.parse({ institution: "X", start_date: "" }).start_date).toBe("");
    expect(
      educationSchema.safeParse({ institution: "X", start_date: "2026/01/01" }).success,
    ).toBe(false);
    expect(
      educationSchema.safeParse({ institution: "X", start_date: "soon" }).success,
    ).toBe(false);
  });

  it("enforces the skill category and level enums", () => {
    expect(skillSchema.safeParse({ name: "Python", category: "bogus" }).success).toBe(false);
    expect(skillSchema.safeParse({ name: "Python", category: "programming_languages" }).success).toBe(
      true,
    );
    expect(
      skillSchema.safeParse({ name: "Python", category: "programming_languages", level: "godlike" })
        .success,
    ).toBe(false);
    expect(skillSchema.safeParse({ name: "  ", category: "tools" }).success).toBe(false);
  });

  it("defaults coursework to an empty list", () => {
    expect(educationSchema.parse({ institution: "X" }).coursework).toEqual([]);
  });
});

describe("profileSchema", () => {
  it("accepts a minimal payload and fills collection defaults", () => {
    const parsed = profileSchema.parse({ personal: { full_name: "Ada" } });
    expect(parsed.personal.full_name).toBe("Ada");
    expect(parsed.education).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.projects).toEqual([]);
    expect(parsed.experiences).toEqual([]);
    expect(parsed.leadership).toEqual([]);
    expect(parsed.certifications).toEqual([]);
  });

  it("caps collection sizes at the documented limits", () => {
    const tooManyEducation = Array.from({ length: 11 }, () => ({ institution: "X" }));
    expect(profileSchema.safeParse({ personal: {}, education: tooManyEducation }).success).toBe(
      false,
    );
    const maxEducation = Array.from({ length: 10 }, () => ({ institution: "X" }));
    expect(profileSchema.safeParse({ personal: {}, education: maxEducation }).success).toBe(true);
  });

  it("rejects a payload without the personal object", () => {
    expect(profileSchema.safeParse({}).success).toBe(false);
  });
});

describe("jobPreferencesSchema", () => {
  it("fills defaults for an empty payload", () => {
    const parsed = jobPreferencesSchema.parse({});
    expect(parsed.employment_types).toEqual([]);
    expect(parsed.locations).toEqual([]);
    expect(parsed.work_models).toEqual([]);
    expect(parsed.prefer_internship_duration_days).toBe(60);
    expect(parsed.compensation_flexible).toBe(true);
    expect(parsed.search_frequency_hours).toBe(24);
    expect(parsed.min_stipend).toBeNull();
    expect(parsed.company_stage).toBe("any");
  });

  it("enforces enum membership for structured filters", () => {
    expect(jobPreferencesSchema.safeParse({ employment_types: ["gig"] }).success).toBe(false);
    expect(jobPreferencesSchema.safeParse({ employment_types: ["internship"] }).success).toBe(true);
    expect(jobPreferencesSchema.safeParse({ work_models: ["wfh"] }).success).toBe(false);
    expect(jobPreferencesSchema.safeParse({ company_stage: "chaotic" }).success).toBe(false);
  });

  it("bounds numeric ranges", () => {
    expect(jobPreferencesSchema.safeParse({ search_frequency_hours: 200 }).success).toBe(false);
    expect(jobPreferencesSchema.safeParse({ search_frequency_hours: 0 }).success).toBe(false);
    expect(jobPreferencesSchema.safeParse({ prefer_internship_duration_days: 731 }).success).toBe(
      false,
    );
    expect(jobPreferencesSchema.safeParse({ application_deadline_within_days: 0 }).success).toBe(
      false,
    );
  });

  it("trims list entries and drops blanks", () => {
    const parsed = jobPreferencesSchema.parse({ locations: ["  Bengaluru  "] });
    expect(parsed.locations).toEqual(["Bengaluru"]);
    expect(jobPreferencesSchema.safeParse({ locations: ["   "] }).success).toBe(false);
  });
});

describe("preferencesPayloadSchema", () => {
  it("accepts the shape the preferences page submits", () => {
    const parsed = preferencesPayloadSchema.parse({
      roles: [{ role: "Data Analyst", is_custom: false, priority: 0 }],
      preferences: { employment_types: ["internship"] },
    });
    expect(parsed.roles).toHaveLength(1);
    expect(parsed.preferences.employment_types).toEqual(["internship"]);
  });

  it("rejects a blank role name", () => {
    expect(
      preferencesPayloadSchema.safeParse({ roles: [{ role: " " }], preferences: {} }).success,
    ).toBe(false);
  });
});

describe("createApplicationSchema", () => {
  it("requires company and title, defaulting the rest", () => {
    expect(createApplicationSchema.safeParse({}).success).toBe(false);
    expect(createApplicationSchema.safeParse({ company_name: "Acme" }).success).toBe(false);

    const parsed = createApplicationSchema.parse({
      company_name: "Acme",
      job_title: "Data Analyst",
    });
    expect(parsed.stage).toBe("discovered");
    expect(parsed.confirmed_applied).toBe(false);
    expect(parsed.notes).toBe("");
    expect(parsed.original_url).toBe("");
  });

  it("requires full ISO datetimes for application timestamps", () => {
    const base = { company_name: "Acme", job_title: "Data Analyst" };
    expect(
      createApplicationSchema.safeParse({ ...base, applied_at: "2026-11-01" }).success,
    ).toBe(false);
    expect(
      createApplicationSchema.safeParse({ ...base, applied_at: "2026-11-01T09:00:00.000Z" })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown stage", () => {
    expect(
      createApplicationSchema.safeParse({
        company_name: "Acme",
        job_title: "Data Analyst",
        stage: "ghosted",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid job link", () => {
    expect(
      createApplicationSchema.safeParse({
        company_name: "Acme",
        job_title: "Data Analyst",
        job_id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("accepts empty-string URLs but not malformed ones", () => {
    const base = { company_name: "Acme", job_title: "Data Analyst" };
    expect(createApplicationSchema.safeParse({ ...base, application_url: "" }).success).toBe(true);
    expect(
      createApplicationSchema.safeParse({ ...base, application_url: "not a url" }).success,
    ).toBe(false);
  });
});

describe("zod version contract", () => {
  it("is Zod v4 (email/url helpers used across the codebase)", () => {
    // Guards against an accidental major upgrade breaking `z.email()` / `z.url()`.
    expect(z.string().safeParse("x").success).toBe(true);
    expect(typeof z.email).toBe("function");
    expect(typeof z.url).toBe("function");
  });
});
