import type {
  JobPreferences,
  JobWithRelations,
  MatchBreakdown,
  ProfileData,
  RolePreference,
} from "@/types";

/**
 * JobDedo job matching engine (spec §12).
 *
 * Weights:
 *   technical skill alignment  30
 *   project relevance          20
 *   role alignment             15
 *   education and eligibility  10
 *   experience                 10
 *   location and work prefs    10
 *   additional requirements     5
 *
 * Pure, deterministic and explainable. This is JobDedo's own estimate of fit —
 * it is NOT an employer ATS score and predicts nothing about selection.
 */

export const MATCH_WEIGHTS = {
  technical_skills: 30,
  projects: 20,
  role_alignment: 15,
  education: 10,
  experience: 10,
  location: 10,
  additional: 5,
} as const;

export interface MatchResult {
  score: number;
  breakdown: MatchBreakdown;
  matched_skills: string[];
  missing_skills: string[];
  relevant_projects: string[];
  eligibility_warnings: string[];
  recommendations: string[];
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const n = norm(v);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

export function computeMatch(
  job: JobWithRelations,
  profile: ProfileData | null,
  preferences: JobPreferences | null,
  roles: RolePreference[],
): MatchResult {
  const required = unique([
    ...job.requirements.required_skills,
    ...(job.requirements.required_skills.length === 0 ? job.skills : []),
  ]);
  const preferred = unique(job.requirements.preferred_skills);

  const candidateSkills = unique([
    ...(profile?.skills.map((s) => s.name) ?? []),
    ...(profile?.projects.flatMap((p) => p.technologies) ?? []),
    ...(preferences?.required_skills ?? []),
    ...(preferences?.preferred_technologies ?? []),
  ]);
  const candidateSet = new Set(candidateSkills);

  const matchedRequired = required.filter((s) => candidateSet.has(s));
  const missingRequired = required.filter((s) => !candidateSet.has(s));
  const matchedPreferred = preferred.filter((s) => candidateSet.has(s));
  const missingPreferred = preferred.filter((s) => !candidateSet.has(s));

  /* 1. Technical skill alignment — 30 */
  const requiredScore = pct(matchedRequired.length, required.length || 1);
  const preferredScore = pct(matchedPreferred.length, preferred.length || 1);
  // Required skills carry 70% of the technical weight, preferred skills 30%.
  const technicalPoints = preferred.length
    ? MATCH_WEIGHTS.technical_skills * (0.7 * (requiredScore / 100) + 0.3 * (preferredScore / 100))
    : MATCH_WEIGHTS.technical_skills * (requiredScore / 100);

  /* 2. Project relevance — 20 */
  const jobSignals = unique([...job.skills, ...job.role_tags, job.title]);
  const relevantProjects = (profile?.projects ?? []).filter((project) => {
    const haystack = unique([
      ...project.technologies,
      project.title,
      ...project.responsibilities,
    ]);
    return jobSignals.some((signal) =>
      haystack.some(
        (h) => h === signal || h.includes(signal) || signal.includes(h),
      ),
    );
  });
  const projectRatio = profile?.projects.length
    ? relevantProjects.length / profile.projects.length
    : 0;
  const projectPoints =
    MATCH_WEIGHTS.projects * (relevantProjects.length > 0 ? Math.max(0.3, projectRatio) : 0);

  /* 3. Role alignment — 15 */
  const preferredRoles = roles.map((r) => norm(r.role));
  const jobRoles = job.role_tags.map(norm);
  const roleHits = jobRoles.filter((r) =>
    preferredRoles.some(
      (p) => p === r || p.includes(r) || r.includes(p),
    ),
  );
  const titleMatchesPreferred = preferredRoles.some((p) =>
    norm(job.title).includes(p.split(" ")[0] ?? ""),
  );
  const rolePoints =
    roleHits.length > 0
      ? MATCH_WEIGHTS.role_alignment
      : titleMatchesPreferred
        ? MATCH_WEIGHTS.role_alignment * 0.6
        : 0;

  /* 4. Education and eligibility — 10 */
  const warnings: string[] = [];
  const hasEducation = (profile?.education.length ?? 0) > 0;
  const eligibilityText = job.requirements.eligibility.toLowerCase();
  let educationPoints = hasEducation ? 7 : 0;
  if (hasEducation) {
    const gradDate = profile?.education[0]?.graduation_date;
    if (/20\d{2}/.test(eligibilityText)) {
      const years = [...eligibilityText.matchAll(/20\d{2}/g)].map((m) => m[0]);
      if (gradDate && years.length) {
        const gradYear = gradDate.slice(0, 4);
        educationPoints = years.some((y) =>
          gradYear === "0000" ? true : compareGradYear(gradYear, y),
        )
          ? 10
          : 5;
        if (educationPoints < 10) {
          warnings.push(
            `Job eligibility mentions ${years.join(", ")} — confirm your graduation year matches before applying.`,
          );
        }
      }
    } else {
      educationPoints = 10;
    }
  } else {
    warnings.push("No education entries in your Master Profile yet.");
  }

  /* 5. Experience — 10 */
  const experienceEntries = profile?.experiences.length ?? 0;
  let experiencePoints = 0;
  if (["student", "fresher", "entry_level"].includes(job.experience_level)) {
    experiencePoints = experienceEntries > 0 ? 10 : 8;
  } else if (job.experience_level === "0_1_years") {
    experiencePoints = experienceEntries > 0 ? 10 : 7;
  } else if (job.experience_level === "1_2_years") {
    experiencePoints = experienceEntries >= 1 ? 10 : 5;
    if (experienceEntries === 0) {
      warnings.push("Role asks for 1–2 years of experience; your profile shows none.");
    }
  } else {
    experiencePoints = experienceEntries > 0 ? 9 : 4;
  }

  /* 6. Location and work preferences — 10 */
  const preferredLocations = (preferences?.locations ?? []).map(norm);
  const preferredModels = preferences?.work_models ?? [];
  const jobLocation = `${job.location_text} ${job.city} ${job.country}`.toLowerCase();
  // India-first: only match roles where the user is eligible.
  // ELIGIBLE countries under default preferences: India + Worldwide remote.
  // Jobs with on-site/hybrid location outside India are ineligible.
  const jobIsInIndia = job.country === "India" || job.location_text.includes("India");
  const locationHit =
    preferredLocations.length === 0 ||
    preferredLocations.some(
      (l) =>
        jobLocation.includes(l) ||
        l.includes(norm(job.country)) ||
        l.includes(norm(job.city)) ||
        (norm(job.city).length > 0 && l.includes(norm(job.city))),
    );
  // India-first override: if the job is not in India and not remote-eligible,
  // it cannot receive location points regardless of text matching.
  const indiaFirstOk = preferredLocations.length > 0
    ? jobIsInIndia || preferredLocations.some((l) => l.includes("Worldwide remote"))
    : true; // no geographic preference set → normal matching
  const modelHit =
    preferredModels.length === 0 || preferredModels.includes(job.work_model);
  let locationPoints = 0;
  if (locationHit && modelHit && indiaFirstOk) locationPoints = 10;
  else if (locationHit || modelHit) locationPoints = 6;
  if (!locationHit) {
    warnings.push(
      `Job is in ${job.location_text}; your preferred locations are ${preferences?.locations.join(", ") || "not set"}.`,
    );
  }
  if (!modelHit && preferredModels.length > 0) {
    warnings.push(
      `Work model is ${job.work_model}; you prefer ${preferredModels.join(", ")}.`,
    );
  }

  /* 7. Additional requirements — 5 */
  let additionalPoints = 0;
  const typeOk =
    !preferences ||
    preferences.employment_types.length === 0 ||
    preferences.employment_types.includes(job.employment_type);
  const deadlineOk = job.job_status !== "closed";
  if (typeOk) additionalPoints += 2.5;
  if (deadlineOk) additionalPoints += 2.5;
  if (job.is_sample) {
    // Sample listings are capped so demo rows never masquerade as strong matches.
  }

  const breakdown: MatchBreakdown = {
    technical_skills: round(technicalPoints),
    projects: round(projectPoints),
    role_alignment: round(rolePoints),
    education: round(educationPoints),
    experience: round(experiencePoints),
    location: round(locationPoints),
    additional: round(additionalPoints),
  };

  let score = Math.round(
    Object.values(breakdown).reduce((sum, v) => sum + v, 0),
  );
  score = Math.max(0, Math.min(100, score));
  if (job.job_status === "closed") score = Math.min(score, 50);

  const recommendations: string[] = [];
  if (missingRequired.length > 0) {
    recommendations.push(
      `Add or brush up on: ${missingRequired.slice(0, 5).join(", ")}.`,
    );
  }
  if (relevantProjects.length === 0 && (profile?.projects.length ?? 0) > 0) {
    recommendations.push(
      "None of your projects clearly overlap this job — consider surfacing a closer project.",
    );
  }
  if (!hasEducation) {
    recommendations.push("Complete the Education section of your Master Profile.");
  }
  if (job.is_sample) {
    recommendations.push(
      "This is sample data — no real source exists for it; run discovery for real listings.",
    );
  }

  return {
    score,
    breakdown,
    matched_skills: [...matchedRequired, ...matchedPreferred],
    missing_skills: [...missingRequired, ...missingPreferred],
    relevant_projects: relevantProjects.map((p) => p.title),
    eligibility_warnings: warnings,
    recommendations,
  };
}

function compareGradYear(gradYear: string, requiredYear: string): boolean {
  const g = Number(gradYear);
  const r = Number(requiredYear);
  if (Number.isNaN(g) || Number.isNaN(r)) return true;
  return g <= r;
}
