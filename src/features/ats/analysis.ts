/**
 * Deterministic, evidence-only resume analysis. This intentionally does not
 * use the master profile: ATS coverage must describe the selected document.
 */
export interface Requirement {
  key: string;
  label: string;
  weight: number;
  kind: "skill" | "qualification" | "responsibility";
}

export interface AtsAnalysisResult {
  documentQualityScore: number;
  jobCoverageScore: number;
  alignmentScore: number;
  missingKeywords: string[];
  formattingIssues: string[];
  suggestions: string[];
  weakBullets: string[];
  matchedRequirements: string[];
  insufficientEvidence: string[];
  requirements: Requirement[];
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with",
  "ability", "applicant", "candidate", "candidates", "degree", "experience", "familiarity", "knowledge", "must", "needed", "plus",
  "required", "requirements", "responsibilities", "responsibility", "role", "skills", "strong", "team", "using", "work", "working", "years",
]);

const SECTION_PATTERN = /\b(skills?|technologies|tools?|education|qualifications?|experience|employment|work history|projects?|portfolio)\b/i;
const REQUIREMENT_PATTERN = /\b(required|requirement|must have|must possess|preferred|nice to have|qualification|skill|technology|tool|experience|responsibilit|you will|what you.?ll do|duties)\b/i;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#.])`, "i").test(text);
}

function requirementKind(line: string): Requirement["kind"] {
  if (/responsibilit|you will|what you.?ll do|duties/i.test(line)) return "responsibility";
  if (/qualification|degree|certification|years? of/i.test(line)) return "qualification";
  return "skill";
}

function requirementWeight(line: string): number {
  if (/must have|required|must possess/i.test(line)) return 3;
  if (/preferred|nice to have|bonus/i.test(line)) return 1;
  return 2;
}

function cleanRequirementPart(part: string): string[] {
  const stripped = part
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/\b(required|preferred|desired|nice to have|must have|must possess|qualifications?|skills?|technologies|tools?|responsibilities|you will|what you.?ll do|duties|experience with|proficiency in|knowledge of)\b\s*:?/gi, " ")
    .replace(/\b(?:and|or)\b/gi, ",")
    .trim();

  return stripped.split(/[,;/|]/).map((item) => item.trim()).flatMap((item) => {
    const words = item.match(/[a-zA-Z][a-zA-Z0-9+#.-]*/g) ?? [];
    // A short named term (e.g. "Python", "CI/CD") is a direct requirement.
    if (words.length <= 4 && words.some((word) => !STOP_WORDS.has(normalise(word)))) return [item];
    // Retain longer responsibility/qualification phrases as a meaningful unit.
    return item.length >= 8 ? [item] : [];
  });
}

/** Extracts named and phrase requirements from the supplied description only. */
export function extractJobRequirements(jobDescription: string): Requirement[] {
  const lines = jobDescription.split(/\r?\n|(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
  const sourceLines = lines.filter((line) => REQUIREMENT_PATTERN.test(line));
  const candidates = sourceLines.length > 0 ? sourceLines : lines;
  const requirements = new Map<string, Requirement>();

  for (const line of candidates) {
    const kind = requirementKind(line);
    const weight = requirementWeight(line);
    for (const part of cleanRequirementPart(line)) {
      const key = normalise(part).replace(/^(?:a|an|the)\s+/, "");
      if (key.length < 2 || STOP_WORDS.has(key) || /^[0-9]+$/.test(key)) continue;
      const existing = requirements.get(key);
      requirements.set(key, existing ? { ...existing, weight: Math.max(existing.weight, weight) } : {
        key,
        label: part.trim(),
        weight,
        kind,
      });
    }
  }
  return [...requirements.values()].slice(0, 30);
}

function sectionText(rawText: string, headings: RegExp): string {
  const lines = rawText.split(/\r?\n/);
  const selected: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (SECTION_PATTERN.test(line)) {
      inSection = headings.test(line);
      continue;
    }
    if (inSection) selected.push(line);
  }
  return selected.join("\n");
}

function evidenceFor(rawText: string, requirement: Requirement): "none" | "keyword" | "demonstrated" {
  if (!hasTerm(rawText, requirement.key)) return "none";
  const skills = sectionText(rawText, /skill|technolog|tool/i);
  const demonstrated = sectionText(rawText, /experience|employment|work history|project|portfolio/i);
  if (hasTerm(demonstrated, requirement.key)) return "demonstrated";
  if (hasTerm(skills, requirement.key)) return "keyword";
  return "keyword";
}

function computeDocumentQuality(rawText: string): { score: number; formattingIssues: string[] } {
  const text = rawText.trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const issues: string[] = [];
  let score = 20;
  const hasEmail = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text);
  const hasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(text);
  if (hasEmail) score += 10; else issues.push("No contact email detected in the extracted resume text.");
  if (hasPhone) score += 5;
  for (const [label, expression] of [
    ["education", /\beducation\b/i],
    ["experience", /\b(experience|employment|work history)\b/i],
    ["skills", /\b(skills?|technologies|tools?)\b/i],
    ["projects", /\b(projects?|portfolio)\b/i],
  ] as const) {
    if (expression.test(text)) score += 10;
    else issues.push(`No ${label} section detected in the extracted resume text.`);
  }
  if (text.length >= 500) score += 10;
  else issues.push("Resume text is short; extracted content may be incomplete.");
  if (lines.length >= 8) score += 5;
  else issues.push("Resume structure has very few readable lines.");
  if (lines.some((line) => /^[-*•]\s+/.test(line))) score += 5;
  else issues.push("No bullet formatting was detected; scanability may be limited.");
  if (lines.some((line) => line.length > 220)) issues.push("Very long extracted lines may reduce readability.");
  return { score: clamp(score), formattingIssues: issues };
}

function extractWeakBullets(rawText: string): string[] {
  return rawText.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
    /^[-*•]\s+/.test(line) && !/\d|%|\$/.test(line) && !/\b(built|created|delivered|improved|reduced|increased|led|designed|implemented|developed|analyzed)\b/i.test(line),
  );
}

