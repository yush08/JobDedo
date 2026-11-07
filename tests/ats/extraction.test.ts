import { describe, it, expect } from "vitest";
import { extractJobRequirements, type Requirement } from "@/features/ats/analysis";
import { classifyRequirement, scoreResumeAgainstJob } from "@/features/ats/scoring";

/**
 * Regression tests for job-description requirement extraction.
 *
 * Ground rules asserted here:
 * - the entire JD is parsed, not only sentences containing trigger words
 * - Required (weight 3) > Preferred (weight 1)
 * - only explicit preference wording makes a requirement Preferred
 * - equivalent terms are normalised, duplicates collapse to one entry
 * - no malformed fragments, no fabricated requirements, no category lock-in
 * - missing keywords and the explanation use the exact same list
 */

const SAMPLE_JD =
  "We are looking for a motivated Data Science Intern with a strong foundation in Python, SQL, and machine learning. " +
  "The candidate will work on data cleaning, exploratory data analysis (EDA), statistical modelling, and predictive analytics. " +
  "Knowledge of Pandas, NumPy, Scikit-learn, Matplotlib, and data visualization tools such as Power BI is preferred.";

const EXPECTED_SAMPLE: Array<[string, string, number]> = [
  ["python", "Python", 3],
  ["sql", "SQL", 3],
  ["machine learning", "Machine Learning", 3],
  ["data cleaning", "Data Cleaning", 3],
  ["exploratory data analysis", "Exploratory Data Analysis", 3],
  ["statistical modelling", "Statistical Modelling", 3],
  ["predictive analytics", "Predictive Analytics", 3],
  ["pandas", "Pandas", 1],
  ["numpy", "NumPy", 1],
  ["scikit-learn", "Scikit-learn", 1],
  ["matplotlib", "Matplotlib", 1],
  ["power bi", "Power BI", 1],
];

function byKey(reqs: Requirement[]): Map<string, Requirement> {
  return new Map(reqs.map((r) => [r.key, r]));
}

describe("JD extraction — exact Data Science Intern sample", () => {
  const reqs = extractJobRequirements(SAMPLE_JD);

  it("extracts every technical requirement exactly once", () => {
    expect(reqs.map((r) => [r.key, r.label, r.weight])).toEqual(EXPECTED_SAMPLE);
    expect(new Set(reqs.map((r) => r.key)).size).toBe(reqs.length);
  });

  it("classifies foundational and explicitly required skills as Required", () => {
    const map = byKey(reqs);
    for (const key of ["python", "sql", "machine learning", "data cleaning", "exploratory data analysis", "statistical modelling", "predictive analytics"]) {
      const req = map.get(key);
      expect(req, `missing ${key}`).toBeDefined();
      expect(req!.weight, key).toBe(3);
      expect(classifyRequirement(req!), key).toBe("required");
    }
  });

  it("classifies Power BI and the other explicitly preferred skills as Preferred", () => {
    const map = byKey(reqs);
    for (const key of ["pandas", "numpy", "scikit-learn", "matplotlib", "power bi"]) {
      const req = map.get(key);
      expect(req, `missing ${key}`).toBeDefined();
      expect(req!.weight, key).toBe(1);
      expect(classifyRequirement(req!), key).toBe("preferred");
    }
    // The trailing "is preferred" must not reclassify the earlier prose.
    expect(map.get("python")!.weight).toBeGreaterThan(map.get("power bi")!.weight);
  });

  it("does not produce malformed fragments or duplicates", () => {
    for (const req of reqs) {
      expect(req.label).toBe(req.label.trim());
      expect(req.label.length).toBeGreaterThan(1);
      expect(req.key).not.toMatch(/\b(?:is|are|such|preferred|required|desired)\b/);
      expect(req.key).not.toMatch(/^[.,:;-]+|[.,:;-]+$/);
      expect(req.key).toMatch(/[a-z0-9]/i);
    }
  });
});

describe("JD extraction — classification across JD shapes", () => {
  it("distinguishes explicitly required from explicitly preferred skills", () => {
    const jd = "Backend Engineer\nRequired skills: Go, PostgreSQL\nPreferred skills: Kafka, Terraform";
    const map = byKey(extractJobRequirements(jd));
    expect(map.get("go")!.weight).toBe(3);
    expect(map.get("postgresql")!.weight).toBe(3);
    expect(map.get("kafka")!.weight).toBe(1);
    expect(map.get("terraform")!.weight).toBe(1);
    expect(classifyRequirement(map.get("kafka")!)).toBe("preferred");
    expect(classifyRequirement(map.get("go")!)).toBe("required");
  });

  it("treats every requirement as Required when the JD has no preferred section", () => {
    const jd = "Frontend Developer\nRequired skills: React, TypeScript\nWe also need strong CSS skills.";
    const reqs = extractJobRequirements(jd);
    expect(reqs.map((r) => r.key)).toEqual(["react", "typescript", "css"]);
    expect(reqs.every((r) => r.weight === 3)).toBe(true);
    expect(reqs.every((r) => classifyRequirement(r) === "required")).toBe(true);
  });

  it("keeps a preferred skill listed before a required skill correctly classified", () => {
    const multiline = "Cloud Engineer\nPreferred skills: Docker\nRequired skills: Kubernetes";
    const mapA = byKey(extractJobRequirements(multiline));
    expect(mapA.get("docker")!.weight).toBe(1);
    expect(mapA.get("kubernetes")!.weight).toBe(3);

    const singleLine = "Preferred: Docker; Required: Kubernetes";
    const mapB = byKey(extractJobRequirements(singleLine));
    expect(mapB.get("docker")!.weight).toBe(1);
    expect(mapB.get("kubernetes")!.weight).toBe(3);
  });

  it("works for job categories outside data science", () => {
    const jd = "Marketing Manager\nRequired skills: SEO, Google Analytics\nPreferred skills: HubSpot";
    const map = byKey(extractJobRequirements(jd));
    expect(map.get("seo")!.weight).toBe(3);
    expect(map.get("google analytics")!.weight).toBe(3);
    expect(map.get("hubspot")!.weight).toBe(1);
    expect(map.has("python")).toBe(false);
  });
});

