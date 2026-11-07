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

/* ------------------------------------------------------------------ */
/* Job requirement extraction                                          */
/*                                                                     */
/* The whole description is parsed — not only the sentences that        */
/* contain trigger words — so foundational skills in ordinary prose     */
/* are found too. Classification is decided per sentence/clause: a       */
/* segment is Preferred only when it carries explicit preference         */
/* wording ("is preferred", "Preferred skills:"); everything else is     */
/* Required, so one "preferred" near the end of a JD cannot reclassify  */
/* the rest of the document.                                            */
/* ------------------------------------------------------------------ */

type RequirementMode = "required" | "preferred";

const REQUIRED_WEIGHT = 3;
const PREFERRED_WEIGHT = 1;

const PREFERRED_MARKER = /\b(preferred|nice[\s-]to[\s-]have|bonus(?:\s+points?)?|desirable|desired|optional)\b/i;
const REQUIRED_MARKER = /\b(required|requirements?|require|requires|requiring|must[\s-]have|must\s+possess|mandatory|essential)\b/i;

// "Required skills: …" — a labelled marker scopes everything up to the next
// marker (or the end of the line) to its own classification.
const LABELLED_MARKER = /\b(required|preferred|desired|nice[\s-]to[\s-]have|mandatory|optional)\b(\s+(?:skills?|qualifications?|technologies|tools?|knowledge|experience|background|stack|criteria|expertise))?\s*[:：]/gi;

