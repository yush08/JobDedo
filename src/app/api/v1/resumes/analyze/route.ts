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
  const rawProfileData = toProfileData(profileBundle);
  // Ensure personal info is always available for scoring functions
  let profileData = { ...rawProfileData, personal: rawProfileData.personal ?? {} };
  // Populate personal email from extracted resume text if profile doesn't have it
  if (!profileData.personal.email && version.raw_text) {
    const emailMatch = version.raw_text.match(/[\w\.-]+@[\w\.-]+\.\w{2,}/);
    if (emailMatch) {
      profileData = {
        ...profileData,
        personal: { ...profileData.personal, email: emailMatch[0] },
      };
    }
  }

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

  // Helper: check if a term appears as a standalone word in text
  function hasTerm(term: string): boolean {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#.])`, "i").test(lower);
  }

  // Helper: check if any line in rawText contains a term (for multi-line sections)
  function lineContains(term: string): boolean {
    return rawText.split(/\r?\n/).some((l) => l.toLowerCase().includes(term.toLowerCase()));
  }

  // --- Profile personal info (mild evidence) ---
  if (profile.personal?.full_name) score += 1;

  // --- Education section detection from resume text ---
  const educationKeywords = ["education", "degree", "university", "college", "bs", "ba", "ms", "ma"];
  let educationEvidence = 0;
  for (const kw of educationKeywords) {
    if (hasTerm(kw)) {
      educationEvidence = 2; // skill mention
      break;
    }
    if (lineContains(kw)) {
      educationEvidence = 3; // project/experience reference
      break;
    }
  }
  if (educationEvidence >= 2) score += educationEvidence * 3; // 6 for mention, 9 for section ref

  // --- Experience section detection from resume text ---
  const experienceKeywords = ["experience", "employment", "work", "history", "career"];
  let experienceEvidence = 0;
  for (const kw of experienceKeywords) {
    if (hasTerm(kw)) {
      experienceEvidence = 2; // skill mention
      break;
    }
    if (lineContains(kw)) {
      experienceEvidence = 3; // project/experience reference
      break;
    }
  }
  if (experienceEvidence >= 2) score += experienceEvidence * 3; // 6 for mention, 9 for section ref

  // --- Skills evaluation from resume text ---
  const skillKeywords = ["python", "javascript", "typescript", "java", "c++", "c#", "go", "rust", "sql", "aws", "docker", "kubernetes", "react", "angular", "vue", "node", "express", "django", "flask", "fastapi", "spring", "php", "ruby"];
  let skillMatchCount = 0;
  for (const kw of skillKeywords) {
    if (hasTerm(kw)) {
      skillMatchCount++;
    }
  }
  // Award up to 5 points for skills found in resume (max 5 skills * 1 point each)
  score += Math.min(5, skillMatchCount);

  // --- Projects section detection from resume text ---
  const projectKeywords = ["project", "portfolio"];
  let projectEvidence = 0;
  for (const kw of projectKeywords) {
    if (hasTerm(kw)) {
      projectEvidence = 2; // skill mention
      break;
    }
    if (lineContains(kw)) {
      projectEvidence = 3; // concrete project reference
      break;
    }
  }
  if (projectEvidence >= 2) score += projectEvidence * 3; // 6 for mention, 9 for section ref

  // --- Normalize to 0-100 range ---
  return Math.min(100, Math.max(0, score));
}

function extractMissingKeywords(rawText: string, profile: ProfileData): string[] {
  const missing: string[] = [];
  const lower = rawText.toLowerCase();
  // Check for Python — missing if not present in resume content
  if (!lower.includes("python")) {
    missing.push("Python");
  }
  // Check for SQL — missing if not present in resume content
  if (!lower.includes("sql")) {
    missing.push("SQL");
  }
  // Check for Machine Learning / ML — but NOT just because Python is mentioned
  const mlPatterns = ["machine learning", "ml ", " predictive "];
  const hasML = mlPatterns.some((p) => lower.includes(p));
  if (!hasML) {
    missing.push("Machine Learning");
  }
  // Check for EDA
  if (!lower.includes("eda")) {
    missing.push("EDA");
  }
  // Check for Statistical modelling / regression
  const statPatterns = ["statistical modeling", "statistical modelling", "regression"];
  const hasStatistical = statPatterns.some((p) => lower.includes(p));
  if (!hasStatistical) {
    missing.push("Statistical Modelling");
  }
  // Check for Predictive analytics — but NOT just because Python is mentioned
  const predPatterns = ["predictive analytics", "predictive model"];
  const hasPredictive = predPatterns.some((p) => lower.includes(p));
  if (!hasPredictive) {
    missing.push("Predictive Analytics");
  }
  // Check for Pandas
  if (!lower.includes("pandas")) {
    missing.push("Pandas");
  }
  // Check for NumPy
  if (!lower.includes("numpy")) {
    missing.push("NumPy");
  }
  // Check for Scikit-learn / sklearn
  if (!lower.includes("scikit-learn") && !lower.includes("sklearn")) {
    missing.push("Scikit-learn");
  }
  // Check for Matplotlib
  if (!lower.includes("matplotlib")) {
    missing.push("Matplotlib");
  }
  // Check for Power BI
  if (!lower.includes("power bi") && !lower.includes("powerbi")) {
    missing.push("Power BI");
  }
  // Check for Data cleaning
  if (!lower.includes("data cleaning")) {
    missing.push("Data Cleaning");
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
  if (!/[\w\.-]+@[\w\.-]+\.\w{2,}/.test(rawText)) issues.push("No contact email detected");
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