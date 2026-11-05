import type { NextRequest } from "next/server";
import { getDataStore, getProfileBundle, toProfileData } from "@/lib/db";
import { fail, notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";
import { computeMatch } from "@/features/matching/score";

/**
 * POST /api/v1/jobs/[id]/match — (re)compute the explainable match score
 * against the Master Profile and persist the explanation.
 */
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const limited = guard(request, "jobs:match", 120, 60_000);
    if (limited) return limited;

    const { id } = await params;
    const db = getDataStore();
    const job = await db.getJobFull(id);
    if (!job) return notFound(`Job ${id} not found`);

    const bundle = await getProfileBundle();
    const result = computeMatch(
      job,
      toProfileData(bundle),
      bundle.preferences,
      bundle.roles,
    );

    const stored = await db.upsertMatch({
      job_id: job.id,
      profile_id: bundle.profile.id,
      score: result.score,
      breakdown: result.breakdown,
      matched_skills: result.matched_skills,
      missing_skills: result.missing_skills,
      relevant_projects: result.relevant_projects,
      eligibility_warnings: result.eligibility_warnings,
      recommendations: result.recommendations,
    });

    if (job.is_sample) {
      return ok(
        {
          match: stored,
          note: "Sample listing — score is computed against sample requirements, not a real posting.",
        },
        201,
      );
    }
    return ok({ match: stored }, 201);
  },
);

export const GET = withErrorHandling(async () =>
  fail("METHOD_NOT_ALLOWED", "Use POST to compute a match", 405),
);