export function analyzeResumeForJob(rawText: string, jobDescription: string): AtsAnalysisResult {
  const { score: documentQualityScore, formattingIssues } = computeDocumentQuality(rawText);
  const requirements = extractJobRequirements(jobDescription);
  const evidence = requirements.map((requirement) => ({ requirement, level: evidenceFor(rawText, requirement) }));
  const totalWeight = evidence.reduce((sum, item) => sum + item.requirement.weight, 0);
  const coverageWeight = evidence.reduce((sum, item) => sum + (item.level === "none" ? 0 : item.requirement.weight), 0);
  const alignmentWeight = evidence.reduce((sum, item) => sum + item.requirement.weight * (item.level === "demonstrated" ? 1 : item.level === "keyword" ? 0.45 : 0), 0);
  const jobCoverageScore = totalWeight ? clamp((coverageWeight / totalWeight) * 100) : 0;
  const alignmentScore = totalWeight ? clamp((alignmentWeight / totalWeight) * 100) : 0;
  const missingKeywords = evidence.filter((item) => item.level === "none").map((item) => item.requirement.label);
  const matchedRequirements = evidence.filter((item) => item.level !== "none").map((item) => item.requirement.label);
  const insufficientEvidence = evidence.filter((item) => item.level === "keyword").map((item) => item.requirement.label);
  const weakBullets = extractWeakBullets(rawText);
  const suggestions: string[] = [];
  if (missingKeywords.length) suggestions.push(`For missing requirements (${missingKeywords.slice(0, 3).join(", ")}), acquire the skill or only add it when you can support it truthfully.`);
  if (insufficientEvidence.length) suggestions.push(`Where accurate, add a project or work example that demonstrates: ${insufficientEvidence.slice(0, 3).join(", ")}.`);
  if (weakBullets.length) suggestions.push("Strengthen the identified bullet points with the action, scope, and a truthful outcome or metric.");
  if (formattingIssues.length) suggestions.push(...formattingIssues);
  return { documentQualityScore, jobCoverageScore, alignmentScore, missingKeywords, formattingIssues, suggestions, weakBullets, matchedRequirements, insufficientEvidence, requirements };
}
