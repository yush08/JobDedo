/**
 * Resume-grounded cold-email draft generation (pure, no I/O, no AI).
 *
 * Design rules enforced here:
 * - Uses only: the selected resume version (parsed payload + raw text),
 *   the supplied job description, the draft type, and recruiter/company
 *   information that was explicitly provided or reliably extracted from
 *   the job description. Nothing else is invented.
 * - Never fabricates achievements, metrics, dates, previous interactions,
 *   interview topics, or recruiter details.
 * - Never claims professional experience when the resume only shows
 *   academic/personal projects — framing falls back to studies/projects.
 * - The six draft types render structurally distinct subjects and bodies.
 * - Duplicate words introduced by template composition are collapsed and
 *   subjects stay role-specific (no generic "at your company" filler).
 *
 * This module is imported by both the API route and the client component,
 * so it must remain dependency-free (types only) and safe for the browser.
 */

import type { EmailDraft } from "@/types";

/* ------------------------------------------------------------------ */
/* Draft type vocabulary                                               */
/* ------------------------------------------------------------------ */

export type DraftType = EmailDraft["draft_type"];

/** All persisted draft types (matches the DB CHECK constraint). */
export const DRAFT_TYPES: readonly DraftType[] = [
  "hiring_manager_intro",
  "recruiter_intro",
  "follow_up",
  "referral_request",
  "thank_you",
  "internship_outreach",
];

export const DRAFT_TYPE_LABEL: Record<DraftType, string> = {
  hiring_manager_intro: "Hiring manager intro",
  recruiter_intro: "Recruiter intro",
  follow_up: "Follow-up",
  referral_request: "Referral request",
  thank_you: "Post-interview thank-you",
  internship_outreach: "Internship outreach",
};

export function isDraftType(value: string): value is DraftType {
  return (DRAFT_TYPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Raised when the selected resume version yields no usable content. */
export class MissingResumeContentError extends Error {
  constructor(
    message = "The selected resume version has no extractable content, so a grounded email cannot be generated. Upload a text-based resume (PDF or DOCX with selectable text) in Resume Studio, or select a different resume version that contains content.",
  ) {
    super(message);
    this.name = "MissingResumeContentError";
  }
}

/* ------------------------------------------------------------------ */
/* Evidence model                                                      */
/* ------------------------------------------------------------------ */

export interface ResumeEvidenceEducation {
  institution: string;
  degree: string | null;
}

export interface ResumeEvidenceExperience {
  organization: string;
  role: string | null;
}

export interface ResumeEvidenceProject {
  name: string;
  description: string | null;
}

export interface ResumeEvidence {
  name: string | null;
  summary: string | null;
  skills: string[];
  experience: ResumeEvidenceExperience[];
  education: ResumeEvidenceEducation[];
  projects: ResumeEvidenceProject[];
  achievements: string[];
}

/* ------------------------------------------------------------------ */
/* Small parsing helpers (unknown-safe, never `any`)                   */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stripBullet(line: string): string {
  return line.replace(/^[\s]*[-•*·▪◦]+\s*/, "").trim();
}

function splitList(text: string): string[] {
  return text
    .split(/[,;|\n•·]+/g)
    .map((item) => stripBullet(item))
    .filter((item) => item.length >= 2);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function joinLines(lines: string[]): string {
  return lines
    .map((line) => stripBullet(line))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Raw-text section parsing (fallback when `parsed` is empty)          */
/* ------------------------------------------------------------------ */

type RawSection =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "achievements";

/**
 * Header rules are fully anchored so ordinary content lines such as
 * "Experience with Python" are never mistaken for section headers.
 */
const HEADER_RULES: ReadonlyArray<readonly [RawSection, RegExp]> = [
  [
    "summary",
    /^(?:professional\s+)?(?:summary|objective|profile|about(?:\s+me)?|overview|career\s+summary)$/i,
  ],
  [
    "experience",
    /^(?:(?:work|professional|relevant|related)\s+)?(?:experience|employment(?:\s+history)?|work\s+history)$/i,
  ],
  ["education", /^(?:education|academic\s+(?:background|qualifications?)|qualifications)$/i],
  ["skills", /^(?:skills|technical\s+skills|technologies|competencies|core\s+skills)$/i],
  ["projects", /^(?:projects|personal\s+projects|key\s+projects|academic\s+projects)$/i],
  [
    "achievements",
    /^(?:achievements|awards|honou?rs|certifications|activities|extracurriculars?)$/i,
  ],
];

function normalizeRawText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\\section\*?\s*\{([^}]*)\}/g, "\n$1\n")
    .replace(/\\(?:textbf|emph|textit)\s*\{([^}]*)\}/g, "$1");
}

