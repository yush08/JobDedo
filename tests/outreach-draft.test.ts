import { describe, expect, it } from "vitest";

import {
  DRAFT_TYPES,
  MissingResumeContentError,
  collapseDuplicateWords,
  extractCompany,
  extractRoleTitle,
  generateDraft,
  type DraftType,
} from "@/lib/outreach/draft-generator";

/**
 * Outreach generation contract:
 * - six structurally distinct drafts, role-specific subjects
 * - grounded strictly in the resume + job description
 * - clear error on empty resume content, no invented details
 */

const RESUME_VERSION = {
  raw_text: "",
  parsed: {
    personalInfo: {
      full_name: "Priya Sharma",
      email: "priya.sharma@example.com",
    },
    summary:
      "Computer science undergraduate focused on building reliable web applications and data tools.",
    education: [
      { institution: "IIT Bombay", degree: "B.Tech in Computer Science" },
    ],
    skills: [
      {
        category: "Technical Skills",
        items: ["TypeScript", "React", "Python", "PostgreSQL"],
      },
    ],
    projects: [
      {
        name: "Course Planner",
        description: "a scheduling tool built with React and TypeScript",
      },
    ],
    achievements: ["Winner of the inter-college hackathon"],
  },
};

const JOB_DESCRIPTION = [
  "Job Title: Software Engineering Intern",
  "Company: Acme Inc",
  "Requirements: Build web interfaces with TypeScript and React.",
  "Work with the team on shipping features.",
].join("\n");

const NO_COMPANY_JD = [
  "Job Title: Data Analyst",
  "Create dashboards and reports for the product team using SQL and Python.",
].join("\n");

function draft(type: DraftType) {
  return generateDraft({
    resumeVersion: RESUME_VERSION,
    jobDescription: JOB_DESCRIPTION,
    draftType: type,
  });
}

const NO_DUPLICATE_WORDS = /\b(\w+)\s+\1\b/i;
const PLACEHOLDER = /undefined|\{\{|\}\}|\bTBD\b|\bXXX\b|\[[^\]]*\]/;

describe("outreach draft generation — distinct draft types", () => {
  const results = DRAFT_TYPES.map((type) => ({ type, ...draft(type) }));

  it("produces six distinct subjects and bodies", () => {
    const subjects = new Set(results.map((r) => r.subject));
    const bodies = new Set(results.map((r) => r.body));
    expect(subjects.size).toBe(DRAFT_TYPES.length);
    expect(bodies.size).toBe(DRAFT_TYPES.length);
  });

  it("opens each body with a different first paragraph (not one shared template)", () => {
    const openers = new Set(
      results.map((r) => r.body.split("\n\n")[1] ?? ""),
    );
    expect(openers.size).toBe(DRAFT_TYPES.length);
  });

  it("uses role-specific subjects with no generic filler or placeholders", () => {
    const byType = Object.fromEntries(results.map((r) => [r.type, r] as const));
    expect(byType.hiring_manager_intro.subject).toBe(
      "Application for Software Engineering Intern — Priya Sharma",
    );
    expect(byType.follow_up.subject).toBe(
      "Follow-up on Software Engineering Intern Application",
    );
    expect(byType.referral_request.subject).toBe(
      "Referral Request — Software Engineering Intern at Acme Inc",
    );
    expect(byType.thank_you.subject).toBe(
      "Thank You for the Interview — Software Engineering Intern",
    );
    expect(byType.internship_outreach.subject).toBe(
      "Interest in the Software Engineering Intern",
    );
    expect(byType.recruiter_intro.subject).toContain(
      "Software Engineering Intern opportunities at Acme Inc",
    );

    for (const r of results) {
      expect(r.subject).not.toMatch(/your company/i);
      expect(r.subject).not.toMatch(PLACEHOLDER);
    }
  });

  it("marks each type with its structural markers", () => {
    const byType = Object.fromEntries(results.map((r) => [r.type, r] as const));
    expect(byType.hiring_manager_intro.body).toContain("Dear Hiring Manager,");
    expect(byType.hiring_manager_intro.body).toMatch(/discuss/i);
    expect(byType.follow_up.body).toMatch(/following up/i);
    expect(byType.follow_up.body).toMatch(/update on the status/i);
    expect(byType.referral_request.body).toMatch(/referring me/i);
    expect(byType.thank_you.body).toMatch(/Thank you for taking the time/i);
    expect(byType.internship_outreach.body).toMatch(/studying B\.Tech/);
    expect(byType.internship_outreach.body).toMatch(/contribute and keep learning/i);
    expect(byType.recruiter_intro.body).toMatch(/hiring for/i);
    expect(byType.recruiter_intro.body).toMatch(/introduce myself/i);
  });
});

