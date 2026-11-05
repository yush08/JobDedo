import type { JobPreferences, JobWithRelations, Paginated, RolePreference, ProfileData } from "@/types";
import type { JobQueryInput } from "@/lib/validation/schemas";
import { computeMatch } from "@/features/matching/score";

/**
 * Shared, pure job-list pipeline: score -> filter -> sort -> paginate.
 * Used by the Discover page, the dashboard and GET /api/v1/jobs so every
 * surface applies identical rules.
 */

export function scoreJobs(
  jobs: JobWithRelations[],
  profile: ProfileData | null,
  preferences: JobPreferences | null,
  roles: RolePreference[],
): JobWithRelations[] {
  return jobs.map((job) => {
    const match = computeMatch(job, profile, preferences, roles);
    return { ...job, match_score: match.score };
  });
}

export function applyJobFilters(
  jobs: JobWithRelations[],
  query: JobQueryInput,
): JobWithRelations[] {
  const q = query.q.trim().toLowerCase();
  const skills = query.skills
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const now = Date.now();

  return jobs.filter((job) => {
    if (!query.include_sample && job.is_sample) return false;
    if (!query.include_closed && job.job_status === "closed") return false;

    if (query.saved_only && !job.saved) return false;

    if (query.role) {
      const roleOk =
        job.role_tags.some((r) => r.toLowerCase() === query.role.toLowerCase()) ||
        job.title.toLowerCase().includes(query.role.toLowerCase());
      if (!roleOk) return false;
    }

    if (query.location) {
      const loc = query.location.toLowerCase();
      const haystack = `${job.location_text} ${job.city} ${job.country}`.toLowerCase();
      if (!haystack.includes(loc)) return false;
    }

    if (query.work_model && job.work_model !== query.work_model) return false;
    if (query.employment_type && job.employment_type !== query.employment_type) return false;
    if (query.experience && job.experience_level !== query.experience) return false;

    if (query.verification && job.verification_status !== query.verification) {
      return false;
    }

    if (query.company) {
      const company = job.company?.name.toLowerCase() ?? "";
      if (!company.includes(query.company.toLowerCase())) return false;
    }

    if (query.min_salary) {
      const salary = job.salary_max ?? job.salary_min ?? job.stipend_amount ?? 0;
      if (salary < query.min_salary) return false;
    }

    if (query.posted_within_days) {
      const posted = job.posted_at ? new Date(job.posted_at).getTime() : null;
      if (posted === null) return false;
      if (now - posted > query.posted_within_days * 86_400_000) return false;
    }

    if (skills.length) {
      const jobSkills = [
        ...job.skills,
        ...job.requirements.required_skills,
        ...job.requirements.preferred_skills,
      ].map((s) => s.toLowerCase());
      if (!skills.every((skill) => jobSkills.some((js) => js.includes(skill)))) {
        return false;
      }
    }

    if (q) {
      const haystack = [
        job.title,
        job.company?.name ?? "",
        job.location_text,
        job.description,
        job.skills.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

export function sortJobs(
  jobs: JobWithRelations[],
  sort: JobQueryInput["sort"],
): JobWithRelations[] {
  const rows = [...jobs];
  const time = (v: string | null) => (v ? new Date(v).getTime() : 0);

  switch (sort) {
    case "recently_posted":
      rows.sort((a, b) => time(b.posted_at) - time(a.posted_at));
      break;
    case "recently_discovered":
      rows.sort((a, b) => time(b.first_discovered_at) - time(a.first_discovered_at));
      break;
    case "highest_salary":
      rows.sort(
        (a, b) =>
          (b.salary_max ?? b.salary_min ?? b.stipend_amount ?? 0) -
          (a.salary_max ?? a.salary_min ?? a.stipend_amount ?? 0),
      );
      break;
    case "deadline": {
      const deadline = (v: string | null) => {
        if (!v) return Number.POSITIVE_INFINITY;
        const d = new Date(`${v}T23:59:59Z`).getTime();
        return Number.isNaN(d) ? Number.POSITIVE_INFINITY : d;
      };
      rows.sort((a, b) => {
        const da = a.job_status === "closed" ? Number.POSITIVE_INFINITY : deadline(a.closing_date);
        const db = b.job_status === "closed" ? Number.POSITIVE_INFINITY : deadline(b.closing_date);
        return da - db;
      });
      break;
    }
    case "best_match":
    default:
      rows.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
      break;
  }
  return rows;
}

export function paginate<T>(rows: T[], page: number, pageSize: number): Paginated<T> {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  };
}

export function runJobQuery(
  jobs: JobWithRelations[],
  query: JobQueryInput,
  profile: ProfileData | null,
  preferences: JobPreferences | null,
  roles: RolePreference[],
): Paginated<JobWithRelations> {
  const scored = scoreJobs(jobs, profile, preferences, roles);
  const filtered = applyJobFilters(scored, query);
  const sorted = sortJobs(filtered, query.sort);
  return paginate(sorted, query.page, query.pageSize);
}