function classifyLine(line: string): { section: RawSection | null; rest: string } {
  if (line.length > 60) return { section: null, rest: line };
  const colonIdx = line.search(/[:：]/);
  const head = (colonIdx >= 0 ? line.slice(0, colonIdx) : line).trim();
  const rest = colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : "";
  if (!head || head.length > 40) return { section: null, rest: line };
  for (const [section, re] of HEADER_RULES) {
    if (re.test(head)) return { section, rest };
  }
  return { section: null, rest: line };
}

interface RawSections {
  sections: Record<RawSection, string[]>;
  headLines: string[];
}

function parseRawSections(raw: string): RawSections {
  const sections: Record<RawSection, string[]> = {
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: [],
    achievements: [],
  };
  const headLines: string[] = [];
  let current: RawSection | null = null;

  for (const rawLine of normalizeRawText(raw).split("\n")) {
    const line = stripBullet(rawLine);
    if (!line) continue;
    if (headLines.length < 3) headLines.push(line);

    const { section, rest } = classifyLine(line);
    if (section) {
      current = section;
      if (rest) sections[section].push(rest);
      continue;
    }
    if (current) sections[current].push(line);
  }
  return { sections, headLines };
}

const CONTACT_PREFIX = /^(?:phone|mobile|email|address|tel|contact|linkedin|github|http)/i;

function looksLikeName(line: string): boolean {
  if (!line || line.length > 60) return false;
  if (line.includes("@") || /https?:/i.test(line)) return false;
  if (/\d{3,}/.test(line)) return false;
  if (CONTACT_PREFIX.test(line)) return false;
  if (classifyLine(line).section) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  return /^[A-ZÀ-Þ]/.test(line);
}

/* ------------------------------------------------------------------ */
/* Parsed-payload extraction                                            */
/* ------------------------------------------------------------------ */

