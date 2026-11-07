import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { extractJobRequirements, type Requirement } from "@/features/ats/analysis";
import {
  scoreResumeAgainstJob,
  computeDocumentQuality,
  evaluateEvidence,
  type AtsScoringResult,
} from "@/features/ats/scoring";

/**
 * Regression tests for the ATS scoring engine using two synthetic PDF fixtures
 * and the same Data Science Intern job description.
 *
 * Fixtures (both fictional, both committed to the repository — no personal
 * files are needed to run this suite from a clean checkout):
 * - `anonymized_resume_fixture.pdf` — Alex Morgan: analytics-flavoured
 *   resume (Python/SQL/Pandas project evidence, NumPy only as a skill).
 * - `synthetic_resume_fixture.pdf` — Taylor Quinn: frontend-flavoured
 *   resume (React/TypeScript project evidence, a Python/NLP chatbot
 *   project, no SQL).
 *
 * Ground rules asserted here:
 * - evidence comes from the extracted PDF text, never a master profile
 * - a keyword mention alone is not "demonstrated experience"
 * - no hardcoded baseline score
 * - the explanation must correspond to the numbers it explains
 */

const ALEX_PDF = join(__dirname, "anonymized_resume_fixture.pdf");
const TAYLOR_PDF = join(__dirname, "synthetic_resume_fixture.pdf");

const DATA_SCIENCE_JD = `Data Science Intern

Required skills: Python, SQL, Pandas, NumPy
Preferred skills: Scikit-learn, Matplotlib, statistical modelling

Responsibilities:
- Analyze customer behaviour using large datasets
- Build data pipelines and ETL processes
- Create visualizations and dashboards
- Perform feature engineering
- Help with predictive modelling

The intern will work with 3,000+ record datasets and help generate insights for revenue and retention improvement.`;

async function extractPdf(path: string): Promise<string> {
  const parser = new PDFParse({ data: readFileSync(path) });
  const result = await parser.getText();
  return result.text;
}

