import { describe, expect, it } from "vitest";

import { computeMatch, MATCH_WEIGHTS } from "@/features/matching/score";
import type { JobPreferences, ProfileData, RolePreference } from "@/types";
import { makeJobWithRelations, makePreferences, makeProfile, makeRole } from "./helpers";

/** The matching engine must be explainable: every point comes from a documented weight and every gap produces a human recommendation. */

const baseProfile = (): ProfileData => makeProfile();
const basePreferences = (): JobPreferences => makePreferences();
const baseRoles: RolePreference[] = [makeRole("Data Analyst")];

describe("MATCH_WEIGHTS — spec §12 breakdown", () => {
  it("sums to exactly 100 across the seven components", () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(MATCH_WEIGHTS).toEqual({
      technical_skills: 30,
      projects: 20,
      role_alignment: 15,
      education: 10,
      experience: 10,
      location: 10,
      additional: 5,
    });
  });
});

describe("computeMatch — scoring", () => {
  it("scores a perfect fit at 100 with a fully additive breakdown", () => {
    const result = computeMatch(
      makeJobWithRelations(),
      baseProfile(),
      basePreferences(),
      baseRoles,
    );
    expect(result.score).toBe(100);
    expect(Object.values(result.breakdown).reduce((a, b) => a + b, 0)).toBe(100);
    expect(result.breakdown).toEqual({
      technical_skills: 30,
      projects: 20,
      role_alignment: 15,
      education: 10,
      experience: 10,
      location: 10,
      additional: 5,
    });
  });

  it("never exceeds 100 or drops below 0", () => {
    const huge = computeMatch(
      makeJobWithRelations({ job_status: "open" }),
      baseProfile(),
      basePreferences(),
      baseRoles,
    );
    expect(huge.score).toBeGreaterThanOrEqual(0);
    expect(huge.score).toBeLessThanOrEqual(100);
  });

  it("caps a closed job at 50 while keeping the breakdown explainable", () => {
    const result = computeMatch(
      makeJobWithRelations({ job_status: "closed" }),
      baseProfile(),
      basePreferences(),
      baseRoles,
    );
    // Closed jobs have their score capped at 50.
    expect(result.score).toBeLessThanOrEqual(50);
    // The lost points are visible: only the deadline half of `additional` is lost.
    // For a closed job, deadlineOk is false, so only typeOk contributes 2.5.
    expect(result.breakdown.additional).toBe(2.5);
  });

  it("scores an empty profile far lower than a complete one", () => {
    const empty = computeMatch(makeJobWithRelations(), null, null, []);
    const full = computeMatch(makeJobWithRelations(), baseProfile(), basePreferences(), baseRoles);
    expect(empty.score).toBeLessThan(full.score);
    expect(empty.score).toBe(23); // 8 experience + 10 location + 5 additional
    expect(empty.breakdown.technical_skills).toBe(0);
    expect(empty.breakdown.projects).toBe(0);
    expect(empty.breakdown.role_alignment).toBe(0);
    expect(empty.breakdown.education).toBe(0);
  });

  it("weights preferred skills at 30% of the technical component", () => {
    // Job requires python + sql (both held) but prefers pandas (also held):
    // full technical score comes from required-only weighting being 70/30.
    const withPreferred = computeMatch(
      makeJobWithRelations(),
      baseProfile(),
      basePreferences(),
      baseRoles,
    );
    expect(withPreferred.breakdown.technical_skills).toBe(30);

    // Drop the preferred skill from the profile: 30 * 0.7 = 21.
    const profile = baseProfile();
    profile.skills = profile.skills.filter((s) => s.name !== "Pandas");
    profile.projects = profile.projects.map((p) => ({
      ...p,
      technologies: p.technologies.filter((t) => t !== "pandas"),
    }));
    const withoutPreferred = computeMatch(
      makeJobWithRelations(),
      profile,
      basePreferences(),
      baseRoles,
    );
    expect(withoutPreferred.breakdown.technical_skills).toBe(21);
    expect(withoutPreferred.missing_skills).toContain("pandas");
  });

  it("falls back to job.skills when required_skills is empty", () => {
    const job = makeJobWithRelations({
      requirements: {
        ...makeJobWithRelations().requirements,
        required_skills: [],
        preferred_skills: [],
      },
    });
    const result = computeMatch(job, baseProfile(), basePreferences(), baseRoles);
    expect(result.breakdown.technical_skills).toBe(30); // python + sql both held
  });
});

