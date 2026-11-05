import { withErrorHandling, ok } from "@/lib/api/responses";
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
      r.resume_version_id === resumeId || (r.report as any)?.resume_id === resumeId
    );
  }

  return ok({ reports: filtered });
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