import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore, getProfileBundle, toProfileData } from "@/lib/db";
import type { ProfileData } from "@/types";

/**
 * POST /api/v1/resumes/analyze — Resume quality & job alignment engine (Milestone 5).
 *
 * Contract when implemented:
 * - returns three separate scores:
 *   1. document quality (0-100)
 *   2. job requirement coverage (0-100)
 *   3. evidence-backed candidate alignment (0-100)
 * - provides missing keywords, weak bullets, formatting issues and actionable suggestions
 * - explicitly does NOT replicate any employer's ATS and must not imply selection outcomes
 * - scores are backed by actual profile evidence, not invented data
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
  const rawTextCheck = version.raw_text ?? "";
  if (!rawTextCheck.trim()) {
    return new Response(
      JSON.stringify({
        error:
          "Resume has no extracted text. Please upload a PDF or DOCX file so the resume content can be analyzed.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Read the profile bundle for evidence
  const profileBundle = await getProfileBundle();
  // Score functions operate on the flat ProfileData shape (with top-level
  // `personal`), not the bundle — passing the bundle left the personal-info
  // checks permanently dead (they read `bundle.personal`, which is undefined).
  const profileData = toProfileData(profileBundle);

  // --- Document Quality Score ---
  // Based on: section completeness, contact info, formatting, readability
  const rawText = version.raw_text ?? "";
  const documentQualityScore = computeDocumentQuality(rawText);

  // --- Job Requirement Coverage Score ---
  // Based on: how many profile skills/projects match common job requirements
  // For now, use a placeholder based on section completeness
  const jobCoverageScore = computeJobCoverageScore(rawText, profileData);

  // --- Evidence-Backed Candidate Alignment Score ---
  // Based on: overlap between profile and typical job requirements,
  // grounded in actual profile data (never invented)
  const alignmentScore = computeEvidenceBackedAlignment(rawText, profileData);

  // --- Missing Keywords & Weak Bullets ---
  const missingKeywords = extractMissingKeywords(rawText, profileData);
  const weakBullets = extractWeakBullets(rawText);
  const formattingIssues = extractFormattingIssues(rawText);

  // --- Actionable Suggestions ---
  const suggestions = generateSuggestions(
    documentQualityScore,
    jobCoverageScore,
    alignmentScore,
    missingKeywords,
    weakBullets,
    formattingIssues,
  );

  // Persist the ATS report
  await dbStore.createAtsReport({
    resume_version_id: version.id,
    job_id: null,
    document_quality: documentQualityScore,
    job_coverage: jobCoverageScore,
    evidence_alignment: alignmentScore,
    report: {
      resume_id: resume.id,
      job_description: jobDescription,
      findings: missingKeywords,
      suggestions,
    },
  });

  return new Response(
    JSON.stringify({
      documentQualityScore,
      jobCoverageScore,
      alignmentScore,
      missingKeywords,
      weakBullets,
      formattingIssues,
      suggestions,
      jobDescription,
      // Explicitly not an ATS replica - these are JobDedo's own estimates
      disclaimer:
        "This is JobDedo's internal estimate of resume quality and alignment — it does not reproduce any employer's ATS and does not predict selection outcomes.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

/* ------------------------------------------------------------------ */
/* Scoring helpers (placeholder implementations – replace with real logic) */
/* ------------------------------------------------------------------ */

function computeDocumentQuality(rawText: string): number {
  // Base score, adjusted by section presence and formatting
  let score = 50; // baseline
  if (!rawText) return 50;
  const lines = rawText.split("\n");
  // Contact/email detection
  const hasContact = lines.some((l) => /[\w\.-]+@[\w\.-]+\.\w{2,}/.test(l) || l.toLowerCase().includes("contact"));
  if (hasContact) score += 10;
  // Education section
  const hasEducation = lines.some((l) => /education/i.test(l) || l.toLowerCase().includes("education"));
  if (hasEducation) score += 10;
  // Experience section
  const hasExperience = lines.some((l) => /experience|employment/i.test(l) || l.toLowerCase().includes("experience"));
  if (hasExperience) score += 10;
  // Skills section
  const hasSkills = lines.some((l) => /skills|technologies/i.test(l) || l.toLowerCase().includes("skills"));
  if (hasSkills) score += 10;
  // Project section
  const hasProjects = lines.some((l) => /project|portfolio/i.test(l) || l.toLowerCase().includes("project"));
  if (hasProjects) score += 10;
  // Formatting: reasonable length
  const hasContent = rawText.length > 100;
  if (hasContent) score += 5;
  // Grammar/readability: complete sentences
  const sentenceCount = (rawText.match(/[.!?]+/g) || []).length;
  if (sentenceCount >= 3) score += 5;
  return Math.min(100, Math.max(0, score));
}

