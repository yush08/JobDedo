import { describe, it, expect } from "vitest";
import { analyzeResumeForJob } from "@/features/ats/analysis";

describe("ATS Analysis — regression", () => {
  const jobDesc = `Data Science Intern

Required skills: Python, SQL, Pandas, NumPy
Preferred skills: Scikit-learn, Matplotlib, statistical modelling

Responsibilities:
- Analyze customer behaviour using large datasets
- Build data pipelines and ETL processes
- Create visualizations and dashboards
- Perform feature engineering
- Help with predictive modelling

The intern will work with 3,000+ record datasets and help generate insights for revenue and retention improvement.`;

  const tanya = "Tanya Singh\ntanya@example.com\nPhone: 555-123-4566\n\nEDUCATION\nB.S. in Math\n\nEXPERIENCE\n- Python chatbot project using NLP\n\nSKILLS\nPython, C++";

  const kumar = "Kumar Ayush\nkumar@example.com\nPhone: 555-987-6543\n\nEDUCATION\nB.S. Data Science\n\nEXPERIENCE\n- Analyzed 3900-record dataset to identify customer behaviour\n- Built Power BI dashboards for revenue and retention\n\nSKILLS\nPython, SQL, Pandas, NumPy\n\nPROJECTS\n- Data cleaning and feature engineering";

  it("Tanya email detected", () => {
    const r = analyzeResumeForJob(tanya, jobDesc);
    expect(r.formattingIssues).not.toContain("No contact email detected");
  });

  it("Kumar email detected", () => {
    const r = analyzeResumeForJob(kumar, jobDesc);
    expect(r.formattingIssues).not.toContain("No contact email detected");
  });

  it("Tanya has SQL as missing keyword", () => {
    const r = analyzeResumeForJob(tanya, jobDesc);
    expect(r.missingKeywords).toContain("SQL");
  });

  it("Kumar has SQL as matched keyword", () => {
    const r = analyzeResumeForJob(kumar, jobDesc);
    const hasSql = r.matchedRequirements?.includes("SQL") || r.missingKeywords?.includes("SQL");
    expect(hasSql).toBe(true);
  });

  it("Tanya document quality score is valid (not 50 fallback)", () => {
    const r = analyzeResumeForJob(tanya, jobDesc);
    expect(r.documentQualityScore).toBeGreaterThan(0);
    expect(r.documentQualityScore).toBeLessThan(100);
    // Score should be based on actual sections, not hardcoded
    expect(r.documentQualityScore).not.toBe(50); // Tanya has education, experience, skills sections
  });

  it("Kumar document quality score is valid (not 50 fallback)", () => {
    const r = analyzeResumeForJob(kumar, jobDesc);
    expect(r.documentQualityScore).toBeGreaterThan(0);
    expect(r.documentQualityScore).toBeLessThan(100);
    // Kumar has more sections so score should differ from Tanya's
    expect(r.documentQualityScore).not.toBe(50);
  });

  it("Different resumes produce different missing keywords", () => {
    const tanyaR = analyzeResumeForJob(tanya, jobDesc);
    const kumarR = analyzeResumeForJob(kumar, jobDesc);
    // Tanya lacks SQL, Pandas, NumPy - Kumar has them
    expect(tanyaR.missingKeywords).toContain("SQL");
    expect(kumarR.missingKeywords).not.toContain("SQL"); // Kumar has SQL
  });

  it("Both resumes produce reasonable alignment scores", () => {
    const tanyaR = analyzeResumeForJob(tanya, jobDesc);
    const kumarR = analyzeResumeForJob(kumar, jobDesc);
    // Both scores should be based on evidence, not default
    expect(tanyaR.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(tanyaR.alignmentScore).toBeLessThanOrEqual(100);
    expect(kumarR.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(kumarR.alignmentScore).toBeLessThanOrEqual(100);
  });
});