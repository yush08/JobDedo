import type { NextRequest } from "next/server";
import { getDataStore, getProfileBundle } from "@/lib/db";
import { profileSchema } from "@/lib/validation/schemas";
import { ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";

/** GET /api/v1/profile — the single personal profile + all profile sections. */
export const GET = withErrorHandling(async () => {
  const bundle = await getProfileBundle();
  return ok({
    profile: bundle.profile,
    education: bundle.education,
    skills: bundle.skills,
    projects: bundle.projects,
    experiences: bundle.experiences,
    leadership: bundle.leadership,
    certifications: bundle.certifications,
  });
});

/** PUT /api/v1/profile — replace profile personal info + sections (validated). */
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "profile:put", 30, 60_000);
  if (limited) return limited;

  const body = await readJson(request, profileSchema);
  if (body instanceof Response) return body;

  const db = getDataStore();
  await db.ensureProfile();
  await db.saveProfile(body.personal);
  await db.saveProfileChildren({
    education: body.education.map((row, i) => ({ ...row, sort_order: i })),
    skills: body.skills,
    projects: body.projects.map((row, i) => ({ ...row, sort_order: i })),
    experiences: body.experiences.map((row, i) => ({ ...row, sort_order: i })),
    leadership: body.leadership.map((row, i) => ({ ...row, sort_order: i })),
    certifications: body.certifications.map((row, i) => ({ ...row, sort_order: i })),
  });

  const bundle = await getProfileBundle();
  return ok({
    profile: bundle.profile,
    education: bundle.education,
    skills: bundle.skills,
    projects: bundle.projects,
    experiences: bundle.experiences,
    leadership: bundle.leadership,
    certifications: bundle.certifications,
  });
});