function extractSkills(value: unknown): string[] {
  const out: string[] = [];
  for (const entry of asList(value)) {
    if (typeof entry === "string") {
      out.push(...splitList(entry));
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const items = rec.items ?? rec.skills ?? rec.values ?? rec.name;
    if (typeof items === "string") out.push(...splitList(items));
    else if (Array.isArray(items)) {
      for (const item of items) {
        const text = asText(item);
        if (text) out.push(...splitList(text));
      }
    }
  }
  return dedupe(out).filter((item) => item.length >= 2);
}

function parseExperienceLine(line: string): ResumeEvidenceExperience | null {
  const text = stripBullet(line);
  if (!text) return null;
  const atIdx = text.search(/\s+(?:at|@)\s+/i);
  if (atIdx > 0) {
    const role = text.slice(0, atIdx).trim();
    const organization = text.slice(atIdx + 1).replace(/^(?:at|@)\s+/i, "").trim();
    if (organization) return { organization, role: role || null };
  }
  return { organization: text, role: null };
}

function extractExperience(value: unknown): ResumeEvidenceExperience[] {
  const out: ResumeEvidenceExperience[] = [];
  for (const entry of asList(value)) {
    if (typeof entry === "string") {
      const parsedLine = parseExperienceLine(entry);
      if (parsedLine) out.push(parsedLine);
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const organization = asText(rec.organization ?? rec.company ?? rec.org ?? rec.employer);
    const role = asText(rec.role ?? rec.title ?? rec.position) || null;
    if (organization || role) out.push({ organization, role });
  }
  return out;
}

const DEGREE_RE =
  /(?:bachelor|b\.?tech|b\.?e\.?|b\.?sc|b\.?com|b\.?a\.?|master|m\.?tech|m\.?e\.?|m\.?sc|m\.?ba|mba|ph\.?d|doctorate|associate|diploma|degree|class\s+(?:x|1[0-2]|12))/i;

function parseEducationLine(line: string): ResumeEvidenceEducation | null {
  const text = stripBullet(line);
  if (!text) return null;
  const atIdx = text.search(/\s+at\s+/i);
  if (atIdx > 0) {
    const degree = text.slice(0, atIdx).trim();
    const institution = text.slice(atIdx + 1).replace(/^at\s+/i, "").trim();
    if (institution) return { institution, degree: degree || null };
  }
  const commaIdx = text.indexOf(",");
  if (commaIdx > 0) {
    const first = text.slice(0, commaIdx).trim();
    const second = text.slice(commaIdx + 1).trim();
    if (first && second) {
      if (DEGREE_RE.test(first)) return { institution: second, degree: first };
      if (DEGREE_RE.test(second)) return { institution: first, degree: second };
    }
  }
  return { institution: text, degree: null };
}

function extractEducation(value: unknown): ResumeEvidenceEducation[] {
  const out: ResumeEvidenceEducation[] = [];
  for (const entry of asList(value)) {
    if (typeof entry === "string") {
      const parsedLine = parseEducationLine(entry);
      if (parsedLine) out.push(parsedLine);
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const institution = asText(rec.institution ?? rec.school ?? rec.college ?? rec.university);
    const degree =
      asText(rec.degree ?? rec.field ?? rec.field_of_study ?? rec.major ?? rec.qualification) ||
      null;
    if (institution || degree) out.push({ institution, degree });
  }
  return out;
}

function parseProjectLine(line: string): ResumeEvidenceProject | null {
  const text = stripBullet(line);
  if (!text) return null;
  const dashIdx = text.search(/\s+[—–-]\s+/);
  if (dashIdx > 0) {
    const name = text.slice(0, dashIdx).trim();
    const description = text.slice(dashIdx).replace(/^\s+[—–-]\s+/, "").trim();
    if (name) return { name, description: description || null };
  }
  return { name: text, description: null };
}

function extractProjects(value: unknown): ResumeEvidenceProject[] {
  const out: ResumeEvidenceProject[] = [];
  for (const entry of asList(value)) {
    if (typeof entry === "string") {
      const parsedLine = parseProjectLine(entry);
      if (parsedLine) out.push(parsedLine);
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const name = asText(rec.name ?? rec.title ?? rec.project);
    const description = asText(rec.description ?? rec.summary ?? rec.details) || null;
    if (name) out.push({ name, description });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Evidence extraction                                                  */
/* ------------------------------------------------------------------ */

/**
 * Merge the structured `parsed` payload with a raw-text section fallback so
 * generation always grounds in whatever the resume actually contains.
 */
export function extractResumeEvidence(version: {
  raw_text: string;
  parsed?: Record<string, unknown> | null;
}): ResumeEvidence {
  const parsed = asRecord(version.parsed ?? null);
  const personal = parsed ? asRecord(parsed.personalInfo) : null;

  let name = "";
  if (personal) name = asText(personal.full_name) || asText(personal.name);
  if (!name && parsed) name = asText(parsed.name);

  const summary = parsed ? asText(parsed.summary) : "";
  const skills = parsed ? extractSkills(parsed.skills) : [];
  const experience = parsed ? extractExperience(parsed.experience) : [];
  const education = parsed ? extractEducation(parsed.education) : [];
  const projects = parsed ? extractProjects(parsed.projects) : [];
  const achievements = parsed
    ? asList(parsed.achievements)
        .map((item) => asText(item))
        .filter(Boolean)
    : [];

  const raw = typeof version.raw_text === "string" ? version.raw_text : "";
  const base: ResumeEvidence = {
    name: name || null,
    summary: summary || null,
    skills,
    experience,
    education,
    projects,
    achievements,
  };
  if (!raw.trim()) return base;

  const { sections, headLines } = parseRawSections(raw);

  const mergedName =
    base.name ||
    headLines.map((line) => (looksLikeName(line) ? line : "")).find(Boolean) ||
    null;

  return {
    name: mergedName,
    summary: base.summary || (sections.summary.length ? joinLines(sections.summary) : null),
    skills: base.skills.length ? base.skills : extractSkills(sections.skills),
    experience: base.experience.length
      ? base.experience
      : sections.experience
          .map(parseExperienceLine)
          .filter((item): item is ResumeEvidenceExperience => item !== null),
    education: base.education.length
      ? base.education
      : sections.education
          .map(parseEducationLine)
          .filter((item): item is ResumeEvidenceEducation => item !== null),
    projects: base.projects.length
      ? base.projects
      : sections.projects
          .map(parseProjectLine)
          .filter((item): item is ResumeEvidenceProject => item !== null),
    achievements: base.achievements.length
      ? base.achievements
      : sections.achievements.map((line) => stripBullet(line)).filter(Boolean),
  };
}

/** True when the resume contains substantive, citable content. */
export function hasUsableResumeContent(evidence: ResumeEvidence): boolean {
  return Boolean(
    evidence.summary ||
      evidence.skills.length > 0 ||
      evidence.experience.length > 0 ||
      evidence.education.length > 0 ||
      evidence.projects.length > 0 ||
      evidence.achievements.length > 0,
  );
}

/* ------------------------------------------------------------------ */
/* Text hygiene                                                        */
/* ------------------------------------------------------------------ */

/**
 * Collapse runs of duplicated words ("the the position position" →
 * "the position"). Case-insensitive; only merges tokens separated purely by
 * whitespace so punctuation and paragraph structure are preserved.
 */
export function collapseDuplicateWords(text: string): string {
  if (!text) return text;
  const tokenRe = /[A-Za-z0-9']+/g;
  let out = "";
  let prevWord: string | null = null;
  let last = 0;
  let match = tokenRe.exec(text);
  while (match !== null) {
    const word = match[0];
    const sep = text.slice(last, match.index);
    const isDuplicate =
      prevWord !== null &&
      word.toLowerCase() === prevWord.toLowerCase() &&
      /^\s*$/.test(sep);
    if (isDuplicate) {
      last = match.index + word.length;
    } else {
      out += sep + word;
      prevWord = word;
      last = match.index + word.length;
    }
    match = tokenRe.exec(text);
  }
  out += text.slice(last);
  return out;
}

function tidyInline(text: string): string {
  return collapseDuplicateWords(text)
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function tidyBody(text: string): string {
  return collapseDuplicateWords(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\.\s+\./g, ".")
    .trim();
}

function ensureTerminalPeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?)"']$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = flat.match(/^(.{1,240}?[.!?])(?:\s|$)/);
  return (match ? match[1] : flat.slice(0, 240)).trim();
}

function listJoin(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Job-description extraction                                          */
/* ------------------------------------------------------------------ */

const ROLE_KEYWORDS = [
  "intern",
  "internship",
  "engineer",
  "developer",
  "programmer",
  "analyst",
  "scientist",
  "designer",
  "manager",
  "consultant",
  "associate",
  "specialist",
  "architect",
  "technician",
  "researcher",
  "assistant",
  "administrator",
  "accountant",
  "strategist",
  "coordinator",
  "recruiter",
  "devops",
  "sre",
];

function cleanRoleTitle(raw: string): string | null {
  let title = raw.trim();
  title = title.split(/\s+at\s+/i)[0];
  title = title.replace(/\s*\(\s*(?:remote|hybrid|on-?site)\s*\)/gi, "");
  title = title.replace(/[.,;:]+$/, "").trim();
  if (!title) return null;
  if (title.length > 80) {
    const cut = title.slice(0, 80);
    const spaceIdx = cut.lastIndexOf(" ");
    title = cut.slice(0, spaceIdx > 40 ? spaceIdx : 80).trim();
  }
  if (!title || /^(?:the|a|an|this|our)$/i.test(title)) return null;
  return tidyInline(title);
}

/** Reliably extract a role title from the job description, or null. */
export function extractRoleTitle(jobDescription: string): string | null {
  const jd = typeof jobDescription === "string" ? jobDescription : "";
  if (!jd.trim()) return null;

  const labeled = jd.match(/^\s*(?:job\s*title|role|position|title)\s*[:\-–—]\s*(.+)$/im);
  if (labeled) {
    const title = cleanRoleTitle(labeled[1]);
    if (title) return title;
  }

  const inSentence = jd.match(
    /\b(?:for|of)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9&+/. -]{2,60}?)\s+(?:position|role|internship|job)\b/i,
  );
  if (inSentence) {
    const title = cleanRoleTitle(inSentence[1]);
    if (title) return title;
  }

  for (const rawLine of jd.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.length > 80 || /[.,;!?]/.test(line)) continue;
    if (line.split(/\s+/).length > 8) continue;
    if (!ROLE_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(line))) continue;
    const title = cleanRoleTitle(line);
    if (title) return title;
  }
  return null;
}

const GENERIC_COMPANIES = new Set([
  "your company",
  "the company",
  "our company",
  "company",
  "this company",
  "the team",
  "your team",
  "our team",
  "the organization",
  "the employer",
  "a company",
  "some company",
  "the startup",
  "your startup",
  "the business",
  "hiring company",
]);

function cleanCompany(raw: string): string | null {
  let company = raw.trim();
  company = company.split(/\s+[—–]\s+/)[0];
  company = company.replace(/\s+(?:is\s+)?(?:hiring|looking\s+for|seeking)\b.*$/i, "");
  company = company.replace(/[.,;:]+$/, "").trim();
  if (!company || company.length > 60) return null;
  if (/[\n\r/\\]|https?:/i.test(company)) return null;
  if (GENERIC_COMPANIES.has(company.toLowerCase())) return null;
  if (company.split(/\s+/).length > 6) return null;
  // Also try to find a company + suffix pattern (Inc, Ltd, LLC, etc.) anywhere
  // in the text, e.g. "Join Northwind Ltd today" → "Northwind Ltd".
  const suffixPattern = /([A-Z][\w&.'-]+\s*(?:Inc\.?|Ltd\.?|LLC|GmbH|Corp\.?|Co\.?))/i;
  const suffixMatch = company.match(suffixPattern);
  if (suffixMatch) {
    return tidyInline(suffixMatch[1]);
  }
  return tidyInline(company);
}

/**
 * Extract the company only when explicitly provided (selected recruiter's
 * company) or reliably present in the job description (labelled field or a
 * proper-noun corporate suffix such as "Acme Inc").
 */
export function extractCompany(
  jobDescription: string,
  explicitCompany?: string | null,
): string | null {
  const candidates: string[] = [];
  if (explicitCompany) candidates.push(explicitCompany);

  const jd = typeof jobDescription === "string" ? jobDescription : "";
  const labeled = jd.match(/^\s*(?:company|employer|organization|org)\s*[:\-–—]\s*(.+)$/im);
  if (labeled) candidates.push(labeled[1]);

  const suffix = jd.match(
    /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)\s+(Inc\.?|Ltd\.?|LLC|GmbH|Corp\.?|Co\.?|Pvt\.?|Limited)\b/,
  );
  if (suffix) candidates.push(`${suffix[1]} ${suffix[2]}`);

  for (const candidate of candidates) {
    const cleaned = cleanCompany(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

const JD_STOPWORDS = new Set([
  "about","above","after","again","also","among","and","any","are","because","been","before",
  "being","between","both","but","can","could","each","for","from","further","had","has","have",
  "having","here","how","into","its","itself","more","most","must","not","now","other","our","out",
  "over","own","same","should","some","such","than","that","the","their","them","then","there",
  "these","they","this","those","through","under","until","very","was","were","what","when","where",
  "which","while","who","will","with","would","your","you","role","position","job","jobs","work",
  "works","team","teams","skills","skill","experience","years","year","strong","looking","candidate",
  "candidates","company","including","knowledge","understanding","using","required","requirements",
  "requirement","ability","able","plus","preferred","nice","bonus","etc","ideal","we","us","help",
  "ensure","build","building","across","good","well","least","using","least",
]);

function matchedSkills(evidence: ResumeEvidence, jobDescription: string): string[] {
  const jd = jobDescription.toLowerCase();
  return evidence.skills.filter((skill) => skill.length > 1 && jd.includes(skill.toLowerCase()));
}

/** Keywords used to connect resume evidence to the job description. */
function jdSignals(matched: string[], evidence: ResumeEvidence, jobDescription: string): string[] {
  if (matched.length > 0) return matched.slice(0, 3);

  const jd = jobDescription.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const evidenceWords = [...evidence.skills, ...evidence.projects.map((p) => p.name)]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/);
  for (const word of evidenceWords) {
    if (word.length >= 4 && !JD_STOPWORDS.has(word) && jd.includes(word) && !seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  }
  if (out.length > 0) return out.slice(0, 3);

  for (const word of jd.split(/[^a-z0-9+#.]+/)) {
    if (word.length >= 5 && !JD_STOPWORDS.has(word) && !seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  }
  return out.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Generation context                                                  */
/* ------------------------------------------------------------------ */

export interface GenerateDraftRecruiter {
  name: string;
  title?: string | null;
  company?: string | null;
}

export interface GenerateDraftInput {
  resumeVersion: { raw_text: string; parsed?: Record<string, unknown> | null };
  jobDescription: string;
  draftType: DraftType;
  recruiter?: GenerateDraftRecruiter | null;
  contextNote?: string | null;
}

export interface GeneratedDraftContent {
  subject: string;
  body: string;
  evidence: ResumeEvidence;
  roleTitle: string | null;
  company: string | null;
}

interface DraftContext {
  evidence: ResumeEvidence;
  name: string | null;
  roleTitle: string | null;
  company: string | null;
  recruiterFirst: string | null;
  contextNote: string | null;
  skills: string[];
  signals: string[];
  hasPro: boolean;
  rolePhrase: string;
  atCompany: string;
  groundingNoun: string;
}

function buildContext(input: GenerateDraftInput, evidence: ResumeEvidence): DraftContext {
  const jobDescription = typeof input.jobDescription === "string" ? input.jobDescription : "";
  const roleTitle = extractRoleTitle(jobDescription);
  const recruiter = input.recruiter ?? null;
  const company = extractCompany(jobDescription, recruiter?.company ?? null);

  const matched = matchedSkills(evidence, jobDescription);
  const skills = (matched.length > 0 ? matched : evidence.skills).slice(0, 4);
  const signals = jdSignals(matched, evidence, jobDescription).map(
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );

  const hasPro = evidence.experience.length > 0;
  const groundingNoun = hasPro
    ? "professional background"
    : evidence.projects.length > 0
      ? "project work"
      : evidence.education.length > 0
        ? "academic background"
        : "skill set";

  const rolePhrase = roleTitle
    ? /\b(?:intern|internship|position|role|job|fellowship|residency)\b/i.test(roleTitle)
      ? `the ${roleTitle}`
      : `the ${roleTitle} role`
    : "this role";

  const rawContext = typeof input.contextNote === "string" ? input.contextNote.trim() : "";
  const contextNote = rawContext ? ensureTerminalPeriod(rawContext.slice(0, 4000)) : null;

  return {
    evidence,
    name: evidence.name,
    roleTitle,
    company,
    recruiterFirst: recruiter?.name?.trim().split(/\s+/)[0] || null,
    contextNote,
    skills,
    signals,
    hasPro,
    rolePhrase,
    atCompany: company ? ` at ${company}` : "",
    groundingNoun,
  };
}

/* ------------------------------------------------------------------ */
/* Shared sentence builders (all evidence comes from the resume)       */
/* ------------------------------------------------------------------ */

function greeting(ctx: DraftContext, fallback: string): string {
  return ctx.recruiterFirst ? `Dear ${ctx.recruiterFirst},` : fallback;
}

function signOff(ctx: DraftContext): string {
  return ctx.name ? `Best regards,\n${ctx.name}` : "Best regards,";
}

function evidenceSentences(
  ctx: DraftContext,
  opts: {
    includeSkills?: boolean;
    includeProjects?: boolean;
    includeExperience?: boolean;
    includeEducation?: boolean;
    includeAchievements?: boolean;
    max?: number;
  } = {},
): string[] {
  const {
    includeSkills = true,
    includeProjects = true,
    includeExperience = true,
    includeEducation = false,
    includeAchievements = false,
    max = 3,
  } = opts;
  const { evidence } = ctx;
  const out: string[] = [];

  if (includeSkills && evidence.skills.length > 0) {
    out.push(`I have hands-on experience with ${listJoin(evidence.skills.slice(0, 5))}.`);
  }
  if (includeProjects && evidence.projects.length > 0) {
    const project = evidence.projects[0];
    out.push(
      project.description
        ? `I built ${project.name} — ${ensureTerminalPeriod(project.description)}`
        : `I worked on ${project.name}.`,
    );
  }
  if (includeExperience && ctx.hasPro) {
    const exp = evidence.experience[0];
    if (exp) {
      out.push(
        exp.role
          ? `I have experience as ${exp.role} at ${exp.organization}.`
          : `I have experience with ${exp.organization}.`,
      );
    }
  }
  if (includeEducation && evidence.education.length > 0) {
    const edu = evidence.education[0];
    out.push(
      edu.degree
        ? edu.institution
          ? `My academic background is in ${edu.degree} from ${edu.institution}.`
          : `My academic background is in ${edu.degree}.`
        : edu.institution
          ? `I studied at ${edu.institution}.`
          : "",
    );
  }
  if (includeAchievements && evidence.achievements.length > 0) {
    const items = evidence.achievements.slice(0, 2).map((a) => a.replace(/[.]+$/, ""));
    out.push(`A few highlights from my resume: ${listJoin(items)}.`);
  }
  return out.filter((sentence) => sentence.trim().length > 0).slice(0, max);
}

function jdLinkSentence(ctx: DraftContext): string {
  if (ctx.signals.length === 0) return "";
  const what = ctx.roleTitle ?? "role";
  return `The ${what}'s emphasis on ${listJoin(ctx.signals)} matches my ${ctx.groundingNoun}.`;
}

function identitySentences(ctx: DraftContext): string[] {
  const parts: string[] = [];
  const { evidence } = ctx;
  if (ctx.name) parts.push(`My name is ${ctx.name}.`);

  if (ctx.hasPro && evidence.experience.length > 0) {
    const exp = evidence.experience[0];
    parts.push(
      exp.role
        ? `I have professional experience as ${exp.role} at ${exp.organization}.`
        : `I have professional experience at ${exp.organization}.`,
    );
  } else if (evidence.education.length > 0) {
    const edu = evidence.education[0];
    parts.push(
      edu.degree
        ? edu.institution
          ? `My academic background is in ${edu.degree} from ${edu.institution}.`
          : `My academic background is in ${edu.degree}.`
        : edu.institution
          ? `I studied at ${edu.institution}.`
          : "",
    );
  } else if (evidence.summary) {
    parts.push(firstSentence(evidence.summary));
  }

  const joined = parts.filter(Boolean).join(" ");
  return joined ? [joined] : ["I am reaching out to introduce myself."];
}

function studentIntro(ctx: DraftContext): string | null {
  const edu = ctx.evidence.education[0];
  if (!edu) return null;
  const institution = edu.institution ? ` at ${edu.institution}` : "";
  if (edu.degree) return `I am studying ${edu.degree}${institution}`;
  if (edu.institution) return `I am a student at ${edu.institution}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Per-type renderers — six structurally distinct templates             */
/* ------------------------------------------------------------------ */

function renderHiringManagerIntro(ctx: DraftContext): { subject: string; body: string } {
  const base = ctx.roleTitle
    ? `Application for ${ctx.roleTitle}`
    : ctx.company
      ? `Introduction — ${ctx.company}`
      : "Introduction";
  const subject = ctx.name ? `${base} — ${ctx.name}` : base;

  const paragraphs = [
    `I am writing to introduce myself as a candidate for ${ctx.rolePhrase}${ctx.atCompany}. ${identitySentences(ctx).join(" ")}`,
    evidenceSentences(ctx, {
      includeExperience: false,
      includeEducation: true,
      includeAchievements: true,
      max: 3,
    }).join(" "),
    [
      jdLinkSentence(ctx),
      "I would welcome the opportunity to discuss how my background fits your team, and I am happy to share any further details.",
    ]
      .filter(Boolean)
      .join(" "),
    signOff(ctx),
  ];

  return { subject, body: ["Dear Hiring Manager,", ...paragraphs].join("\n\n") };
}

function renderRecruiterIntro(ctx: DraftContext): { subject: string; body: string } {
  const exploring = ctx.roleTitle ? `${ctx.roleTitle} opportunities` : "new opportunities";
  const subject = ctx.name
    ? `Exploring ${exploring}${ctx.atCompany} — ${ctx.name}`
    : `Exploring ${exploring}${ctx.atCompany}`;

  const projectBit =
    ctx.evidence.projects.length > 0 ? `, including ${ctx.evidence.projects[0].name}` : "";
  const fit = ctx.skills.length > 0
    ? `my background in ${listJoin(ctx.skills)}${projectBit} lines up with the kind of work your team does`
    : `my ${ctx.groundingNoun} lines up with the kind of work your team does`;

  const ask = ctx.roleTitle
    ? `If you are involved in hiring for ${ctx.rolePhrase}, I would welcome the chance to be considered — or, if someone else owns it, a pointer in their direction would be much appreciated.`
    : "If any of the roles you cover fit my background, I would welcome the chance to be considered.";

  const paragraphs = [
    ctx.name
      ? `My name is ${ctx.name}, and I am reaching out to introduce myself.`
      : "I am reaching out to introduce myself.",
    `I am exploring ${ctx.rolePhrase}${ctx.atCompany}, and ${fit}.`,
    ask,
    `My resume summarizes the details. Thank you for your time.\n\n${signOff(ctx)}`,
  ];

  return { subject, body: [greeting(ctx, "Hello,"), ...paragraphs].join("\n\n") };
}

function renderFollowUp(ctx: DraftContext): { subject: string; body: string } {
  const subject = ctx.roleTitle
    ? `Follow-up on ${ctx.roleTitle} Application`
    : "Follow-up on my application";

  const reference =
    ctx.skills.length > 0
      ? `For reference, my background includes hands-on experience with ${listJoin(ctx.skills)}.`
      : "";

  const paragraphs = [
    `I hope you are well. I am following up on my application for ${ctx.rolePhrase}${ctx.atCompany}.${
      ctx.contextNote ? ` ${ctx.contextNote}` : ""
    }`,
    "I remain very interested and would appreciate an update on the status whenever you have a moment.",
    reference,
    `Thank you for your time and consideration.\n\n${signOff(ctx)}`,
  ];

  return { subject, body: ["Dear Hiring Manager,", ...paragraphs].join("\n\n") };
}

function renderReferralRequest(ctx: DraftContext): { subject: string; body: string } {
  const subject = ctx.roleTitle
    ? ctx.company
      ? `Referral Request — ${ctx.roleTitle} at ${ctx.company}`
      : `Referral Request — ${ctx.roleTitle}`
    : ctx.company
      ? `Referral Request — ${ctx.company}`
      : "Referral Request";

  const intro = ctx.name
    ? `My name is ${ctx.name}. I am reaching out because I am applying for ${ctx.rolePhrase}${ctx.atCompany} and would be grateful for your perspective.`
    : `I am reaching out because I am applying for ${ctx.rolePhrase}${ctx.atCompany} and would be grateful for your perspective.`;

  const evidence = evidenceSentences(ctx, { includeEducation: false, max: 2 }).join(" ");
  const link = jdLinkSentence(ctx);

  const paragraphs = [
    intro,
    [evidence, link].filter(Boolean).join(" "),
    "Would you be comfortable referring me for this position? I completely understand if now is not a good time — even a pointer to the right contact would be a great help.",
    `Thank you for considering my request.\n\n${signOff(ctx)}`,
  ];

  return { subject, body: [greeting(ctx, "Hello,"), ...paragraphs].join("\n\n") };
}

function renderThankYou(ctx: DraftContext): { subject: string; body: string } {
  const subject = ctx.roleTitle
    ? `Thank You for the Interview — ${ctx.roleTitle}`
    : "Thank You for the Conversation";

  const appreciation = ctx.contextNote
    ? ctx.contextNote
    : "It was a pleasure to connect with you and learn more about the opportunity.";

  const interest = ctx.skills.length > 0
    ? `I remain genuinely interested, and my experience with ${listJoin(ctx.skills)} feels well suited to the work.`
    : "I remain genuinely interested in the opportunity.";

  const paragraphs = [
    `Thank you for taking the time to speak with me about ${ctx.rolePhrase}${ctx.atCompany}.`,
    appreciation,
    interest,
    `Please let me know if there is any additional information I can provide. I look forward to staying in touch.\n\n${signOff(ctx)}`,
  ];

  return { subject, body: [greeting(ctx, "Hello,"), ...paragraphs].join("\n\n") };
}

function renderInternshipOutreach(ctx: DraftContext): { subject: string; body: string } {
  const subject = ctx.roleTitle
    ? /\bintern/i.test(ctx.roleTitle)
      ? `Interest in the ${ctx.roleTitle}`
      : `Internship Opportunity — ${ctx.roleTitle}`
    : ctx.name
      ? `Internship Interest — ${ctx.name}`
      : "Internship Interest";

  // Student framing only when the resume shows education; early-career
  // framing only when it shows projects. Never claims professional
  // experience the resume does not contain.
  const studies = studentIntro(ctx);
  const firstExp = ctx.evidence.experience[0];
  let intro: string;
  if (studies) {
    intro = ctx.name ? `My name is ${ctx.name}, and ${studies}.` : `${studies}.`;
  } else if (ctx.hasPro && firstExp) {
    intro = ctx.name
      ? `My name is ${ctx.name}, and I have experience${
          firstExp.role ? ` as ${firstExp.role}` : ""
        } at ${firstExp.organization}.`
      : `I have experience${firstExp.role ? ` as ${firstExp.role}` : ""} at ${firstExp.organization}.`;
  } else if (ctx.evidence.projects.length > 0) {
    intro = ctx.name
      ? `My name is ${ctx.name}. I am an early-career candidate with hands-on project experience.`
      : "I am an early-career candidate with hands-on project experience.";
  } else {
    intro = identitySentences(ctx).join(" ");
  }

  const evidence = evidenceSentences(ctx, {
    includeExperience: false,
    includeEducation: false,
    includeAchievements: true,
    max: 3,
  }).join(" ");

  const interest = `I am particularly interested in ${ctx.rolePhrase}${ctx.atCompany}${
    ctx.signals.length > 0 ? `, especially the focus on ${listJoin(ctx.signals)}` : ""
  }, and I would value the chance to contribute and keep learning on the team.`;

  const paragraphs = [
    intro,
    evidence,
    interest,
    `My resume outlines the rest of my background. Thank you for your time and consideration.\n\n${signOff(ctx)}`,
  ];

  return { subject, body: ["Dear Hiring Manager,", ...paragraphs].join("\n\n") };
}

function renderDraft(
  ctx: DraftContext,
  type: DraftType,
): { subject: string; body: string } {
  switch (type) {
    case "recruiter_intro":
      return renderRecruiterIntro(ctx);
    case "follow_up":
      return renderFollowUp(ctx);
    case "referral_request":
      return renderReferralRequest(ctx);
    case "thank_you":
      return renderThankYou(ctx);
    case "internship_outreach":
      return renderInternshipOutreach(ctx);
    case "hiring_manager_intro":
    default:
      return renderHiringManagerIntro(ctx);
  }
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Generate a resume-grounded cold email draft.
 *
 * @throws {MissingResumeContentError} when the resume version has no
 *   extractable content (clear, actionable message for the UI).
 */
export function generateDraft(input: GenerateDraftInput): GeneratedDraftContent {
  const evidence = extractResumeEvidence(input.resumeVersion);
  if (!hasUsableResumeContent(evidence)) {
    throw new MissingResumeContentError();
  }

  const ctx = buildContext(input, evidence);
  const rendered = renderDraft(ctx, input.draftType);

  return {
    subject: tidyInline(rendered.subject),
    body: tidyBody(rendered.body),
    evidence,
    roleTitle: ctx.roleTitle,
    company: ctx.company,
  };
}
