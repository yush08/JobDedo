import { describe, it, expect } from "vitest";
import {
  generateLatexSource,
  type StructuredResumeContent,
} from "@/lib/resume/latex-generator";

describe("latex-generator — complete document structure", () => {
  it("generates a minimal valid document with documentclass and document env", () => {
    const src = generateLatexSource({}, { name: "Test User" });
    expect(src).toContain("\\documentclass");
    expect(src).toContain("\\begin{document}");
    expect(src).toContain("\\end{document}");
    expect(src).toContain("\\usepackage{hyperref}");
  });

  it("regression: emits line-based source, not one character per line", () => {
    // Previously the generator spread a string (`...header`) which exploded
    // the LaTeX into one character per line and collapsed the editor width.
    const src = generateLatexSource({}, { name: "Test User" });
    const lines = src.split("\n");
    expect(lines.length).toBeGreaterThan(10);
    // The first line must be the full documentclass declaration.
    expect(lines[0]).toBe("\\documentclass[11pt,a4paper]{article}");
    // No line should be a lone character followed by single-char lines.
    expect(lines[1]).toBe("\\usepackage[utf8]{inputenc}");
    // And the source must contain a long contiguous line (header intact).
    expect(
      lines.some((l) => l.includes("\\titleformat{\\section}")),
    ).toBe(true);
  });

  it("keeps \\begin{document} and \\end{document} on their own lines", () => {
    const src = generateLatexSource({}, {});
    const lines = src.split("\n");
    expect(lines).toContain("\\begin{document}");
    expect(lines).toContain("\\end{document}");
  });
});

describe("latex-generator — realistic resume content", () => {
  const content: StructuredResumeContent = {
    personalInfo: {
      full_name: "Ayush Kumar",
      email: "ayush@example.com",
      phone: "555-123-4567",
      location: "Bengaluru, India",
      linkedin_url: "https://linkedin.com/in/ayush",
      github_url: "https://github.com/ayush",
    },
    summary: "Software engineer with 4 years of experience.",
    education: [
      {
        institution: "IIT Delhi",
        degree: "B.Tech",
        field_of_study: "Computer Science",
        graduation_date: "2022-06-01",
        cgpa: "8.9",
      },
    ],
    experiences: [
      {
        organization: "Acme Corp",
        role: "Senior Engineer",
        start_date: "2022-07-01",
        end_date: "2025-01-01",
        location: "Remote",
        description: "Built distributed systems.",
        achievements: ["Reduced latency by 40%", "Led a team of 5"],
      },
    ],
    projects: [
      {
        title: "JobDedo",
        description: "AI job discovery assistant",
        technologies: ["Next.js", "TypeScript"],
        url: "https://github.com/ayush/jobdedo",
      },
    ],
    skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
    certifications: [
      { name: "AWS SAA", issuer: "Amazon", date: "2024-03-01" },
    ],
    achievements: ["Hackathon winner 2023"],
  };

  it("includes every provided section without dropping content", () => {
    const src = generateLatexSource(content, {});
    expect(src).toContain("Ayush Kumar");
    expect(src).toContain("ayush@example.com");
    expect(src).toContain("Professional Summary");
    expect(src).toContain("Education");
    expect(src).toContain("Experience");
    expect(src).toContain("Projects");
    expect(src).toContain("Skills");
    expect(src).toContain("Certifications");
    expect(src).toContain("Achievements");
    expect(src).toContain("IIT Delhi");
    expect(src).toContain("Acme Corp");
    expect(src).toContain("JobDedo");
    expect(src).toContain("AWS SAA");
    expect(src).toContain("Hackathon winner 2023");
    // hyperlinks are real \href commands
    expect(src).toContain("\\href{https://linkedin.com/in/ayush}");
    // itemize list for achievements (`%` is escaped by the generator)
    expect(src).toContain("\\item Reduced latency by 40\\%");
  });

  it("emits well-formed itemize environments that actually close", () => {
    // Regression: the generator used to emit `\begin{itemize}[leftmargin=*]\\`
    // (a `\\` in vertical mode → "There's no line here to end") and close with
    // `\\end{itemize}` (line break + literal text → environment never closes),
    // so any resume with bullet lists failed to compile.
    const src = generateLatexSource(content, {});
    expect(src).toContain(
      "\\begin{itemize}[leftmargin=*]\n\\item Reduced latency by 40\\%",
    );
    expect(src).toContain("\\end{itemize}");
    expect(src).not.toContain("[leftmargin=*]\\\\");
    expect(src).not.toContain("\\\\end{itemize}");
    // Every \begin{itemize} must have a matching \end{itemize}.
    const begins = src.match(/\\begin\{itemize\}/g) || [];
    const ends = src.match(/\\end\{itemize\}/g) || [];
    expect(begins.length).toBeGreaterThan(0);
    expect(ends.length).toBe(begins.length);
  });

  it("escapes LaTeX special characters from user content", () => {
    const src = generateLatexSource(
      { summary: "50% faster & $avings #1 under_score {braced}" },
      {},
    );
    expect(src).toContain("50\\%");
    expect(src).toContain("\\&");
    expect(src).toContain("\\$");
    expect(src).toContain("\\#");
    expect(src).toContain("\\_");
    expect(src).toContain("\\{");
    expect(src).toContain("\\}");
    // The raw unescaped sequence must not appear
    expect(src).not.toContain("50% faster");
  });

  it("does not fabricate sections when content is empty", () => {
    const src = generateLatexSource({}, { name: "Placeholder" });
    expect(src).not.toContain("\\section*{Education}");
    expect(src).not.toContain("\\section*{Experience}");
    expect(src).not.toContain("\\section*{Skills}");
    // Only the chosen name placeholder appears in the header
    expect(src).toContain("Placeholder");
  });
});
