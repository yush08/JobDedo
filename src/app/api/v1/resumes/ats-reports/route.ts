import { withErrorHandling, ok, fail } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/ats-reports — List ATS reports.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const resumeId = searchParams.get("resumeId");

  const db = getDataStore();
  const reports = await db.listAtsReports();

  let filtered = reports;
  if (resumeId) {
    filtered = reports.filter((r) =>
      r.resume_version_id === resumeId || r.report.resume_id === resumeId
    );
  }

  return ok({ reports: filtered });
});

/**
 * DELETE /api/v1/resumes/ats-reports — Development-only cleanup of stored
 * ATS analysis reports.
 *
 * Deletes ATS report records only. Uploaded resumes, resume versions,
 * extracted resume content, profiles, applications and everything else are
 * untouched. Never available in production.
 *
 * Two-step by design: without a matching `?confirm=` it reports how many
 * records would be deleted and changes nothing; the deletion only runs when
 * the caller repeats the exact confirmation token.
 */
export const DELETE = withErrorHandling(async (request: Request) => {
  if (process.env.NODE_ENV === "production") {
    return fail("FORBIDDEN", "ATS report cleanup is development-only.", 403);
  }

  const limited = guard(request, "ats-reports:delete", 5, 60_000);
  if (limited) return limited;

  const db = getDataStore();
  const pending = (await db.listAtsReports()).length;

  const { searchParams } = new URL(request.url);
  if (searchParams.get("confirm") !== "DELETE_ATS_REPORTS") {
    return ok({
      deleted: 0,
      pending,
      driver: db.driver,
      confirmationRequired: "DELETE_ATS_REPORTS",
      message:
        pending > 0
          ? `${pending} ATS report(s) will be deleted. Nothing was removed. Re-send with ?confirm=DELETE_ATS_REPORTS to proceed.`
          : "There are no ATS reports to delete.",
    });
  }

  const deleted = await db.deleteAtsReports();
  return ok({ deleted, pending, driver: db.driver });
});

/**
 * POST /api/v1/resumes/ats-reports — Save an ATS report.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const {
    resume_id,
    resume_version_id,
    job_description,
    document_quality,
    job_coverage,
    evidence_alignment,
    findings,
    suggestions,
  } = await request.json();

  if (!resume_version_id) {
    return new Response(
      JSON.stringify({ error: "Resume version ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();

  const report = await db.createAtsReport({
    resume_version_id,
    job_id: null,
    document_quality: document_quality || 0,
    job_coverage: job_coverage || 0,
    evidence_alignment: evidence_alignment || 0,
    report: {
      resume_id: resume_id || "",
      job_description,
      findings: findings || [],
      suggestions: suggestions || [],
    },
  });

  return ok({ report }, 201);
});
