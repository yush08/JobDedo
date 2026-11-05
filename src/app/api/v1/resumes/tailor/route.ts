import { withErrorHandling } from "@/lib/api/responses";
import { db } from "@/lib/supabase/server";
import { ResumeVersion } from "@/types";
import { randomUUID } from "node:crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * POST /api/v1/resumes/tailor — Job-specific resume tailoring (Milestone 5).
 *
 * Contract when implemented:
 * - multipart/form-data with "job_description" (text) and optional "resume_version_id"
 * - uses the master profile + selected job description to generate a tailored resume
 * - never invents skills, projects, certifications, internship experience, employment, dates, metrics or achievements
 * - shows supporting profile evidence for generated claims
 * - allows editing, reordering, rewriting, shortening, keyword alignment, project prioritization
 * - returns a draft version that can be saved or exported
 * - preserves the original upload and existing versions
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("multipart/form-data")) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const formData = await request.formData();
  const jobDescription = formData.get("job_description") as string | null;
  const resumeVersionId = formData.get("resume_version_id") as string | null;

  if (!jobDescription || jobDescription.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "No job description provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch the master profile and existing resume data
  // In a full implementation, this would query Supabase for the user's profile
  // For now, we work with the provided data and return a structured draft

  // Extract key terms from the job description for keyword alignment
  const lowerJd = jobDescription.toLowerCase();
  const jdTerms = new Set(
    lowerJd.split(/\s+/).filter((w: string) => w.length > 3)
  );

  // Build a tailored resume draft using only verified profile facts
  // Never invent skills, projects, certifications, or employment history
  const tailoredContent = {
    headline: "",
    summary: "",
    skills: [],
    experience: [],
    education: [],
    projects: [],
  };

  // Simple keyword alignment: identify which JD terms could potentially match
  // based on the existing profile (in a real impl, this would query the profile)
  const alignedSkills: string[] = [];
  const missingSkills: string[] = [];

  // The actual tailoring logic would use the master profile and verified facts
  // For now, return a structured draft that the frontend can display for editing
  const draftId = randomUUID();
  const versionNumber = 1;

  return new Response(
    JSON.stringify({
      draftId,
      versionNumber,
      tailoredContent,
      alignedSkills,
      missingSkills,
      jobTitle: extractJobTitle(jobDescription),
      // Frontend should present this as an editable draft for user review.
      // Only after user confirmation should the saveTailoredVersion be called.
      requiresUserReview: true,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

/** Very simple job title extraction from JD text. */
function extractJobTitle(text: string): string {
  const lines = text.split("\n").filter((l) => l.length > 0);
  // Look for the first line that looks like a job title
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 100) {
      return trimmed;
    }
  }
  return "Position";
}