describe("JD extraction — deduplication and normalisation", () => {
  it("collapses repeated mentions of the same skill into one requirement", () => {
    const jd = "Data Engineer\nWe need Python, Python, and SQL.\nPython is a must-have.";
    const reqs = extractJobRequirements(jd);
    expect(reqs.map((r) => r.key)).toEqual(["python", "sql"]);
    expect(reqs.every((r) => r.weight === 3)).toBe(true);
  });

  it("normalises synonyms and abbreviations to one canonical requirement", () => {
    const reqs = extractJobRequirements("Skills required: ML, sklearn, powerbi, EDA");
    expect(reqs.map((r) => [r.key, r.label])).toEqual([
      ["machine learning", "Machine Learning"],
      ["scikit-learn", "Scikit-learn"],
      ["power bi", "Power BI"],
      ["exploratory data analysis", "Exploratory Data Analysis"],
    ]);
    expect(reqs.every((r) => r.weight === 3)).toBe(true);

    // The long form and the abbreviation are the same requirement.
    const both = extractJobRequirements("We need machine learning (ML) experience");
    expect(both.map((r) => r.key)).toEqual(["machine learning"]);
    expect(both[0].label).toBe("Machine Learning");
  });

  it("does not fabricate requirements that are absent from the JD", () => {
    const reqs = extractJobRequirements("Senior Frontend Engineer\nRequired skills: React, TypeScript");
    const keys = reqs.map((r) => r.key);
    expect(keys).toEqual(["react", "typescript"]);
    expect(keys).not.toContain("python");
    expect(keys).not.toContain("machine learning");
  });
});

describe("JD extraction — malformed or incomplete input", () => {
  it("returns an empty list for empty input", () => {
    expect(extractJobRequirements("")).toEqual([]);
    expect(extractJobRequirements("   \n \n  ")).toEqual([]);
    expect(extractJobRequirements("preferred")).toEqual([]);
  });

  it("never emits fragments from a truncated JD", () => {
    const partial = extractJobRequirements("Preferred skills: Python, SQL, and");
    expect(partial.map((r) => r.key)).toEqual(["python", "sql"]);
    expect(partial.every((r) => r.weight === 1)).toBe(true);

    const truncated = extractJobRequirements(
      "We are looking for a\nRequired: \nPreferred skills: ... is .",
    );
    for (const req of truncated) {
      expect(req.key.length).toBeGreaterThanOrEqual(2);
      expect(req.label).toBe(req.label.trim());
      expect(req.key).toMatch(/[a-z0-9]/i);
      expect(req.key).not.toMatch(/\b(?:is|are|such)\b/);
    }
  });
});

describe("JD extraction — different JDs, different requirement lists", () => {
  it("produces a distinct list per JD while sharing only real overlaps", () => {
    const dataScience = extractJobRequirements(SAMPLE_JD);
    const react = extractJobRequirements(
      "Senior Frontend Engineer\nRequired skills: React, TypeScript\nPreferred skills: Tailwind CSS",
    );
    expect(react.map((r) => r.key)).toEqual(["react", "typescript", "tailwind css"]);
    expect(react.map((r) => r.key)).not.toEqual(dataScience.map((r) => r.key));

    const dataScienceKeys = new Set(dataScience.map((r) => r.key));
    expect(react.filter((r) => dataScienceKeys.has(r.key))).toEqual([]);
  });
});

describe("JD extraction — one list drives coverage, missing keywords and the explanation", () => {
  it("uses the exact same requirement list everywhere", () => {
    const reqs = extractJobRequirements(SAMPLE_JD);
    const resume = "Jane Doe\njane@example.com\n\nEDUCATION\nB.S. Computer Science\n\nSKILLS\nPython, SQL";
    const result = scoreResumeAgainstJob(resume, reqs);

    expect(result.explanation.requirements.map((r) => r.requirement)).toEqual(reqs.map((r) => r.label));
    expect(result.missingKeywords).toEqual(
      result.explanation.requirements.filter((r) => !r.matched).map((r) => r.requirement),
    );
    expect(result.coverage.totalWeight).toBe(reqs.reduce((sum, r) => sum + r.weight, 0));
    expect(result.explanation.jobCoverage.totalRequirements).toBe(reqs.length);

    expect(result.missingKeywords).not.toContain("Python");
    expect(result.missingKeywords).not.toContain("SQL");
    expect(result.missingKeywords).toContain("Machine Learning");
    expect(result.missingKeywords).toContain("Power BI");
  });
});