const SECTION_HEADER = /^(?:about\s+(?:the\s+role|us|the\s+company)|professional\s+summary|summary|objective|career\s+objective|overview|education|qualifications?|requirements?|responsibilities|duties|what\s+you(?:'|’)ll\s+do|nice\s+to\s+have|preferred(?:\s+skills?)?|required(?:\s+skills?)?|skills?|technical\s+skills|key\s+skills|core\s+skills|competenc(?:y|ies)|technologies|tools?|certifications?|licenses?|awards?|achievements?|activities|extra[-\s]?curricular|volunteer(?:ing)?(?:\s+experience)?|publications?|references?|languages?|interests?|benefits?|perks?|employment\s+history|work\s+history|professional\s+experience|projects?|portfolio|about\s+me|personal\s+details?)$/i;

const ROLE_NOUN = /\b(?:intern|engineer|developer|analyst|scientist|architect|designer|consultant|specialist|administrator|technician|officer|manager|director|head|lead|principal|staff|graduate|apprentice|coordinator|supervisor|executive|nurse|doctor|teacher|editor|writer|assistant|associate|recruiter|trainer)\b/i;
const SENIORITY = /^(?:senior|junior|lead|principal|staff|entry|mid|graduate|remote|part|full)$/i;

// Preamble anchors: keep the meaningful tail of a clause, e.g.
// "…with a strong foundation in Python" → "Python".
const ANCHOR_SOURCES = [
  String.raw`\b(?:strong|proven|solid|good|hands[\s-]on)?\s*(?:foundation|background|experience|exposure|expertise|proficiency|knowledge|understanding|familiarity)\s+(?:in|with|of)\s+`,
  String.raw`\b(?:work(?:ing)?\s+(?:on|with)|responsible\s+for|focus(?:es|ed|ing)?\s+on|involved\s+in)\s+`,
  String.raw`\b(?:looking\s+for|seeking|must\s+(?:have|possess)|need(?:s)?|want(?:s|ed)?|expect(?:s|ed)?|requiring)\s+`,
  String.raw`\b(?:the\s+)?(?:requirements?|qualifications?|criteria)\s*(?::|(?:are|is|includes?|such\s+as))\s*`,
  String.raw`\b(?:skills?|technologies|tools?)\s+(?:such\s+as|includes?|we\s+use|used)\s+`,
  String.raw`\b(?:ability|capable)\s+to\s+`,
];

// Leading action verbs from responsibility bullets: "Build data pipelines".
// Ambiguous words that are also nouns (test, design, use, write, review…)
// are deliberately excluded so "Test automation" stays intact.
const LEADING_ACTION_SOURCE = String.raw`^(?:(?:the\s+)?(?:candidate|applicant|intern|person|individual|team|engineer|analyst|you|we)\s+(?:will|must|should|shall|may|can|is\s+expected\s+to)\s+)?(?:help(?:\s+with)?|analy[sz]e|perform|build|create|develop|implement|maintain|deploy|optimi[sz]e|improve|configure|install|troubleshoot|identify|interpret|automate|refactor|know|understand|possess|demonstrate|obtain|gain|hold|participate(?:\s+in)?|assist(?:\s+with|\s+in)?|collaborate(?:\s+with)?|work(?:ing)?\s+(?:on|with))\s+`;

// Equivalent terms are collapsed onto one canonical requirement.
const ALIASES: Record<string, string> = {
  ml: "machine learning",
  machinelearning: "machine learning",
  sklearn: "scikit-learn",
  scikitlearn: "scikit-learn",
  powerbi: "power bi",
  eda: "exploratory data analysis",
  exploratorydataanalysis: "exploratory data analysis",
};

// Display spellings that title-casing cannot derive (acronyms, camel case).
const CANONICAL_LABELS: Record<string, string> = {
  "machine learning": "Machine Learning",
  "scikit-learn": "Scikit-learn",
  "power bi": "Power BI",
  "exploratory data analysis": "Exploratory Data Analysis",
  sql: "SQL",
  aws: "AWS",
  gcp: "GCP",
  api: "API",
  etl: "ETL",
  nlp: "NLP",
  numpy: "NumPy",
  pandas: "Pandas",
  "next.js": "Next.js",
  "node.js": "Node.js",
  "vue.js": "Vue.js",
};

// Fragments that must never become requirements.
const JUNK_KEYS = new Set(["e.g", "i.e", "ie", "eg", "etc", "vs", "n/a", "tbd", "nda", "url", "etc."]);

const QUALIFICATION_PATTERN = /\b(?:degree|bachelor|master|mba|phd|diploma|certification|certified|associate|years?)\b/i;

function requirementKind(text: string): Requirement["kind"] {
  if (/responsibilit|you will|what you.?ll do|duties/i.test(text)) return "responsibility";
  if (QUALIFICATION_PATTERN.test(text)) return "qualification";
  return "skill";
}

function isSectionHeader(line: string): boolean {
  const bare = line.replace(/[:：\s]+$/, "").trim();
  if (!bare) return true;
  if (SECTION_HEADER.test(bare)) return true;
  // A colon-terminated short line ("Preferred skills:") is a heading; lines
  // with content before the last colon keep their content.
  if (/[:：]\s*$/.test(line) && !/[,;.]/.test(bare) && bare.split(/\s+/).length <= 6) return true;
  return false;
}

function headerMode(line: string): RequirementMode {
  return PREFERRED_MARKER.test(line) ? "preferred" : "required";
}

function isTitleLine(line: string): boolean {
  if (/[.!?,;:]/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  return ROLE_NOUN.test(line) || words.some((word) => SENIORITY.test(word));
}

interface ClausePiece {
  text: string;
  mode?: RequirementMode;
}

function splitLabelled(line: string): ClausePiece[] {
  const re = new RegExp(LABELLED_MARKER.source, "gi");
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    if (match[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    matches.push(match);
  }
  if (matches.length === 0) return [{ text: line }];
  const pieces: ClausePiece[] = [];
  const head = line.slice(0, matches[0].index);
  if (head.trim()) pieces.push({ text: head });
  matches.forEach((labelled, index) => {
    const start = labelled.index + labelled[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
    pieces.push({ text: line.slice(start, end), mode: PREFERRED_MARKER.test(labelled[1]) ? "preferred" : "required" });
  });
  return pieces;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

function splitClauses(text: string): string[] {
  return text
    .replace(/\s*[;|]\s*/g, ",")
    .split(/\s*(?:,|&|\b(?:and|or)\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripAnchors(text: string): string {
  let result = text;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const source of ANCHOR_SOURCES) {
      const re = new RegExp(source, "gi");
      let match: RegExpExecArray | null;
      let last: RegExpExecArray | null = null;
      while ((match = re.exec(result))) {
        if (match[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        last = match;
      }
      if (last) {
        const end = last.index + last[0].length;
        if (end < result.length) {
          result = result.slice(end);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return result;
}

function labelFromRaw(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const words = trimmed.split(" ");
  if (words.length <= 1) {
    // Single all-lowercase words are title-cased only when long enough that
    // acronyms like "SQL"/"CSS" (usually written uppercase) are unaffected.
    return words.length === 1 && /^[a-z][a-z'-]{3,}$/.test(trimmed) ? titleCase(trimmed) : trimmed;
  }
  return words
    .map((word) => (/^[a-z][a-z']*$/.test(word) && !/[.+#/-]/.test(word) ? titleCase(word) : word))
    .join(" ");
}

function canon(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function resolveRequirement(cleaned: string): { key: string; label: string } {
  const lower = normalise(cleaned);
  const key = ALIASES[canon(lower)] ?? lower;
  const label = CANONICAL_LABELS[key] ?? labelFromRaw(cleaned);
  return { key, label };
}

function cleanClause(rawClause: string): string {
  let text = rawClause
    .replace(/^\s*(?:[-*•–—]|\d+[.)])\s*/, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  // "… is preferred" / "… are required" phrasing at the end of a clause.
  text = text.replace(
    /\s*(?:is|are|was|were)?\s*(?:highly\s+|strongly\s+)?(?:preferred|required|desired|optional|a\s+plus|a\s+must|must[\s-]have|nice\s+to\s+have)\s*$/i,
    "",
  );
  // Marker words embedded mid-clause: "Python is required for this role".
  text = text.replace(/\b(?:is|are|was|were)\s+(?:required|preferred|desired|optional)\b/gi, " ");
  // Trailing role phrasing: "… for this role".
  text = text.replace(
    /\s+(?:for|in|with(?:in)?)\s+(?:this|the|our|a)\s+(?:role|position|job|team|company|project)\s*$/i,
    "",
  );
  // Trailing noun anchors: "Python experience", "Docker skills".
  text = text.replace(
    /\s+(?:experience|expertise|proficiency|knowledge|understanding|familiarity|background|exposure|skills?|abilities)\s*$/i,
    "",
  );
  // "5+ years of …"
  text = text.replace(/^\s*\d+\s*\+?\s*years?(?:\s*\+)?\s*(?:of\s+)?/i, "");
  // Leading labels: "Skills: Python", "Required: Go".
  text = text.replace(
    /^(?:required|preferred|desired|nice[\s-]to[\s-]have|must[\s-]have|qualifications?|requirements?|skills?|technologies|tools?|responsibilities|duties)\s*[:：]\s*/i,
    "",
  );
  // Preamble anchors: keep the meaningful tail of the clause.
  text = stripAnchors(text);
  // Parenthetical acronym: "exploratory data analysis (EDA)" → "…analysis".
  text = text.replace(/\s*\([^()]{1,30}\)\s*$/, "").replace(/^\s*\([^()]{1,30}\)\s*/, "");
  // "data visualization tools such as Power BI" → "Power BI".
  const suchAs = text.match(/\b(?:such\s+as|including|e\.g\.?|like)\s+(.+)$/i);
  if (suchAs?.[1]) text = suchAs[1];
  // Leading action verbs from responsibility bullets.
  for (let pass = 0; pass < 2; pass++) {
    const next = text.replace(new RegExp(LEADING_ACTION_SOURCE, "i"), "");
    if (next === text) break;
    text = next;
  }

  text = text
    .replace(/^[\s"'“”‘’([{]+/, "")
    .replace(/[\s"'“”‘’)\]}:,;|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  // Trim stop words from both ends; any stop word left inside a short phrase
  // means the clause is a sentence fragment, not a named requirement.
  const words = text.split(" ").filter(Boolean);
  while (words.length > 0 && STOP_WORDS.has(normalise(words[0]))) words.shift();
  while (words.length > 0 && STOP_WORDS.has(normalise(words[words.length - 1]))) words.pop();
  return words.join(" ");
}

function hasTechnicalSignal(text: string): boolean {
  return /\d/.test(text) || /[a-z][A-Z]/.test(text) || /[#+/]/.test(text) || /[.-][a-z]/i.test(text) || /\.[a-z]{2,}/i.test(text);
}

function buildRequirement(clause: string, mode: RequirementMode): Requirement | null {
  const cleaned = cleanClause(clause);
  if (!cleaned) return null;
  const { key, label } = resolveRequirement(cleaned);
  if (key.length < 2 || STOP_WORDS.has(key)) return null;
  if (!/[a-z0-9]/i.test(key) || /^[0-9]+$/.test(key)) return null;
  if (JUNK_KEYS.has(key)) return null;
  if (/^\d[\d,.]*\+?\s/.test(cleaned)) return null;
  if (/\b(?:we|you|they|the candidate|the intern|the applicant)\b/i.test(cleaned)) return null;

  const words = cleaned.split(/\s+/);
  const qualification = QUALIFICATION_PATTERN.test(cleaned);
  // Long fragments are only kept when they carry a technical signal
  // (digits, camel case, punctuation like "Next.js"), so prose such as
  // "customer behaviour using large datasets" never becomes a requirement.
  if (words.length > 4 && !qualification && !hasTechnicalSignal(cleaned)) return null;
  if (!qualification && words.some((word) => STOP_WORDS.has(normalise(word)))) return null;

  return {
    key,
    label,
    weight: mode === "preferred" ? PREFERRED_WEIGHT : REQUIRED_WEIGHT,
    kind: requirementKind(cleaned),
  };
}

/** Extracts named and phrase requirements from the supplied description only. */
export function extractJobRequirements(jobDescription: string): Requirement[] {
  const requirements = new Map<string, Requirement>();
  const lines = jobDescription.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let inherited: RequirementMode = "required";

  const add = (clause: string, mode: RequirementMode) => {
    const built = buildRequirement(clause, mode);
    if (!built) return;
    const existing = requirements.get(built.key);
    if (existing) {
      // A skill repeated with stronger wording keeps the stronger weight.
      existing.weight = Math.max(existing.weight, built.weight);
      return;
    }
    requirements.set(built.key, built);
  };

  lines.forEach((line, lineIndex) => {
    // Section headings ("Responsibilities:", "Preferred skills:") set the
    // classification for what follows but are not requirements themselves.
    if (isSectionHeader(line)) {
      inherited = headerMode(line);
      return;
    }
    // The posting title (e.g. "Data Science Intern") is not a requirement.
    if (lineIndex === 0 && isTitleLine(line)) return;

    for (const piece of splitLabelled(line)) {
      if (piece.mode) inherited = piece.mode;
      for (const sentence of splitSentences(piece.text)) {
        if (!sentence) continue;

        const preferred = PREFERRED_MARKER.test(sentence);
        const required = REQUIRED_MARKER.test(sentence);
        let sentenceMode: RequirementMode | null;
        if (piece.mode) sentenceMode = piece.mode;
        else if (preferred && !required) sentenceMode = "preferred";
        else if (required && !preferred) sentenceMode = "required";
        else if (!preferred && !required) sentenceMode = inherited;
        else sentenceMode = null; // both markers → resolve per clause

        for (const clause of splitClauses(sentence)) {
          const mode = sentenceMode ?? (PREFERRED_MARKER.test(clause) ? "preferred" : "required");
          add(clause, mode);
        }
        if (sentenceMode) inherited = sentenceMode;
      }
    }
  });

  return [...requirements.values()].slice(0, 40);
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
