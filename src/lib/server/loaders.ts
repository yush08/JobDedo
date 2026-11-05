import "server-only";

import { connection } from "next/server";

import { getDataStore, getProfileBundle, toProfileData } from "@/lib/db";
import { aggregateAnalytics } from "@/features/analytics/aggregate";
import { scoreJobs, runJobQuery } from "@/features/jobs/query";
import { discoveryReady, stalenessMs } from "@/features/discovery/service";
import { jobQuerySchema, type JobQueryInput } from "@/lib/validation/schemas";
import type {
  Application,
  AppNotification,
  DiscoveryRun,
  JobWithRelations,
  Paginated,
  ProfileData,
} from "@/types";
import type { ProfileBundle } from "@/lib/db";

/**
 * Server-side data loaders for dashboard pages.
 *
 * Every loader starts with `await connection()` so pages render per request
 * (Next 16 `cacheComponents`): without it, the store would be read once at
 * build time and the dashboard would show frozen data.
 * Pages wrap these loaders in `<Suspense>` for streaming + loading states.
 */

export interface OverviewData {
  firstName: string;
  stats: ReturnType<typeof aggregateAnalytics>["totals"];
  analyticsNote: { hasSample: boolean; sampleCount: number };
  recommended: JobWithRelations[];
  recentlyDiscovered: JobWithRelations[];
  topInternships: JobWithRelations[];
  savedJobs: JobWithRelations[];
  applications: Application[];
  upcomingDeadlines: { job: JobWithRelations; daysLeft: number }[];
  followUpApplications: Application[];
  discovery: {
    latest: DiscoveryRun | null;
    stale: boolean;
    ageMs: number | null;
    thresholdMs: number;
    adaptersReady: boolean;
  };
  notifications: AppNotification[];
  jobCount: number;
}

export async function loadOverview(): Promise<OverviewData> {
  await connection();

  const db = getDataStore();
  const bundle = await getProfileBundle();
  const [jobs, applications, run, notifications] = await Promise.all([
    db.listJobsFull(),
    db.listApplications(),
    db.getLatestDiscoveryRun(),
    db.listNotifications(),
  ]);

  const scored = scoreJobs(
    jobs,
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  );

  const totals = aggregateAnalytics({
    jobs: scored,
    applications,
    resumeVersions: await db.listResumeVersions(),
    recruiters: await db.listRecruiters(),
    notifications,
    includeSample: false,
  }).totals;

  const open = scored.filter((j) => j.job_status !== "closed");
  const byScore = [...open].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));

  const recommended = byScore.slice(0, 4);
  const recommendedIds = new Set(recommended.map((j) => j.id));

  const recentlyDiscovered = [...open]
    .filter((j) => !recommendedIds.has(j.id))
    .sort((a, b) => b.first_discovered_at.localeCompare(a.first_discovered_at))
    .slice(0, 4);

  const topInternships = byScore
    .filter((j) => j.employment_type === "internship" && !recommendedIds.has(j.id))
    .slice(0, 4);

  const savedJobs = scored
    .filter((j) => j.saved)
    .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))
    .slice(0, 4);

  const now = Date.now();
  const upcomingDeadlines = open
    .filter((j) => j.closing_date)
    .map((job) => {
      const end = new Date(`${job.closing_date}T23:59:59Z`).getTime();
      return { job, daysLeft: Math.ceil((end - now) / 86_400_000) };
    })
    .filter((row) => row.daysLeft >= 0 && row.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  const followUpApplications = applications
    .filter(
      (a) =>
        a.follow_up_at &&
        new Date(a.follow_up_at).getTime() >= now - 7 * 86_400_000 &&
        !["rejected", "withdrawn", "offer"].includes(a.stage),
    )
    .sort((a, b) => (a.follow_up_at ?? "").localeCompare(b.follow_up_at ?? ""))
    .slice(0, 5);

  const stale = stalenessMs(run, bundle.preferences.search_frequency_hours);

  return {
    firstName: bundle.profile.personal.full_name.split(" ")[0] || "there",
    stats: totals,
    analyticsNote: {
      hasSample: totals.sample_jobs > 0,
      sampleCount: totals.sample_jobs,
    },
    recommended,
    recentlyDiscovered,
    topInternships,
    savedJobs,
    applications: applications.slice(0, 5),
    upcomingDeadlines,
    followUpApplications,
    discovery: {
      latest: run,
      stale: stale.stale,
      ageMs: stale.ageMs,
      thresholdMs: stale.thresholdMs,
      adaptersReady: discoveryReady(),
    },
    notifications,
    jobCount: scored.length,
  };
}

export async function loadJobsPage(
  rawSearchParams: Record<string, string | string[] | undefined>,
): Promise<{
  page: Paginated<JobWithRelations>;
  query: JobQueryInput;
  bundle: ProfileBundle;
  jobCount: number;
  /** Rows flagged `is_sample` — never counted as real discoveries. */
  sampleCount: number;
  hasSample: boolean;
  facets: { roles: string[]; locations: string[]; companies: string[] };
}> {
  await connection();

  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (typeof value === "string") flat[key] = value;
    else if (Array.isArray(value)) flat[key] = value[0] ?? "";
  }
  const parsed = jobQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : jobQuerySchema.parse({});

  const db = getDataStore();
  const bundle = await getProfileBundle();
  const jobs = await db.listJobsFull();

  const page = runJobQuery(
    jobs,
    query,
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  );

  const uniq = (values: string[]) =>
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    page,
    query,
    bundle,
    jobCount: jobs.length,
    sampleCount: jobs.filter((j) => j.is_sample).length,
    hasSample: jobs.some((j) => j.is_sample),
    facets: {
      roles: uniq(jobs.flatMap((j) => j.role_tags)),
      locations: uniq(jobs.map((j) => j.city || j.location_text)),
      companies: uniq(jobs.map((j) => j.company?.name ?? "")),
    },
  };
}

export async function loadJobDetail(id: string) {
  await connection();

  const db = getDataStore();
  const bundle = await getProfileBundle();
  const job = await db.getJobFull(id);
  if (!job) return null;

  const [verification, history, match] = await Promise.all([
    db.getVerification(id),
    db.listVerificationHistory(id),
    db.getLatestMatch(id),
  ]);

  const scored = scoreJobs(
    [job],
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  )[0]!;

  return { job: scored, verification, history, match, bundle };
}

export async function loadApplications() {
  await connection();
  const db = getDataStore();
  const applications = await db.listApplications();
  const jobs = await db.listJobsFull();
  return { applications, jobs };
}

export async function loadAnalytics(includeSample: boolean) {
  await connection();
  const db = getDataStore();
  const bundle = await getProfileBundle();
  const [jobs, applications, resumeVersions, recruiters, notifications] =
    await Promise.all([
      db.listJobsFull(),
      db.listApplications(),
      db.listResumeVersions(),
      db.listRecruiters(),
      db.listNotifications(),
    ]);

  const scored = scoreJobs(
    jobs,
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  );

  return aggregateAnalytics({
    jobs: scored,
    applications,
    resumeVersions,
    recruiters,
    notifications,
    includeSample,
  });
}

export async function loadSavedJobs() {
  await connection();
  const db = getDataStore();
  const bundle = await getProfileBundle();
  const jobs = await db.listJobsFull();
  const scored = scoreJobs(
    jobs,
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  );
  return scored.filter((j) => j.saved);
}

export type { ProfileBundle, ProfileData };
