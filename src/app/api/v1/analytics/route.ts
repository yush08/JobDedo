import type { NextRequest } from "next/server";
import { getDataStore, getProfileBundle, toProfileData } from "@/lib/db";
import { ok, withErrorHandling } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";
import { aggregateAnalytics } from "@/features/analytics/aggregate";
import { scoreJobs } from "@/features/jobs/query";

/**
 * GET /api/v1/analytics — aggregates computed strictly from stored rows.
 * `include_sample=false` excludes sample listings so demo data never reads
 * as real activity.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "analytics:get", 120, 60_000);
  if (limited) return limited;

  const includeSample = request.nextUrl.searchParams.get("include_sample") !== "false";

  const db = getDataStore();
  const [jobs, applications, resumeVersions, recruiters, notifications, bundle] =
    await Promise.all([
      db.listJobsFull(),
      db.listApplications(),
      db.listResumeVersions(),
      db.listRecruiters(),
      db.listNotifications(),
      getProfileBundle(),
    ]);

  const scored = scoreJobs(
    jobs,
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  );

  const summary = aggregateAnalytics({
    jobs: scored,
    applications,
    resumeVersions,
    recruiters,
    notifications,
    includeSample,
  });

  return ok(summary);
});