describe("outreach draft generation — resume grounding", () => {
  it("uses real resume evidence and job-description specifics", () => {
    const result = draft("hiring_manager_intro");
    expect(result.body).toContain("TypeScript");
    expect(result.body).toContain("React");
    expect(result.body).toContain("Course Planner");
    expect(result.body).toContain("IIT Bombay");
    expect(result.body).toContain("Acme Inc");
    expect(result.body).toContain("Software Engineering Intern");
  });

  it("connects evidence to the job description", () => {
    const result = draft("hiring_manager_intro");
    expect(result.body).toMatch(
      /emphasis on TypeScript and React matches my/,
    );
  });

  it("never produces duplicate words in subject or body", () => {
    for (const type of DRAFT_TYPES) {
      const result = draft(type);
      expect(result.subject).not.toMatch(NO_DUPLICATE_WORDS);
      expect(result.body).not.toMatch(NO_DUPLICATE_WORDS);
    }
  });

  it("never invents metrics or percentages not present in the inputs", () => {
    for (const type of DRAFT_TYPES) {
      const result = draft(type);
      expect(result.body).not.toMatch(/\d+\s*%/);
      expect(result.body).not.toMatch(/\b\d+\+?\s*years of experience\b/i);
    }
  });

  it("does not claim professional experience for a projects/education-only resume", () => {
    for (const type of DRAFT_TYPES) {
      const result = draft(type);
      expect(result.body).not.toMatch(
        /professional experience|work experience|years of experience/i,
      );
    }
  });

  it("uses student framing for the internship type when education exists", () => {
    const result = draft("internship_outreach");
    expect(result.body).toContain("I am studying B.Tech in Computer Science");
    expect(result.body).toContain("IIT Bombay");
  });

  it("mentions real experience only when the resume contains it", () => {
    const withExperience = generateDraft({
      resumeVersion: {
        raw_text: "",
        parsed: {
          ...RESUME_VERSION.parsed,
          experience: [
            { organization: "Northwind Labs", role: "Software Engineer" },
          ],
        },
      },
      jobDescription: JOB_DESCRIPTION,
      draftType: "hiring_manager_intro",
    });
    expect(withExperience.body).toContain(
      "professional experience as Software Engineer at Northwind Labs",
    );
  });
});

describe("outreach draft generation — recruiter and company handling", () => {
  it("does not invent recruiter details when none are provided", () => {
    for (const type of DRAFT_TYPES) {
      const result = draft(type);
      const greetingLine = result.body.split("\n\n")[0] ?? "";
      expect(["Dear Hiring Manager,", "Hello,"]).toContain(greetingLine);
      expect(result.body).not.toMatch(/@/); // no synthesized email addresses
    }
  });

  it("uses the explicitly provided recruiter name and company", () => {
    const result = generateDraft({
      resumeVersion: RESUME_VERSION,
      jobDescription: NO_COMPANY_JD,
      draftType: "referral_request",
      recruiter: {
        name: "Jane Doe",
        title: "Talent Acquisition",
        company: "Northwind",
      },
    });
    expect(result.subject).toBe("Referral Request — Data Analyst at Northwind");
    expect(result.body).toContain("Dear Jane,");
    expect(result.body).not.toMatch(PLACEHOLDER);
  });

  it("omits the company cleanly when it is neither labelled nor provided", () => {
    const result = generateDraft({
      resumeVersion: RESUME_VERSION,
      jobDescription: NO_COMPANY_JD,
      draftType: "referral_request",
    });
    expect(result.subject).toBe("Referral Request — Data Analyst");
    expect(result.subject).not.toMatch(/your company|at undefined/i);
  });
});

