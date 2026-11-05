import { notImplemented, ok, withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/versions — stored resume versions (real rows).
 * Empty until Resume Studio (Milestone 5) creates some.
 */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const [resumes, versions] = await Promise.all([
    db.listResumes(),
    db.listResumeVersions(),
  ]);
  return ok({ resumes, versions, total: versions.length });
});

export const POST = withErrorHandling(async () =>
  notImplemented("Resume version creation", "Milestone 5 (Resume Studio)"),
);