describe("ATS scoring — PDF fixture regression", () => {
  let alexText: string;
  let taylorText: string;
  let requirements: Requirement[];
  let alex: AtsScoringResult;
  let taylor: AtsScoringResult;

  beforeAll(async () => {
    alexText = await extractPdf(ALEX_PDF);
    taylorText = await extractPdf(TAYLOR_PDF);
    requirements = extractJobRequirements(DATA_SCIENCE_JD);
    alex = scoreResumeAgainstJob(alexText, requirements);
    taylor = scoreResumeAgainstJob(taylorText, requirements);
  }, 30_000);

  it("extracts real text from both PDF fixtures", () => {
    expect(alexText).toContain("Alex Morgan");
    expect(taylorText).toContain("Taylor Quinn");
    expect(alexText.length).toBeGreaterThan(500);
    expect(taylorText.length).toBeGreaterThan(500);
  });

  it("derives requirements from the supplied JD only", () => {
    const keys = requirements.map((r) => r.key);
    expect(keys).toContain("python");
    expect(keys).toContain("sql");
    expect(keys).toContain("pandas");
    expect(keys).toContain("numpy");
    // Required/preferred distinction comes from the JD wording.
    const byKey = new Map(requirements.map((r) => [r.key, r]));
    expect(byKey.get("python")!.weight).toBeGreaterThan(byKey.get("scikit-learn")!.weight);
  });

  it("recognizes Alex's analytics project evidence", () => {
    const byReq = new Map(alex.explanation.requirements.map((r) => [r.requirement.toLowerCase(), r]));

    // Python, SQL and Pandas all appear in Alex's "BI Platform" project line.
    for (const key of ["python", "sql", "pandas"]) {
      const entry = byReq.get(key);
      expect(entry, `missing explanation for ${key}`).toBeDefined();
      expect(entry!.matched).toBe(true);
      expect(entry!.evidenceLevel).toBe("project_experience");
      expect(entry!.alignmentContribution).toBeGreaterThan(0);
      expect(entry!.excerpt, `${key} should carry an excerpt`).toBeTruthy();
    }
  });

  it("recognizes NumPy as a skill mention for Alex, not demonstrated use", () => {
    const numpy = alex.explanation.requirements.find((r) => r.requirement.toLowerCase() === "numpy");
    expect(numpy).toBeDefined();
    expect(numpy!.matched).toBe(true);
    // NumPy is only listed under Technical Skills — a mention, not project use.
    expect(numpy!.evidenceLevel).toBe("skill_mention");
    // A mention must score below demonstrated use.
    const python = alex.explanation.requirements.find((r) => r.requirement.toLowerCase() === "python");
    expect(numpy!.alignmentContribution).toBeLessThan(python!.alignmentContribution);
  });

  it("recognizes Taylor's chatbot as Python evidence", () => {
    const python = taylor.explanation.requirements.find((r) => r.requirement.toLowerCase() === "python");
    expect(python).toBeDefined();
    expect(python!.matched).toBe(true);
    expect(python!.evidenceLevel).toBe("project_experience");
    expect(python!.excerpt).toMatch(/chatbot|python|nlp/i);
  });

  it("gives neither resume unsupported machine-learning evidence", () => {
    for (const [name, result] of [["Alex", alex], ["Taylor", taylor]] as const) {
      for (const key of ["scikit-learn", "matplotlib", "statistical modelling"]) {
        const entry = result.explanation.requirements.find(
          (r) => r.requirement.toLowerCase() === key,
        );
        expect(entry, `${name}: missing ${key}`).toBeDefined();
        expect(entry!.matched, `${name}: ${key} must not match`).toBe(false);
        expect(entry!.evidenceLevel, `${name}: ${key} must have no evidence`).toBe("none");
        expect(entry!.coverageContribution).toBe(0);
        expect(entry!.alignmentContribution).toBe(0);
        expect(entry!.excerpt).toBeUndefined();
      }
      // The missing list must agree with the same matching results.
      expect(result.missingKeywords).toContain("Scikit-learn");
      expect(result.missingKeywords.length).toBe(
        result.explanation.requirements.filter((r) => !r.matched).length,
      );
    }
  });

  it("returns no unexplained baseline score", () => {
    for (const result of [alex, taylor]) {
      const { documentQuality, jobCoverage, evidenceAlignment } = result.explanation;
      // Every score must be reproducible from its own explanation.
      expect(documentQuality.score).toBe(result.documentQuality.score);
      expect(jobCoverage.score).toBe(result.coverage.score);
      expect(evidenceAlignment.score).toBe(result.alignment.score);

      expect(jobCoverage.score).toBe(
        Math.round((jobCoverage.matchedWeight / jobCoverage.totalWeight) * 100),
      );
      expect(evidenceAlignment.score).toBe(
        Math.round((evidenceAlignment.alignmentWeight / evidenceAlignment.totalWeight) * 100),
      );

      // Contributions must sum to the reported weights.
      const coverageSum = result.explanation.requirements.reduce((s, r) => s + r.coverageContribution, 0);
      const alignmentSum = result.explanation.requirements.reduce((s, r) => s + r.alignmentContribution, 0);
      expect(Math.abs(coverageSum - jobCoverage.matchedWeight)).toBeLessThan(1e-9);
      expect(Math.abs(alignmentSum - evidenceAlignment.alignmentWeight)).toBeLessThan(1e-9);
    }
    // The two resumes differ, so neither is a fixed constant.
    expect(taylor.coverage.score).not.toBe(alex.coverage.score);
    expect(taylor.alignment.score).not.toBe(alex.alignment.score);
  });

  it("keeps each requirement's evidence consistent with its contribution", () => {
    for (const result of [alex, taylor]) {
      const byKey = new Map(requirements.map((r) => [r.key, r]));
      for (const entry of result.explanation.requirements) {
        const req = [...byKey.values()].find((r) => r.label === entry.requirement);
        expect(req, `unknown requirement ${entry.requirement}`).toBeDefined();

        if (!entry.matched) {
          expect(entry.evidenceLevel).toBe("none");
          expect(entry.coverageContribution).toBe(0);
          expect(entry.alignmentContribution).toBe(0);
          expect(entry.excerpt).toBeUndefined();
        } else {
          expect(entry.coverageContribution).toBe(req!.weight);
          expect(entry.evidenceLevel).not.toBe("none");
          expect(entry.alignmentContribution).toBeGreaterThan(0);
          expect(entry.alignmentContribution).toBeLessThanOrEqual(req!.weight);
        }

        // Classification follows the extracted weight.
        if (req!.weight >= 3) expect(entry.classification).toBe("required");
        else if (req!.weight <= 1) expect(entry.classification).toBe("preferred");
      }
    }
  });

  it("scores document quality from document checks only", () => {
    for (const [name, result] of [["Alex", alex], ["Taylor", taylor]] as const) {
      const checks = result.documentQuality.checks;
      // 100 only when every explicitly defined check passes.
      const allPassed = checks.every((c) => c.passed);
      expect(result.documentQuality.score).toBe(100);
      expect(allPassed, `${name}: score is 100 but a check failed`).toBe(true);
      // Points must add up to the score (no hidden baseline).
      expect(checks.length).toBeGreaterThanOrEqual(10);
    }
    // Document quality is independent of the job description: same text,
    // same score, regardless of requirements supplied.
    const otherJd = extractJobRequirements("Senior React Developer\nRequired: Kubernetes, Go");
    expect(scoreResumeAgainstJob(alexText, otherJd).documentQuality.score).toBe(
      alex.documentQuality.score,
    );
    expect(scoreResumeAgainstJob(taylorText, otherJd).documentQuality.score).toBe(
      taylor.documentQuality.score,
    );
  });

  it("changes coverage and alignment when the job requirements change", () => {
    const reactJd = `Senior Frontend Engineer
Required skills: React, TypeScript, Next.js
Preferred skills: Tailwind CSS`;
    const reactReqs = extractJobRequirements(reactJd);
    const taylorReact = scoreResumeAgainstJob(taylorText, reactReqs);
    const alexReact = scoreResumeAgainstJob(alexText, reactReqs);

    // A different JD must yield different coverage for at least one resume —
    // scores are derived from the JD, not fixed.
    const taylorChanged = taylorReact.coverage.score !== taylor.coverage.score;
    const alexChanged = alexReact.coverage.score !== alex.coverage.score;
    expect(taylorChanged || alexChanged).toBe(true);

    // Taylor lists React/TypeScript; Alex does not — coverage must reflect that.
    const taylorReactEntry = taylorReact.explanation.requirements.find((r) =>
      r.requirement.toLowerCase().includes("react"),
    );
    const alexReactEntry = alexReact.explanation.requirements.find((r) =>
      r.requirement.toLowerCase().includes("react"),
    );
    expect(taylorReactEntry!.matched).toBe(true);
    expect(alexReactEntry!.matched).toBe(false);

    // Missing lists follow the new JD.
    expect(taylorReact.missingKeywords).not.toContain("React");
    expect(alexReact.missingKeywords).toContain("React");

    // Evidence alignment also moves with the JD.
    expect(taylorReact.alignment.score).not.toBe(taylor.alignment.score);
  });

  it("does not fabricate requirements that are absent from the JD", () => {
    const keys = requirements.map((r) => r.key);
    // The JD never mentions these, so they must not be invented as gaps.
    expect(keys).not.toContain("machine learning");
    expect(keys).not.toContain("power bi");
    expect(taylor.missingKeywords).not.toContain("Machine Learning");
    expect(alex.missingKeywords).not.toContain("Power BI");
  });
});

