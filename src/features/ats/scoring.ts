/**
 * Deterministic ATS scoring for the analyze route.
 *
 * Three independent, explainable scores grounded in the uploaded resume text
 * and the supplied job description:
 * 1. Document Quality — structure, readability, extraction, contact, formatting
 * 2. Job Coverage — weighted coverage of actual JD requirements
 * 3. Evidence Alignment — evidence quality for matched requirements
 *
 * This module intentionally does not use the master profile: all evidence
 * comes from the extracted resume text.
 */
import type { Requirement } from "@/features/ats/analysis";

export interface RequirementEvidence {
  requirement: string;
  classification: "required" | "preferred" | "neutral";
  matched: boolean;
  evidenceLevel: "none" | "skill_mention" | "project_experience" | "measurable_outcome";
  excerpt?: string;
  coverageContribution: number;
  alignmentContribution: number;
}

export interface AtsExplanation {
  documentQuality: {
    checks: Array<{ name: string; passed: boolean; detail: string }>;
    score: number;
  };
  jobCoverage: {
    totalRequirements: number;
    matchedRequirements: number;
    totalWeight: number;
    matchedWeight: number;
    score: number;
  };
  evidenceAlignment: {
    evaluatedRequirements: number;
    scoredRequirements: number;
    totalWeight: number;
    alignmentWeight: number;
    score: number;
  };
  requirements: RequirementEvidence[];
}

export interface DocumentQualityResult {
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  formattingIssues: string[];
}

export interface CoverageResult {
  score: number;
  totalWeight: number;
  matchedWeight: number;
  matchedCount: number;
  missing: string[];
  evidence: Map<string, { matched: boolean; contribution: number }>;
}

export interface AlignmentEvidence {
  level: "none" | "skill_mention" | "project_experience" | "measurable_outcome";
  excerpt?: string;
  contribution: number;
}

export interface AlignmentResult {
  score: number;
  totalWeight: number;
  alignmentWeight: number;
  scoredCount: number;
  evidence: Map<string, AlignmentEvidence>;
}

export interface AtsScoringResult {
  documentQuality: DocumentQualityResult;
  coverage: CoverageResult;
  alignment: AlignmentResult;
  missingKeywords: string[];
  weakBullets: string[];
  suggestions: string[];
  explanation: AtsExplanation;
}

/* ------------------------------------------------------------------ */
/* Document Quality — structure, readability, extraction, contact, formatting */
/* ------------------------------------------------------------------ */

export function computeDocumentQuality(rawText: string): DocumentQualityResult {
  const text = rawText.trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
  const issues: string[] = [];
  let score = 0;

  // 1. Extraction success — text exists and is non-trivial
  const extractionOk = text.length > 0;
  checks.push({ name: "extraction", passed: extractionOk, detail: extractionOk ? "Text extracted successfully" : "No text extracted" });
  if (extractionOk) score += 15;
  else issues.push("No text could be extracted from the resume.");

  // 2. Contact email present
  const hasEmail = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text);
  checks.push({ name: "contact_email", passed: hasEmail, detail: hasEmail ? "Email detected" : "No email found" });
  if (hasEmail) score += 10;
  else issues.push("No contact email detected.");

  // 3. Contact phone present
  const hasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(text);
  checks.push({ name: "contact_phone", passed: hasPhone, detail: hasPhone ? "Phone detected" : "No phone found" });
  if (hasPhone) score += 5;

  // 4-7. Section presence
  for (const [name, pattern, points] of [
    ["education", /\beducation\b/i, 10],
    ["experience", /\b(experience|employment|work history)\b/i, 10],
    ["skills", /\b(skills?|technologies|tools?)\b/i, 10],
    ["projects", /\b(projects?|portfolio)\b/i, 5],
  ] as const) {
    const present = pattern.test(text);
    checks.push({ name, passed: present, detail: present ? `${name} section found` : `No ${name} section` });
    if (present) score += points;
    else issues.push(`No ${name} section detected.`);
  }

  // 8. Content length (readability)
  const sufficientLength = text.length >= 500;
  checks.push({ name: "content_length", passed: sufficientLength, detail: sufficientLength ? "Adequate length" : "Resume text is short" });
  if (sufficientLength) score += 10;
  else issues.push("Resume text is short; extracted content may be incomplete.");

  // 9. Line count (structure)
  const sufficientLines = lines.length >= 8;
  checks.push({ name: "line_count", passed: sufficientLines, detail: sufficientLines ? "Good structure" : "Very few lines" });
  if (sufficientLines) score += 10;
  else issues.push("Resume structure has very few readable lines.");

  // 10. Bullet formatting (scanability)
  const hasBullets = lines.some((l) => /^[-*•–—]\s+/.test(l));
  checks.push({ name: "bullets", passed: hasBullets, detail: hasBullets ? "Bullets detected" : "No bullets" });
  if (hasBullets) score += 10;
  else issues.push("No bullet formatting was detected; scanability may be limited.");

  // 11. No extremely long lines (readability)
  const noLongLines = !lines.some((l) => l.length > 220);
  checks.push({ name: "readable_lines", passed: noLongLines, detail: noLongLines ? "Lines are readable" : "Some lines are very long" });
  if (noLongLines) score += 5;
  else issues.push("Very long extracted lines may reduce readability.");

  return { score: Math.min(100, Math.max(0, score)), checks, formattingIssues: issues };
}

