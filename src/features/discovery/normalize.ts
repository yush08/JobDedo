import type { EmploymentType, ExperienceLevel, WorkModel } from "@/types";

/**
 * Source-agnostic normalisation helpers (Milestone 2).
 *
 * HONESTY RULES ENFORCED HERE
 * - Nothing is invented: salary/duration/date parsing requires an explicit
 *   published value (with an explicit period for money) or it returns null.
 * - Inference (work model, employment type, experience level, skills, roles)
 *   is derived ONLY from text the source itself published, and any field the
 *   text does not support becomes `unknown` / `""` — never a plausible guess.
 */

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Decode HTML entities (named + numeric) exactly once. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** HTML (possibly entity-escaped, as Greenhouse returns) → readable text. */
export function stripHtml(html: string): string {
  if (!html) return "";
  // Greenhouse escapes its own HTML payload, so decode first, strip tags,
  // then decode once more for text that was double-escaped.
  const decoded = decodeEntities(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|section|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(decoded)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Collapse whitespace for comparisons and dedupe keys. */
export function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** URL-safe, comparison-safe slug: "Senior / Staff Eng" → "senior-staff-eng". */
export function slug(value: string): string {
  return squash(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_",
  "cmpid",
  "campaignid",
]);

/** True for utm_* / known tracking parameters that never change identity. */
function isTrackingParam(key: string): boolean {
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase());
}

/**
 * Canonical form used ONLY as a dedupe key (fetching always uses the original
 * URL): lowercase host, no `www.`, no fragment, no tracking parameters,
 * sorted remaining parameters, no trailing slash.
 * Returns "" when the value is not an absolute http(s) URL.
 */
export function canonicalizeUrl(raw: string): string {
  const value = squash(raw);
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const query = params
    .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
    .join("&");

  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/";

  return `${url.protocol}//${host}${pathname}${query ? `?${query}` : ""}`;
}

/** Registrable-looking domain from a URL ("", when not derivable). */
export function domainFromUrl(raw: string): string {
  const canonical = canonicalizeUrl(raw);
  if (!canonical) return "";
  try {
    return new URL(canonical).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Field inference (from source-published text only)                   */
/* ------------------------------------------------------------------ */

/** Work model from a location string the source published. */
export function workModelFromText(text: string): WorkModel {
  const value = text.toLowerCase();
  if (/\bremote\b|\bwork from home\b|\banywhere\b|\bwfh\b/.test(value)) return "remote";
  if (/\bhybrid\b/.test(value)) return "hybrid";
  return "onsite";
}

/**
 * Employment type from source-provided words. Returns "unknown" when the
 * posting carries no signal — we never guess a contract type.
 */
export function employmentTypeFromText(text: string): EmploymentType {
  const value = ` ${text.toLowerCase()} `;
  if (/\bintern(ship)?\b/.test(value)) return "internship";
  if (/\bpart[- ]time\b/.test(value)) return "part_time";
  if (/\bfull[- ]time\b/.test(value)) return "full_time";
  if (/\bfreelance\b/.test(value)) return "freelance";
  if (/\bcontract(ual|or| role| position)?\b/.test(value) || /\bshort[- ]term\b/.test(value)) {
    return "contract";
  }
  return "unknown";
}

/**
 * Experience level from the posting's own title/description. Anything the
 * text does not support — including seniority our scale cannot express —
 * stays `unknown`.
 */
export function experienceLevelFromText(title: string, description: string): ExperienceLevel {
  const value = ` ${title.toLowerCase()} ${description.slice(0, 600).toLowerCase()} `;
  if (/\bintern(ship|ship programme|ship program)?\b/.test(value)) return "student";
  if (/\bfresher\b|\bnew[- ]grad(uate)?\b|\brecent graduates?\b|\bgraduate (programme|program|scheme)\b|\bclass of 20\d\d\b/.test(value)) {
    return "fresher";
  }
  if (/\bjunior\b|\bentry[- ]level\b|\bno prior experience\b|\bzero experience\b/.test(value)) {
    return "entry_level";
  }
  const range = value.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*years?/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (max <= 1) return "0_1_years";
    if (min >= 1 && max <= 2) return "1_2_years";
    return "unknown";
  }
  const single = value.match(/(\d{1,2})\s*\+?\s*years?/);
  if (single) {
    const years = Number(single[1]);
    if (years <= 1) return "0_1_years";
    if (years <= 2) return "1_2_years";
    return "unknown";
  }
  return "unknown";
}

/**
 * Money parser. Returns null unless BOTH an amount and an explicit period
 * ("/month", "per annum", "LPA", …) are published — we never guess whether a
 * figure is monthly or annual.
 */
export function parseCompensation(text: string): {
  min: number | null;
  max: number | null;
  currency: string;
  period: "month" | "year" | "one_time";
} | null {
  const value = squash(text);
  if (!value) return null;

  // LPA is an Indian convention whose unit itself carries both the amount and
  // the period AND implies the currency: "8 LPA" == INR 800,000 per year. It
  // is checked before the currency-token requirement so a posting that
  // publishes only "CTC 8 LPA" (no ₹/INR token) is not thrown away.
  const lpa = value.match(/(\d+(?:\.\d+)?)\s*lpa\b/i);
  if (lpa) {
    const yearly = Math.round(Number(lpa[1]) * 100_000);
    if (Number.isFinite(yearly)) {
      return { min: yearly, max: null, currency: "INR", period: "year" };
    }
  }

  const periodMatch = value.match(
    /\b(?:per\s+month|monthly|\/\s?mo(?:nth)?\b|per\s+annum|p\.?\s?a\.?\b|annual(?:ly)?|\/\s?yr\b|per\s+year|yearly)/i,
  );
  if (!periodMatch) return null;
  const periodToken = periodMatch[0].toLowerCase();
  const period: "month" | "year" = /month|\/\s?mo/.test(periodToken) ? "month" : "year";

  const amount = (raw: string): number => {
    const cleaned = raw.replace(/[,\s]/g, "");
    const multiplier = cleaned.endsWith("k") ? 1_000 : 1;
    const base = Number.parseFloat(cleaned.replace(/k$/i, ""));
    if (!Number.isFinite(base)) return Number.NaN;
    return Math.round(base * multiplier);
  };

  // A figure is only counted when a currency label precedes it, and the
  // currency is taken from THAT label — never from a free-text scan of the
  // whole posting. (An earlier version scanned for currency words anywhere
  // and the unanchored `rs` alternative matched inside "years"/"partners",
  // mislabelling a live GBP range as INR.) Word boundaries keep `rs` honest.
  const figures = [
    ...value.matchAll(
      /(₹|\$|€|£|\b(?:inr|usd|eur|gbp)\b|\brs\.?\s?)\s?(\d[\d,]*(?:\.\d+)?\s?k?)/gi,
    ),
  ].map((m) => ({ token: m[1]!.toLowerCase(), value: amount(m[2]!) }));

  const valid = figures.filter((f) => Number.isFinite(f.value) && f.value > 0);
  if (valid.length === 0) return null;

  const token = valid[0]!.token;
  const currency = token.startsWith("₹") || token.startsWith("inr") || token.startsWith("rs")
    ? "INR"
    : token.startsWith("$") || token.startsWith("usd")
      ? "USD"
      : token.startsWith("€") || token.startsWith("eur")
        ? "EUR"
        : "GBP";

  return {
    min: valid[0]!.value,
    max: valid.length > 1 ? valid[1]!.value : null,
    currency,
    period,
  };
}

/**
 * Internship/contract duration in days — only when the posting states one.
 * Returns null for anything else (never an assumed length).
 */
export function parseDurationDays(text: string): number | null {
  const value = squash(text).toLowerCase();
  if (!/\bintern(ship)?\b|\bcontract\b|\bduration\b/.test(value)) return null;
  const match = value.match(/(\d{1,3})\s*[- ]?\s*(month|week|day|year)s?\b/);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) return null;
  switch (match[2]) {
    case "month":
      return count * 30;
    case "week":
      return count * 7;
    case "day":
      return count;
    default:
      return count * 365;
  }
}

/* ------------------------------------------------------------------ */
/* Skills & roles                                                      */
/* ------------------------------------------------------------------ */

/**
 * Conservative skill lexicon: only exact, word-boundary matches against text
 * the source published are reported (extracted, never invented).
 */
const SKILL_LEXICON = [
  // languages
  "Python","Java","JavaScript","TypeScript","C\\+\\+","C#","Go","Rust","Ruby","PHP","Kotlin","Swift","Scala","Perl","R","MATLAB","SAS","VBA","SQL","HTML","CSS","Bash",
  // frameworks / libraries
  "React","Angular","Vue","Next\\.js","Node\\.js","Django","Flask","FastAPI","Spring","Rails",".NET","jQuery","Redux","Tailwind","Flutter","React Native","PyTorch","TensorFlow","Hugging Face","LangChain","Pandas","NumPy","scikit-learn","SciPy","NLTK","spaCy","Selenium","Playwright","Cypress","Jest","Vitest",
  // data / analytics
  "Power BI","Tableau","Looker","Looker Studio","Excel","Google Sheets","Airflow","dbt","Spark","Hadoop","Kafka","ETL","ETL pipelines","BigQuery","Snowflake","Redshift","Hive","Presto","Elasticsearch","Dataflow","Data Studio","A/B testing","statistics","machine learning","deep learning","NLP","computer vision","time series","forecasting","data analysis","data visualization","data modelling","data modeling",
  // databases
  "PostgreSQL","MySQL","MongoDB","Redis","Cassandra","DynamoDB","Oracle","SQL Server","MariaDB","SQLite","Neo4j",
  // cloud / devops
  "AWS","GCP","Google Cloud","Azure","Docker","Kubernetes","Terraform","Ansible","Jenkins","GitHub Actions","GitLab CI","CI/CD","Linux","Unix","Nginx","Prometheus","Grafana","ArgoCD","OpenStack","Heroku","Vercel","Netlify",
  // product / design
  "Figma","Sketch","Adobe XD","Photoshop","Illustrator","InDesign","After Effects","Premiere Pro","wireframing","prototyping","user research","usability testing","design systems","UX","UI design","accessibility","WCAG","Information Architecture",
  // business / ops
  "Jira","Confluence","Slack","Notion","Asana","Trello","Linear","Salesforce","HubSpot","Zendesk","SAP","ServiceNow","Marketo","SEO","SEM","Google Analytics","GA4","QuickBooks","project management","agile","scrum","stakeholder management","product management","market research","financial modelling","financial modeling","due diligence","recruitment","onboarding",
] as const;

const SKILL_PATTERNS: { label: string; pattern: RegExp }[] = SKILL_LEXICON.map(
  (entry) => ({
    label: entry.replace(/\\/g, ""),
    // Single-letter/word skills ("R", "Go") must not match ordinary prose,
    // so they stay case-sensitive; everything else is case-insensitive.
    pattern: new RegExp(
      entry === "R" || entry === "Go"
        ? `(?<![A-Za-z0-9+#.])${entry}(?![A-Za-z0-9+#])`
        : `(?<![a-z0-9+#.])${entry}(?![a-z0-9+#])`,
      entry === "R" || entry === "Go" ? "" : "i",
    ),
  }),
);

/** Skills explicitly mentioned in the posting text (max 14, source order). */
export function extractSkills(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { label, pattern } of SKILL_PATTERNS) {
    if (out.length >= 14) break;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    if (pattern.test(text)) {
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

/**
 * Role tags derived from the posting's own title plus any department/team the
 * source publishes. Unknown titles simply yield the source-provided tags.
 */
const ROLE_KEYWORDS: [RegExp, string][] = [
  [/data analyst|business intelligence|bi analyst/i, "Data Analyst"],
  [/data scientist|data science/i, "Data Scientist"],
  [/machine learning|ml engineer|ai engineer|ai\/ml/i, "AI/ML Engineer"],
  [/cloud engineer|aws|azure|gcp/i, "Cloud Engineer"],
  [/devops|site reliability|sre\b/i, "DevOps Engineer"],
  [/frontend|front-end|front end/i, "Frontend Developer"],
  [/backend|back-end|back end/i, "Backend Developer"],
  [/full[- ]?stack/i, "Full Stack Developer"],
  [/software engineer|software developer|application developer|programmer/i, "Software Developer"],
  [/quality assurance|\bqa\b|test engineer|automation tester/i, "QA Engineer"],
  [/product manager|\bpm\b/i, "Product Manager"],
  [/ui\/?ux|user experience|user interface|product designer|designer/i, "UI/UX Designer"],
  [/business analyst/i, "Business Analyst"],
  [/financial analyst|finance/i, "Finance Analyst"],
  [/marketing/i, "Marketing"],
  [/sales|account executive|business development/i, "Sales"],
  [/recruiter|talent acquisition|human resources|\bhr\b/i, "HR"],
  [/operations/i, "Operations"],
  [/research (scientist|engineer|associate)|researcher/i, "Research"],
  [/mechanical engineer/i, "Mechanical Engineer"],
  [/civil engineer/i, "Civil Engineer"],
  [/electrical engineer/i, "Electrical Engineer"],
  [/data engineer/i, "Data Engineer"],
  [/security engineer|information security|cybersecurity/i, "Security Engineer"],
  [/technical writer|content writer/i, "Content Writer"],
  [/project manager/i, "Project Manager"],
];

export function extractRoleTags(...parts: string[]): string[] {
  const text = parts.filter(Boolean).join(" ");
  const tags: string[] = [];
  for (const [pattern, tag] of ROLE_KEYWORDS) {
    if (pattern.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/* ------------------------------------------------------------------ */
/* Description section parsing                                         */
/* ------------------------------------------------------------------ */

/**
 * Sections a posting may publish. Only text found under a heading the source
 * itself wrote is attributed to that section — nothing is inferred.
 */
type SectionKind = "preferred" | "responsibility" | "eligibility" | "required" | "benefit";

const SECTION_PATTERNS: [SectionKind, RegExp][] = [
  ["preferred", /\b(preferred|nice[- ]to[- ]have|bonus|desirable|would be (?:a )?plus|is a plus|advantage)\b/i],
  // The stems below carry an explicit plural so the trailing \b still matches
  // the headings sources actually write ("Requirements", "Responsibilities").
  ["responsibility", /\b(responsibilit(?:y|ies)?|what you'?ll do|what you will do|the role|day[- ]to[- ]day|about the role|your (?:tasks|missions)|who we'?re looking for)\b/i],
  ["eligibility", /\b(eligibilit(?:y|ies)?|who can apply|minimum eligibility|education (?:requirement|qualification)|eligibility criteria|who should apply)\b/i],
  ["required", /\b(requirements?|qualifications?|what you'?ll need|must[- ]have|minimum (?:qualifications|requirements)|skills required|required skills|who you are|about you)\b/i],
  ["benefit", /\b(benefits|what we offer|perks|compensation and benefits|what we provide|what we give you)\b/i],
];

const BULLET = /^(?:[•*\-–—]|\d+[.)])\s+/;
const EXPERIENCE_LINE =
  /\b(?:\d{1,2}\s*[-–to]+\s*\d{1,2}\s*years?|\d{1,2}\+?\s*years of experience|years of experience|experience (?:of|required|needed|minimum))\b/i;

function isHeading(line: string): boolean {
  if (line.length > 90) return false;
  if (BULLET.test(line)) return false;
  if (/[.!?]$/.test(line)) return false;
  return line.endsWith(":") || SECTION_PATTERNS.some(([, re]) => re.test(line));
}

function kindOf(line: string): SectionKind | null {
  for (const [kind, re] of SECTION_PATTERNS) if (re.test(line)) return kind;
  return null;
}

export interface DescriptionSections {
  responsibilities: string[];
  required_skills: string[];
  preferred_skills: string[];
  benefits: string[];
  eligibility: string;
  experience_text: string;
}

/**
 * Split a published description into its own sections.
 *
 * Responsibilities / benefits / eligibility / required / preferred skills are
 * only collected when the source wrote a heading for them; a heading-less
 * description simply yields empty sections (and skills found in the raw text
 * still land in `skills` via `extractSkills`).
 */
export function parseDescriptionSections(text: string): DescriptionSections {
  const out: DescriptionSections = {
    responsibilities: [],
    required_skills: [],
    preferred_skills: [],
    benefits: [],
    eligibility: "",
    experience_text: "",
  };
  const requiredSeen = new Set<string>();
  const preferredSeen = new Set<string>();
  const experienceLines: string[] = [];
  let kind: SectionKind | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) {
      kind = kindOf(line);
      continue;
    }
    if (experienceLines.length < 2 && EXPERIENCE_LINE.test(line)) {
      experienceLines.push(line.slice(0, 300));
    }
    const body = line.replace(BULLET, "").trim();

    switch (kind) {
      case "responsibility":
        if (out.responsibilities.length < 8 && body.length > 15) {
          out.responsibilities.push(body.slice(0, 300));
        }
        break;
      case "benefit":
        if (out.benefits.length < 10 && body.length > 3) {
          out.benefits.push(body.slice(0, 200));
        }
        break;
      case "eligibility":
        if (!out.eligibility && body.length > 3) out.eligibility = body.slice(0, 400);
        break;
      case "required":
        for (const skill of extractSkills(line)) {
          const key = skill.toLowerCase();
          if (!requiredSeen.has(key)) {
            requiredSeen.add(key);
            out.required_skills.push(skill);
          }
        }
        break;
      case "preferred":
        for (const skill of extractSkills(line)) {
          const key = skill.toLowerCase();
          if (preferredSeen.has(key) || requiredSeen.has(key)) continue;
          preferredSeen.add(key);
          out.preferred_skills.push(skill);
        }
        break;
      default:
        break;
    }
  }

  out.experience_text = experienceLines.join(" ");
  return out;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Source timestamp (ISO string or epoch millis) → ISO instant, else null. */
export function toIsoInstant(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Source timestamp → YYYY-MM-DD (employer-local date as published), else null. */
export function toIsoDate(value: unknown): string | null {
  const instant = toIsoInstant(value);
  return instant ? instant.slice(0, 10) : null;
}

/**
 * Trailing tokens that ARE countries even though they are only 2–3 letters.
 *
 * A short trailing token is ambiguous: "NY"/"KA"/"NSW" are subdivisions, but
 * "USA"/"IND"/"UK" are countries — dropping the latter loses a country the
 * source explicitly published. Tokens are promoted to `country` only when
 * they are a full word (≥ 4 chars: "India", "Sweden") or appear in this
 * allowlist of ISO alpha-3 codes plus the universally written short forms
 * ("UK", "US", "UAE") that collide with no common subdivision code.
 * Everything else stays in `location_text` verbatim — never promoted,
 * never invented.
 */
const COUNTRY_CODE_TOKENS = new Set([
  "UK", "US", "UAE",
  "AGO", "ARE", "ARG", "AUS", "AUT", "BGD", "BEL", "BGR", "BOL", "BRA",
  "CAN", "CHE", "CHL", "CHN", "CMR", "COL", "CIV", "COD", "CRI", "CUB",
  "CZE", "DEU", "DNK", "DOM", "DZA", "ECU", "EGY", "ESP", "EST", "ETH",
  "FIN", "FRA", "GBR", "GHA", "GRC", "GTM", "HKG", "HND", "HRV", "HUN",
  "IDN", "IND", "IRL", "IRN", "IRQ", "ISR", "ITA", "JAM", "JOR", "JPN",
  "KEN", "KOR", "KWT", "LBN", "LKA", "LTU", "LVA", "MAR", "MLT", "MOZ",
  "MEX", "MYS", "NGA", "NIC", "NLD", "NOR", "NZL", "OMN", "PAK", "PAN",
  "PER", "PHL", "POL", "PRT", "PRY", "QAT", "ROU", "SAU", "SEN", "SGP",
  "SLV", "SVK", "SVN", "SWE", "THA", "TTO", "TUN", "TUR", "TWN", "UGA",
  "UKR", "URY", "USA", "UZB", "VEN", "VNM", "ZAF", "ZMB", "ZWE",
]);

/** True when a trailing location token may honestly be reported as country. */
function isCountryToken(part: string): boolean {
  if (!part || /[0-9]/.test(part)) return false; // postal codes: "10001", "NY 10001"
  if (part.length >= 4) return true; // full word: "India", "Sweden", "England"
  return COUNTRY_CODE_TOKENS.has(part.toUpperCase());
}

/** "Remote, United States" → city/country/work model split. */
export function splitLocation(
  raw: string,
  fallback: { country?: string; workModel?: WorkModel } = {},
): { city: string; country: string; location_text: string; work_model: WorkModel } {
  const location_text = squash(raw);
  const work_model = fallback.workModel ?? workModelFromText(location_text);
  if (!location_text) {
    return { city: "", country: fallback.country ?? "", location_text: "", work_model };
  }
  const parts = location_text.split(",").map((p) => squash(p)).filter(Boolean);
  const head = parts[0] ?? "";
  if (/^(remote|work from home|wfh|anywhere)$/i.test(head)) {
    return {
      city: "Remote",
      country: parts.slice(1).filter(isCountryToken).join(", ") || fallback.country || "",
      location_text,
      work_model: "remote",
    };
  }
  // Trailing parts that look like subdivision codes ("NY", "CA", "NSW",
  // "10001") are kept in `location_text` (verbatim) but never promoted to
  // `country`; recognised country codes ("USA") always are.
  const country = parts.slice(1).filter(isCountryToken).join(", ");
  return {
    city: head,
    country: country || fallback.country || "",
    location_text,
    work_model,
  };
}
