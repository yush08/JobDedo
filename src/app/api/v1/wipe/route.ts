import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { fail, ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";
import { z } from "zod";

const wipeSchema = z.object({
  confirm: z.literal(true),
  scope: z.enum(["personal_data"]).default("personal_data"),
});

/**
 * POST /api/v1/wipe — delete personal data.
 *
 * Removes profile content, preferences, saved jobs, matches, applications,
 * resumes, recruiters, drafts and notifications. Sample/demo listings and
 * app configuration remain (they are not personal data).
 * Requires `{ "confirm": true }`.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "wipe", 5, 60_000);
  if (limited) return limited;

  const body = await readJson(request, wipeSchema);
  if (body instanceof Response) return body;
  if (body.confirm !== true) {
    return fail("CONFIRMATION_REQUIRED", "Send { confirm: true } to delete data.", 422);
  }

  const db = getDataStore();
  await db.wipe();
  return ok({
    deleted: "personal_data",
    retained: ["sample_jobs", "companies", "job_sources"],
    message: "Personal data deleted. Sample listings were kept.",
  });
});
