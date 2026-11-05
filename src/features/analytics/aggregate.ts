import type {
  Application,
  AppNotification,
  Job,
  JobWithRelations,
  ResumeVersion,
  Recruiter,
} from "@/types";

/**
 * Pure analytics aggregation (spec §17). Operates strictly on rows that
 * actually exist in storage — no synthetic activity is ever generated.
 */

export interface AnalyticsInput {
  jobs: JobWithRelations[];
  applications: Application[];
  resumeVersions: ResumeVersion[];
  recruiters: Recruiter[];
  notifications: AppNotification[];
  /** Sample rows are reported separately so demo data never reads as real activity. */
  includeSample: boolean;
}

export interface AnalyticsSummary {
  totals: {
    jobs_discovered: number;
    sample_jobs: number;
    real_jobs: number;
    strong_matches: number;
    verified: number;
    saved: number;
    applications_submitted: number;
    follow_ups_due: number;
    interviews: number;
    offers: number;
    rejections: number;
    resume_versions: number;
    recruiters_found: number;
    unread_notifications: number;
  };
  jobs_over_time: { date: string; count: number }[];
  by_role: { label: string; count: number }[];
  by_location: { label: string; count: number }[];
  by_source: { label: string; count: number }[];
  by_employment: { label: string; count: number }[];
  verification_distribution: { label: string; count: number }[];
  applications_by_stage: { label: string; count: number }[];
  outcomes: { applied: number; interview: number; offer: number; rejected: number; withdrawn: number };
  interview_conversion: number; // 0-100
  offer_conversion: number; // 0-100
}

const DAY = 86_400_000;

function topCount(
  values: string[][],
  limit = 8,
): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const entries of values) {
    const key = entries.filter(Boolean).join(", ") || "Unspecified";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function aggregateAnalytics(input: AnalyticsInput): AnalyticsSummary {
  const jobs = input.includeSample
    ? input.jobs
    : input.jobs.filter((j) => !j.is_sample);

  const sampleJobs = input.jobs.filter((j) => j.is_sample).length;

  const discoveredByDay = new Map<string, number>();
  const cutoff = Date.now() - 30 * DAY;
  for (const job of jobs) {
    const t = new Date(job.first_discovered_at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    discoveredByDay.set(day, (discoveredByDay.get(day) ?? 0) + 1);
  }
  const jobsOverTime: { date: string; count: number }[] = [];
  for (let i = 30; i >= 0; i--) {
    const date = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    jobsOverTime.push({ date, count: discoveredByDay.get(date) ?? 0 });
  }

  const apps = input.applications;
  const applied = apps.filter(
    (a) =>
      a.applied_at !== null ||
      ["applied", "recruiter_contacted", "interview", "offer", "rejected", "withdrawn"].includes(
        a.stage,
      ),
  );
  const interviewed = apps.filter((a) => a.stage === "interview" || a.stage === "offer");
  const offers = apps.filter((a) => a.stage === "offer");
  const rejections = apps.filter((a) => a.stage === "rejected");
  const withdrawn = apps.filter((a) => a.stage === "withdrawn");
  const now = Date.now();
  const followUpsDue = apps.filter(
    (a) =>
      a.follow_up_at &&
      new Date(a.follow_up_at).getTime() <= now + 7 * DAY &&
      !["rejected", "withdrawn", "offer"].includes(a.stage),
  );

  const stageCounts = new Map<string, number>();
  for (const app of apps) {
    stageCounts.set(app.stage, (stageCounts.get(app.stage) ?? 0) + 1);
  }

  return {
    totals: {
      jobs_discovered: jobs.length,
      sample_jobs: sampleJobs,
      real_jobs: input.jobs.length - sampleJobs,
      strong_matches: jobs.filter((j) => (j.match_score ?? 0) >= 75).length,
      verified: jobs.filter((j) => j.verification_status === "VERIFIED").length,
      saved: jobs.filter((j) => j.saved).length,
      applications_submitted: applied.length,
      follow_ups_due: followUpsDue.length,
      interviews: interviewed.length,
      offers: offers.length,
      rejections: rejections.length,
      resume_versions: input.resumeVersions.length,
      recruiters_found: input.recruiters.length,
      unread_notifications: input.notifications.filter((n) => !n.read_at).length,
    },
    jobs_over_time: jobsOverTime,
    by_role: topCount(jobs.map((j) => j.role_tags)),
    by_location: topCount(jobs.map((j) => [j.city || j.location_text, j.country])),
    by_source: topCount(
      jobs.map((j) => [j.source?.name ?? (j.is_sample ? "Sample data" : "Unknown")]),
    ),
    by_employment: topCount(jobs.map((j) => [j.employment_type])),
    verification_distribution: (() => {
      const map = new Map<string, number>();
      for (const job of jobs) {
        map.set(job.verification_status, (map.get(job.verification_status) ?? 0) + 1);
      }
      return [...map.entries()].map(([label, count]) => ({ label, count }));
    })(),
    applications_by_stage: [...stageCounts.entries()].map(([label, count]) => ({
      label,
      count,
    })),
    outcomes: {
      applied: applied.length,
      interview: interviewed.length,
      offer: offers.length,
      rejected: rejections.length,
      withdrawn: withdrawn.length,
    },
    interview_conversion: applied.length
      ? Math.round((interviewed.length / applied.length) * 100)
      : 0,
    offer_conversion: applied.length ? Math.round((offers.length / applied.length) * 100) : 0,
  };
}