describe("outreach draft generation — context notes", () => {
  it("includes supplied follow-up context verbatim", () => {
    const result = generateDraft({
      resumeVersion: RESUME_VERSION,
      jobDescription: JOB_DESCRIPTION,
      draftType: "follow_up",
      contextNote: "I applied through the careers portal last week",
    });
    expect(result.body).toContain("I applied through the careers portal last week.");
  });

  it("includes supplied interview discussion points verbatim", () => {
    const result = generateDraft({
      resumeVersion: RESUME_VERSION,
      jobDescription: JOB_DESCRIPTION,
      draftType: "thank_you",
      contextNote: "the system design discussion about caching",
    });
    expect(result.body).toContain("the system design discussion about caching.");
  });

  it("never invents discussion topics or dates when no context is supplied", () => {
    const followUp = draft("follow_up");
    expect(followUp.body).not.toMatch(
      /we (?:discussed|talked|met)|our conversation about|on (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
    );
    expect(followUp.body).not.toMatch(/\b(?:19|20)\d{2}\b/);

    const thankYou = draft("thank_you");
    expect(thankYou.body).not.toMatch(
      /we (?:discussed|talked|met)|our conversation about/i,
    );
  });
});

describe("outreach draft generation — missing resume content", () => {
  it("throws an actionable error for an empty resume version", () => {
    expect(() =>
      generateDraft({
        resumeVersion: { raw_text: "", parsed: null },
        jobDescription: JOB_DESCRIPTION,
        draftType: "hiring_manager_intro",
      }),
    ).toThrow(MissingResumeContentError);
  });

  it("throws when the raw text has no extractable sections", () => {
    expect(() =>
      generateDraft({
        resumeVersion: { raw_text: "lorem ipsum dolor sit amet", parsed: {} },
        jobDescription: JOB_DESCRIPTION,
        draftType: "internship_outreach",
      }),
    ).toThrow(/no extractable content/);
  });

  it("succeeds from raw-text sections when the parsed payload is empty", () => {
    const raw = [
      "Priya Sharma",
      "priya@example.com",
      "SUMMARY",
      "Backend developer focused on data pipelines.",
      "SKILLS",
      "Go, Kafka, Docker",
      "EXPERIENCE",
      "Data Engineer at Northwind Labs",
      "EDUCATION",
      "B.Tech in Computer Science",
    ].join("\n");
    const result = generateDraft({
      resumeVersion: { raw_text: raw, parsed: null },
      jobDescription: "Job Title: Data Engineer\nBuild pipelines with Go and Kafka.",
      draftType: "hiring_manager_intro",
    });
    expect(result.subject).toContain("Data Engineer");
    expect(result.body).toContain("Northwind Labs");
    expect(result.body).toContain("B.Tech in Computer Science");
  });
});

describe("duplicate word collapsing", () => {
  it("collapses adjacent duplicated words", () => {
    expect(collapseDuplicateWords("the the position position")).toBe(
      "the position",
    );
    expect(collapseDuplicateWords("Hello hello world")).toBe("Hello world");
    expect(collapseDuplicateWords("very very very good")).toBe("very good");
  });

  it("leaves normal text, punctuation, and paragraphs untouched", () => {
    expect(collapseDuplicateWords("great work")).toBe("great work");
    expect(collapseDuplicateWords("I am, I am sure")).toBe("I am, I am sure");
    const multi = "First paragraph.\n\nSecond paragraph with — em dash.";
    expect(collapseDuplicateWords(multi)).toBe(multi);
    expect(collapseDuplicateWords("café — résumé → …")).toBe(
      "café — résumé → …",
    );
  });
});

describe("job description extraction", () => {
  it("prefers a labelled job title", () => {
    expect(extractRoleTitle("Job Title: Platform Engineer\nRemote")).toBe(
      "Platform Engineer",
    );
    expect(extractRoleTitle("role: Data Scientist")).toBe("Data Scientist");
  });

  it("finds roles phrased in a sentence", () => {
    expect(
      extractRoleTitle("We are hiring for the Machine Learning position."),
    ).toContain("Machine Learning");
  });

  it("returns null when no role can be reliably extracted", () => {
    expect(extractRoleTitle("")).toBeNull();
    expect(extractRoleTitle("We are a friendly team that ships quickly.")).toBeNull();
  });

  it("extracts companies only from explicit or reliable signals", () => {
    expect(extractCompany("Company: Acme Inc\nHiring now")).toBe("Acme Inc");
    expect(extractCompany("Join Northwind Ltd today")).toBe("Northwind Ltd");
    expect(extractCompany("We are hiring for a great role")).toBeNull();
    expect(extractCompany("Company: your company")).toBeNull();
    expect(extractCompany("no label here", "Blue Owl")).toBe("Blue Owl");
  });
});