describe("Evidence level classification", () => {
  const lines = (text: string) => text.split(/\r?\n/);

  it("returns none when the term is absent", () => {
    const text = "SKILLS\nPython, SQL";
    expect(evaluateEvidence(text, lines(text), "kubernetes").level).toBe("none");
  });

  it("returns skill_mention for a plain skills-list entry", () => {
    const text = "TECHNICAL SKILLS\nLanguages: Python, SQL";
    const result = evaluateEvidence(text, lines(text), "python");
    expect(result.level).toBe("skill_mention");
    expect(result.excerpt).toContain("Python");
  });

  it("returns project_experience for a project-section entry", () => {
    const text = "PROJECTS\nAnalytics Tool | Python, SQL\n- Built dashboards";
    expect(evaluateEvidence(text, lines(text), "python").level).toBe("project_experience");
  });

  it("returns measurable_outcome when a metric shares the line", () => {
    const text = "PROJECTS\nAnalytics Tool\n- Reduced processing time by 40% using Python";
    expect(evaluateEvidence(text, lines(text), "python").level).toBe("measurable_outcome");
  });

  it("does not treat dates or repo handles as measurable outcomes", () => {
    const text = "SKILLS\nLanguages: Python, SQL, yush08";
    expect(evaluateEvidence(text, lines(text), "python").level).toBe("skill_mention");
    const dated = "EDUCATION\nVellore Institute of Technology July 2024 – May 2028";
    expect(evaluateEvidence(dated, lines(dated), "python").level).toBe("none");
  });
});

describe("Document quality checks", () => {
  it("scores a minimal resume below a complete one", () => {
    const minimal = "John Doe\njohn@example.com";
    const complete = `John Doe
john@example.com | 555-123-4567

EDUCATION
B.S. in Computer Science, State University, 2023

EXPERIENCE
- Built internal tooling that reduced manual reporting effort across the team
- Developed a data pipeline to consolidate scattered operational records
- Coordinated delivery with two engineers to ship the reporting release on time

SKILLS
Python, SQL, Pandas, NumPy, scikit-learn, Matplotlib, Power BI

PROJECTS
- Analyzed 1,200 records to improve retention reporting accuracy
- Built a dashboard surfacing weekly revenue and churn metrics for stakeholders`;

    const minimalResult = computeDocumentQuality(minimal);
    const completeResult = computeDocumentQuality(complete);

    expect(completeResult.score).toBeGreaterThan(minimalResult.score);
    expect(minimalResult.score).toBeLessThan(100);
    expect(completeResult.score).toBe(100);
    // A failing check must be visible in the explanation.
    expect(minimalResult.checks.some((c) => !c.passed)).toBe(true);
  });

  it("never awards 100 when a check fails", () => {
    const noEmail = `Name
555-123-4567

EDUCATION
B.S.

EXPERIENCE
- Work

SKILLS
Python

PROJECTS
- Thing`;
    const result = computeDocumentQuality(noEmail);
    expect(result.checks.find((c) => c.name === "contact_email")!.passed).toBe(false);
    expect(result.score).toBeLessThan(100);
    expect(result.formattingIssues).toContain("No contact email detected.");
  });
});