function computeJobCoverageScore(rawText: string, profile: ProfileData): number {
  // Score based on how well the resume covers typical job requirements,
  // grounded in actual profile data (never invented).
  let score = 50;
  if (!rawText) return 50;
  const lower = rawText.toLowerCase();
  // Technical skills
  const technicalSkills = ["python", "javascript", "typescript", "java", "c++", "c#", "go", "rust", "sql", "mysql", "postgresql", "mongodb", "angular", "react", "vue", "node", "express", "django", "flask", "fastapi", "spring", "c#", ".net", "dotnet", "php", "ruby", "rust", "go", "scala", "kotlin"];
  for (const skill of technicalSkills) {
    if (lower.includes(skill)) score += 3;
  }
  // Profile-backed skills
  if (profile?.skills?.length) {
    const profileSkillNames = profile.skills.map((s) => (s.name || "").toLowerCase());
    for (const skill of technicalSkills) {
      if (profileSkillNames.some((pn: string) => pn.includes(skill))) score += 2;
    }
  }
  // Experience-related terms
  const experienceTerms = ["experience", "work", "employment", "history", "career"];
  for (const term of experienceTerms) {
    if (lower.includes(term)) score += 1;
  }
  // Education-related terms
  const educationTerms = ["education", "degree", "university", "college", "graduate", "bs", "ba", "ms", "ma"];
  for (const term of educationTerms) {
    if (lower.includes(term)) score += 1;
  }
  // Projects
  if (lower.includes("project") || lower.includes("portfolio")) score += 3;
  return Math.min(100, Math.max(0, score));
}

function computeEvidenceBackedAlignment(rawText: string, profile: ProfileData): number {
  // Score based on overlap between resume and verified profile,
  // grounded in actual profile data (never invented).
  let score = 50;
  if (!rawText) return 50;
  if (!profile) return 50;
  const lower = rawText.toLowerCase();
  // Profile personal info
  if (profile.personal?.full_name) score += 3;
  if (profile.personal?.email) score += 3;
  if (profile.personal?.phone) score += 2;
  if (profile.personal?.linkedin_url) score += 2;
  // Education
  if (profile.education?.length) score += 5;
  // Experiences
  if (profile.experiences?.length) score += 5;
  // Skills
  if (profile.skills?.length) score += 5;
  // Projects
  if (profile.projects?.length) score += 3;
  // Match some common skill names against profile
  const profileSkillNames = new Set(profile.skills?.map((s) => (s.name || "").toLowerCase()) || []);
  const skillKeywords = ["python", "javascript", "typescript", "java", "c++", "c#", "go", "rust", "sql", "aws", "docker", "kubernetes", "react", "angular", "vue", "node", "express", "django", "flask", "fastapi", "spring", "c#", ".net", "php", "ruby"];
  for (const kw of skillKeywords) {
    if (profileSkillNames.has(kw)) {
      // Check if keyword appears in resume
      if (lower.includes(kw)) score += 1;
    }
  }
  return Math.min(100, Math.max(0, score));
}

function extractMissingKeywords(rawText: string, profile: ProfileData): string[] {
  const missing: string[] = [];
  const lower = rawText.toLowerCase();
  if (!lower.includes("python") && profile?.skills?.some((s) => s?.name?.includes("python"))) {
    missing.push("Python");
  }
  if (!lower.includes("sql") && profile?.skills?.some((s) => s?.name?.includes("sql"))) {
    missing.push("SQL");
  }
  return missing;
}

function extractWeakBullets(rawText: string): string[] {
  const weak: string[] = [];
  const lines = rawText.split("\n");
  for (const line of lines) {
    // Simple heuristic: bullets without strong verbs or metrics
    if (line.match(/^\s*[-*]\s+\w+/) && !line.match(/[0-9]/)) {
      weak.push(line.trim());
    }
  }
  return weak;
}

function extractFormattingIssues(rawText: string): string[] {
  const issues: string[] = [];
  const lines = rawText.split("\n");
  if (lines.length < 3) issues.push("Resume appears very short — add more sections");
  if (!rawText.toLowerCase().includes("email")) issues.push("No contact email detected");
  if (!rawText.toLowerCase().includes("education")) issues.push("No education section detected");
  return issues;
}

function generateSuggestions(
  documentQualityScore: number,
  jobCoverageScore: number,
  alignmentScore: number,
  missingKeywords: string[],
  weakBullets: string[],
  formattingIssues: string[],
): string[] {
  const suggestions: string[] = [];
  if (documentQualityScore < 70) {
    suggestions.push("Add missing sections: contact info, education, experience, skills");
  }
  if (jobCoverageScore < 70) {
    suggestions.push("Include more relevant skills and projects for target roles");
  }
  if (alignmentScore < 70) {
    suggestions.push("Align your experience more closely with job requirements");
  }
  if (missingKeywords.length > 0) {
    suggestions.push(`Consider adding: ${missingKeywords.slice(0, 3).join(", ")}`);
  }
  if (weakBullets.length > 0) {
    suggestions.push("Rewrite bullet points with stronger verbs and quantified metrics");
  }
  if (formattingIssues.length > 0) {
    suggestions.push(...formattingIssues);
  }
  return suggestions;
}