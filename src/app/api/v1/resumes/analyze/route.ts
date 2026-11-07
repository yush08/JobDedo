import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { extractJobRequirements } from "@/features/ats/analysis";
import { scoreResumeAgainstJob } from "@/features/ats/scoring";

/**
 * POST /api/v1/resumes/analyze — Resume quality & job alignment engine.
 *
 * Three independent, explainable scores:
 * 1. Document Quality — structure, readability, extraction, contact, formatting
 * 2. Job Coverage — weighted coverage of actual JD requirements
 * 3. Evidence Alignment — evidence quality for matched requirements
 *
 * Returns a structured per-requirement breakdown for explainability.
 * All evidence comes from the uploaded resume text, not the master profile.
 */

export const POST = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const resumeVersionId = searchParams.get("resumeVersionId") ?? "";

  if (!resumeVersionId) {
    return new Response(
      JSON.stringify({ error: "resumeVersionId is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Read the request body for job description
  let jobDescription = "";
  try {
    const body = await request.json();
    jobDescription = body.job_description || "";
  } catch {
    // No body or invalid JSON — proceed without job description
  }

  if (!jobDescription || jobDescription.trim().length < 10) {
    return new Response(
      JSON.stringify({
        error: "Job description is required and must be at least 10 characters.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Read the resume version
  const dbStore = getDataStore();
  const versions = await dbStore.listResumeVersions();
  const version = versions.find((v) => v.id === resumeVersionId);

  if (!version) {
    return new Response(
      JSON.stringify({ error: "Resume version not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Read the resume to get the raw text
  const resumes = await dbStore.listResumes();
  const resume = resumes.find((r) => r.id === version.resume_id);

  if (!resume) {
    return new Response(
      JSON.stringify({ error: "Resume not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- Validation: resume must have extracted text ---
  const rawText = version.raw_text ?? "";
  if (!rawText.trim()) {
    return new Response(
      JSON.stringify({
        error:
          "Resume has no extracted text. Please upload a PDF or DOCX file so the resume content can be analyzed.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- Extract requirements from the supplied job description only ---
  const requirements = extractJobRequirements(jobDescription);

  // --- Score: document quality, job coverage, evidence alignment ---
  const scoring = scoreResumeAgainstJob(rawText, requirements);

  // Persist the ATS report
  await dbStore.createAtsReport({
    resume_version_id: version.id,
    job_id: null,
    document_quality: scoring.documentQuality.score,
    job_coverage: scoring.coverage.score,
    evidence_alignment: scoring.alignment.score,
    report: {
      resume_id: resume.id,
      job_description: jobDescription,
      findings: scoring.missingKeywords,
      suggestions: scoring.suggestions,
    },
  });

  return new Response(
    JSON.stringify({
      documentQualityScore: scoring.documentQuality.score,
      jobCoverageScore: scoring.coverage.score,
      alignmentScore: scoring.alignment.score,
      missingKeywords: scoring.missingKeywords,
      weakBullets: scoring.weakBullets,
      formattingIssues: scoring.documentQuality.formattingIssues,
      suggestions: scoring.suggestions,
      jobDescription,
      explanation: scoring.explanation,
      disclaimer:
        "This is JobDedo's internal estimate of resume quality and alignment — it does not reproduce any employer's ATS and does not predict selection outcomes.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