/* ------------------------------------------------------------------ */
/* Job Coverage — weighted coverage of actual JD requirements */
/* ------------------------------------------------------------------ */

export function hasTermInResume(rawText: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#.])`, "i").test(rawText);
}

export function computeJobCoverage(rawText: string, requirements: Requirement[]): CoverageResult {
  if (requirements.length === 0) {
    return { score: 0, totalWeight: 0, matchedWeight: 0, matchedCount: 0, missing: [], evidence: new Map() };
  }

  const evidence = new Map<string, { matched: boolean; contribution: number }>();
  let totalWeight = 0;
  let matchedWeight = 0;
  let matchedCount = 0;
  const missing: string[] = [];

  for (const req of requirements) {
    totalWeight += req.weight;
    const matched = hasTermInResume(rawText, req.key);
    evidence.set(req.key, { matched, contribution: matched ? req.weight : 0 });
    if (matched) {
      matchedWeight += req.weight;
      matchedCount++;
    } else {
      missing.push(req.label);
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  return { score, totalWeight, matchedWeight, matchedCount, missing, evidence };
}

/* ------------------------------------------------------------------ */
/* Evidence Alignment — evidence quality for matched requirements */
/* ------------------------------------------------------------------ */

export function evaluateEvidence(
  rawText: string,
  lines: string[],
  term: string,
): { level: AlignmentEvidence["level"]; excerpt?: string } {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const termRe = new RegExp(`(^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#.])`, "i");

  // Check if term appears anywhere
  if (!termRe.test(rawText)) {
    return { level: "none" };
  }

  // Section headers that indicate demonstrated use vs. a plain skills list.
  const demonstratedHeader = /^(projects?|portfolio|experience|employment|work\s+history|activities)\b/i;
  const plainHeader = /^(education|technical\s+skills|skills|summary|languages|certifications?)\b/i;
  // Action verbs on the matching line itself indicate usage, wherever it sits.
  const usageVerb = /\b(built|developed|created|implemented|engineered|designed|optimized|modelled|modeled|translated|authored|cleaned|applied|architected|structured|integrated|directed|drove|led|managed|owned|supported|organized|analyzed|analysed|automated|configured|deployed|tested)\b/i;
  // A genuine measurable outcome shares the line with the term: percentages,
  // currency, grouped thousands (e.g. "3,900") or 3+ digit counts. Dates,
  // GPAs and repo handles (e.g. "yush08") are not outcomes.
  const metric = /\d+(?:\.\d+)?\s*%|\$\s*[\d,]+|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/;

  // Walk the document once to know which section each line belongs to.
  const sectionOf: string[] = [];
  let section = "other";
  for (const line of lines) {
    if (demonstratedHeader.test(line)) section = "demonstrated";
    else if (plainHeader.test(line)) section = "other";
    sectionOf.push(section);
  }

  const matchingIdx: number[] = [];
  lines.forEach((line, idx) => {
    if (termRe.test(line)) matchingIdx.push(idx);
  });
  if (matchingIdx.length === 0) return { level: "none" };

  const excerpt = lines[matchingIdx[0]]?.trim();
  const demonstrated = matchingIdx.some(
    (idx) => sectionOf[idx] === "demonstrated" || usageVerb.test(lines[idx]),
  );
  const measurable = matchingIdx.some((idx) => metric.test(lines[idx]));

  if (measurable) return { level: "measurable_outcome", excerpt };
  if (demonstrated) return { level: "project_experience", excerpt };
  return { level: "skill_mention", excerpt };
}

export function computeEvidenceAlignment(rawText: string, requirements: Requirement[]): AlignmentResult {
  if (requirements.length === 0) {
    return { score: 0, totalWeight: 0, alignmentWeight: 0, scoredCount: 0, evidence: new Map() };
  }

  const lines = rawText.split(/\r?\n/);
  const evidence = new Map<string, AlignmentEvidence>();
  let totalWeight = 0;
  let alignmentWeight = 0;
  let scoredCount = 0;

  for (const req of requirements) {
    totalWeight += req.weight;

    // Determine evidence level
    const { level, excerpt } = evaluateEvidence(rawText, lines, req.key);

    // Three distinct tiers — a bare mention never counts as demonstrated use:
    //   none               → 0 × weight
    //   skill_mention      → 0.5 × weight
    //   project_experience → 0.75 × weight
    //   measurable_outcome → 1 × weight
    const tierFactor =
      level === "measurable_outcome" ? 1 :
      level === "project_experience" ? 0.75 :
      level === "skill_mention" ? 0.5 : 0;
    const contribution = req.weight * tierFactor;

    evidence.set(req.key, { level, excerpt, contribution });

    if (level !== "none") {
      alignmentWeight += contribution;
      scoredCount++;
    }
  }

  const score = totalWeight > 0 ? Math.round((alignmentWeight / totalWeight) * 100) : 0;
  return { score, totalWeight, alignmentWeight, scoredCount, evidence };
}

export function classifyRequirement(req: Requirement): "required" | "preferred" | "neutral" {
  if (req.weight >= 3) return "required";
  if (req.weight <= 1) return "preferred";
  return "neutral";
}

/* ------------------------------------------------------------------ */
/* Weak bullets and suggestions */
/* ------------------------------------------------------------------ */

export function extractWeakBullets(rawText: string): string[] {
  return rawText.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
    /^[-*•]\s+/.test(line) && !/\d|%|\$/.test(line) && !/\b(built|created|delivered|improved|reduced|increased|led|designed|implemented|developed|analyzed)\b/i.test(line),
  );
}

export function generateSuggestions(
  documentQualityScore: number,
  jobCoverageScore: number,
  alignmentScore: number,
  missingKeywords: string[],
  weakBullets: string[],
  formattingIssues: string[],
): string[] {
  const suggestions: string[] = [];
  if (documentQualityScore < 70) {
    suggestions.push("Improve resume structure: add missing sections (contact, education, experience, skills).");
  }
  if (jobCoverageScore < 70) {
    suggestions.push("Add more relevant skills and experiences matching the job requirements.");
  }
  if (alignmentScore < 70) {
    suggestions.push("Strengthen evidence: add project or work examples demonstrating required skills.");
  }
  if (missingKeywords.length > 0) {
    suggestions.push(`Missing requirements: ${missingKeywords.slice(0, 5).join(", ")}${missingKeywords.length > 5 ? "…" : ""}`);
  }
  if (weakBullets.length > 0) {
    suggestions.push("Rewrite weak bullet points with stronger verbs and quantified outcomes.");
  }
  if (formattingIssues.length > 0) {
    suggestions.push(...formattingIssues);
  }
  return suggestions;
}

/* ------------------------------------------------------------------ */
/* Full scoring pipeline */
/* ------------------------------------------------------------------ */

export function scoreResumeAgainstJob(
  rawText: string,
  requirements: Requirement[],
): AtsScoringResult {
  const documentQuality = computeDocumentQuality(rawText);
  const coverage = computeJobCoverage(rawText, requirements);
  const alignment = computeEvidenceAlignment(rawText, requirements);
  const missingKeywords = coverage.missing;
  const weakBullets = extractWeakBullets(rawText);

  const requirementEvidence: RequirementEvidence[] = requirements.map((req) => {
    const cov = coverage.evidence.get(req.key);
    const align = alignment.evidence.get(req.key);
    return {
      requirement: req.label,
      classification: classifyRequirement(req),
      matched: cov?.matched ?? false,
      evidenceLevel: align?.level ?? "none",
      excerpt: align?.excerpt,
      coverageContribution: cov?.contribution ?? 0,
      alignmentContribution: align?.contribution ?? 0,
    };
  });

  const explanation: AtsExplanation = {
    documentQuality: {
      checks: documentQuality.checks,
      score: documentQuality.score,
    },
    jobCoverage: {
      totalRequirements: requirements.length,
      matchedRequirements: coverage.matchedCount,
      totalWeight: coverage.totalWeight,
      matchedWeight: coverage.matchedWeight,
      score: coverage.score,
    },
    evidenceAlignment: {
      evaluatedRequirements: requirements.length,
      scoredRequirements: alignment.scoredCount,
      totalWeight: alignment.totalWeight,
      alignmentWeight: alignment.alignmentWeight,
      score: alignment.score,
    },
    requirements: requirementEvidence,
  };

  const suggestions = generateSuggestions(
    documentQuality.score,
    coverage.score,
    alignment.score,
    missingKeywords,
    weakBullets,
    documentQuality.formattingIssues,
  );

  return { documentQuality, coverage, alignment, missingKeywords, weakBullets, suggestions, explanation };
}