describe("computeMatch — role alignment", () => {
  it("awards full marks on an exact role-tag hit", () => {
    const r = computeMatch(makeJobWithRelations(), baseProfile(), basePreferences(), [
      makeRole("Data Analyst"),
    ]);
    expect(r.breakdown.role_alignment).toBe(15);
  });

  it("awards partial marks when only the job title contains the preferred role", () => {
    const r = computeMatch(makeJobWithRelations(), baseProfile(), basePreferences(), [
      makeRole("Data Scientist"),
    ]);
    expect(r.breakdown.role_alignment).toBe(9); // 15 * 0.6
  });

  it("awards nothing when neither tags nor title overlap", () => {
    const r = computeMatch(makeJobWithRelations(), baseProfile(), basePreferences(), [
      makeRole("Mechanical Engineer"),
    ]);
    expect(r.breakdown.role_alignment).toBe(0);
  });
});

describe("computeMatch — eligibility and experience warnings", () => {
  it("awards full education points when the graduation year qualifies", () => {
    const job = makeJobWithRelations({
      requirements: { ...makeJobWithRelations().requirements, eligibility: "Graduating in 2027" },
    });
    const r = computeMatch(job, baseProfile(), basePreferences(), baseRoles);
    expect(r.breakdown.education).toBe(10);
    expect(r.eligibility_warnings).toHaveLength(0);
  });

  it("reduces education points and warns when the graduation year misses", () => {
    const profile = baseProfile();
    profile.education[0]!.graduation_date = "2028-06-01";
    const job = makeJobWithRelations({
      requirements: {
        ...makeJobWithRelations().requirements,
        eligibility: "Graduating in 2027",
        required_skills: ["python"],
        preferred_skills: [],
      },
    });
    const r = computeMatch(job, profile, basePreferences(), baseRoles);
    // Graduation year 2028 does not match eligibility 2027, so education points are reduced.
    expect(r.breakdown.education).toBe(5);
    // Warning about mismatch should be generated.
    expect(r.eligibility_warnings.some((w) => w.includes("2027"))).toBe(true);
  });

  it("warns when a 1–2 year role meets an experience-free profile", () => {
    const profile = baseProfile();
    profile.experiences = [];
    const job = makeJobWithRelations({
      ...makeJobWithRelations(),
      experience_level: "1_2_years",
      requirements: {
        ...makeJobWithRelations().requirements,
        experience_text: "1–2 years",
      },
    });
    const r = computeMatch(job, profile, basePreferences(), baseRoles);
    // 1-2 years experience with no profile experience → 5 points + warning
    expect(r.breakdown.experience).toBe(5);
    expect(r.eligibility_warnings.some((w) => w.includes("your profile shows none"))).toBe(true);
  });

  it("warns when no education entries exist yet", () => {
    const profile = baseProfile();
    profile.education = [];
    const r = computeMatch(makeJobWithRelations(), profile, basePreferences(), baseRoles);
    expect(r.breakdown.education).toBe(0);
    expect(
      r.eligibility_warnings.some((w) => w.includes("No education entries")),
    ).toBe(true);
  });

  it("reduces location points and warns when preferences do not match", () => {
    const preferences = makePreferences({ locations: ["Remote"] });
    const r = computeMatch(makeJobWithRelations(), baseProfile(), preferences, baseRoles);
    expect(r.breakdown.location).toBe(6);
    expect(r.eligibility_warnings.some((w) => w.includes("preferred locations are Remote"))).toBe(
      true,
    );
  });
});

describe("computeMatch — recommendations", () => {
  it("lists missing required skills as an action", () => {
    const job = makeJobWithRelations({
      requirements: {
        ...makeJobWithRelations().requirements,
        required_skills: ["python", "sql", "rust"],
      },
    });
    const r = computeMatch(job, baseProfile(), basePreferences(), baseRoles);
    expect(r.missing_skills).toContain("rust");
    expect(r.matched_skills).toContain("python");
    expect(r.recommendations.some((x) => x.includes("rust"))).toBe(true);
  });

  it("tells the user when no project overlaps the job", () => {
    const profile = baseProfile();
    profile.projects = profile.projects.map((p) => ({
      ...p,
      technologies: ["cobol"],
      title: "Totally Unrelated Thing",
      responsibilities: ["Did unrelated work"],
    }));
    const r = computeMatch(makeJobWithRelations({ is_sample: true }), profile, basePreferences(), baseRoles);
    expect(r.relevant_projects).toHaveLength(0);
    expect(
      r.recommendations.some((x) => x.includes("None of your projects clearly overlap")),
    ).toBe(true);
  });

  it("labels sample listings so they can never read as real opportunities", () => {
    const r = computeMatch(
      makeJobWithRelations({ is_sample: true }),
      baseProfile(),
      basePreferences(),
      baseRoles,
    );
    expect(r.recommendations.some((x) => x.includes("sample data"))).toBe(true);
  });

  it("recommends completing education when the section is empty", () => {
    const profile = baseProfile();
    profile.education = [];
    const r = computeMatch(makeJobWithRelations(), profile, basePreferences(), baseRoles);
    expect(r.recommendations.some((x) => x.includes("Education section"))).toBe(true);
  });
});