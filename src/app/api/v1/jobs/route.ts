import type { NextRequest } from "next/server";
import { getDataStore, getProfileBundle, toProfileData } from "@/lib/db";
import { jobQuerySchema } from "@/lib/validation/schemas";
import { fail, ok, withErrorHandling } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";
import { runJobQuery } from "@/features/jobs/query";

/**
 * GET /api/v1/jobs — filtered, sorted, paginated job list.
 * Every query parameter is validated with Zod; matching uses the Master
 * Profile so scores are explainable and consistent with the UI.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "jobs:get", 240, 60_000);
  if (limited) return limited;

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = jobQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid query parameters", 400, parsed.error);
  }

  const db = getDataStore();
  const [jobs, bundle] = await Promise.all([db.listJobsFull(), getProfileBundle()]);

  const page = runJobQuery(
    jobs,
    parsed.data,
    toProfileData(bundle),
    bundle.preferences,
    bundle.roles,
  );

  return ok(page);
});
