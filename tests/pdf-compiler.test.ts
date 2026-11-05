import { describe, it, expect } from "vitest";
import {
  validateLatexDocument,
  checkUnsafeLatex,
  compileResume,
  detectLatexCompiler,
  applyXeTeXCompat,
  TECTONIC_PATH,
} from "@/lib/resume/pdf-compiler";
import { generateLatexSource } from "@/lib/resume/latex-generator";

const minimalDoc = [
  "\\documentclass[11pt,a4paper]{article}",
  "\\usepackage[utf8]{inputenc}",
  "\\begin{document}",
  "Hello resume.",
  "\\end{document}",
].join("\n");

const compileInput = (latexSource: string) => ({
  projectId: "test-project",
  sourceVersionId: "test-version",
  latexSource,
  structuredContent: null,
  templateId: "minimal",
});

describe("LaTeX validation (Part 13 — A/F/G/I/J)", () => {
  it("A: accepts a minimal valid document", () => {
    expect(validateLatexDocument(minimalDoc)).toEqual([]);
  });

  it("B: accepts the realistic generated resume template", () => {
    const src = generateLatexSource(
      {
        personalInfo: { full_name: "Ayush Kumar", email: "a@b.co" },
        summary: "Engineer",
        skills: [{ category: "Langs", items: ["TS"] }],
      },
      {},
    );
    expect(validateLatexDocument(src)).toEqual([]);
  });

  it("F: rejects a document missing \\begin{document}", () => {
    const errors = validateLatexDocument(
      "\\documentclass{article}\nHello.\n\\end{document}",
    );
    expect(errors.join(" ")).toContain("\\begin{document}");
  });

  it("rejects a document missing \\end{document}", () => {
    const errors = validateLatexDocument(
      "\\documentclass{article}\n\\begin{document}\nHello.",
    );
    expect(errors.join(" ")).toContain("\\end{document}");
  });

  it("J: rejects a source without \\documentclass", () => {
    const errors = validateLatexDocument(
      "\\begin{document}\nHello.\n\\end{document}",
    );
    expect(errors.join(" ")).toContain("\\documentclass");
  });

  it("G: rejects an unbalanced opening brace", () => {
    const errors = validateLatexDocument(
      "\\documentclass{article}\n\\begin{document}\n\\textbf{oops\n\\end{document}",
    );
    expect(errors.join(" ")).toMatch(/brace/i);
  });

  it("G: rejects an unbalanced closing brace", () => {
    const errors = validateLatexDocument(
      "\\documentclass{article}\n\\begin{document}\noops}\n\\end{document}",
    );
    expect(errors.join(" ")).toMatch(/brace/i);
  });

  it("I: rejects empty source", () => {
    expect(validateLatexDocument("").length).toBeGreaterThan(0);
    expect(validateLatexDocument("   \n  ").length).toBeGreaterThan(0);
  });
});

describe("LaTeX security policy (Part 13 — C/D/E/H)", () => {
  it("C: allows safe local \\input{glyphtounicode}", () => {
    const src = [
      "\\documentclass{article}",
      "\\input{glyphtounicode}",
      "\\begin{document}",
      "ok",
      "\\end{document}",
    ].join("\n");
    expect(checkUnsafeLatex(src)).toEqual([]);
  });

  it("D: blocks an absolute path in \\input", () => {
    const found = checkUnsafeLatex("\\input{C:\\Windows\\evil.sty}");
    expect(found.join(" ")).toMatch(/absolute path blocked/);
  });

  it("D: blocks an absolute POSIX path in \\input", () => {
    const found = checkUnsafeLatex("\\input{/etc/passwd}");
    expect(found.length).toBeGreaterThan(0);
  });

  it("E: blocks path traversal in \\input", () => {
    const found = checkUnsafeLatex("\\input{../../secrets}");
    expect(found.join(" ")).toMatch(/path traversal blocked/);
    const found2 = checkUnsafeLatex("\\input{sub/dir/file}");
    expect(found2.join(" ")).toMatch(/path traversal blocked/);
  });

  it("H: blocks shell escape (\\write18)", () => {
    const found = checkUnsafeLatex("\\write18{rm -rf /}");
    expect(found.join(" ")).toContain("\\write18");
  });

  it("H: blocks \\input@path redirection", () => {
    expect(checkUnsafeLatex("\\input@path{/tmp}").length).toBeGreaterThan(0);
  });

  it("H: blocks \\include", () => {
    expect(checkUnsafeLatex("\\include{other}").length).toBeGreaterThan(0);
  });

  it("allows an ordinary resume with no unsafe commands", () => {
    expect(checkUnsafeLatex(minimalDoc)).toEqual([]);
  });
});

describe("XeTeX compatibility shim (pdfTeX-only primitives)", () => {
  it("leaves ordinary sources byte-for-byte unchanged", () => {
    expect(applyXeTeXCompat(minimalDoc)).toBe(minimalDoc);
    const generated = generateLatexSource({}, { name: "Test User" });
    expect(applyXeTeXCompat(generated)).toBe(generated);
  });

  it("injects stand-ins only when pdfTeX primitives are referenced", () => {
    const src = [
      "\\documentclass{article}",
      "\\pdfgentounicode=1",
      "\\input{glyphtounicode}",
      "\\begin{document}",
      "ok",
      "\\end{document}",
    ].join("\n");
    const out = applyXeTeXCompat(src);
    expect(out).toContain("\\newcount\\pdfgentounicode");
    expect(out).toContain("\\def\\pdfglyphtounicode#1#2{}");
    // The original source is preserved verbatim after the shim.
    expect(out.endsWith(src)).toBe(true);
    expect(out.indexOf("\\documentclass")).toBeGreaterThan(
      out.indexOf("\\newcount"),
    );
  });
});

describe("Tectonic configuration", () => {
  it("resolves the project-installed Tectonic binary", () => {
    expect(TECTONIC_PATH.toLowerCase()).toContain("tectonic");
    expect(() => detectLatexCompiler()).not.toThrow();
  });
});

const compilerAvailable = detectLatexCompiler().available;

describe.skipIf(!compilerAvailable)("Tectonic compilation (integration)", () => {
  it("compiles the exact source passed in (typeout probe reaches Tectonic)", async () => {
    const marker = "JOBDEDO_EXACT_SOURCE_PROBE_9f3a";
    const src = [
      "\\documentclass[11pt,a4paper]{article}",
      "\\begin{document}",
      `\\typeout{${marker}}`,
      "Exact source check.",
      "\\end{document}",
    ].join("\n");

    const result = await compileResume(compileInput(src));
    expect(result.status).toBe("success");
    expect(result.log).toContain(marker);
    expect(result.pdfBuffer).not.toBeNull();
    expect(result.pdfBuffer!.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(result.pdfBuffer!.includes("%%EOF")).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
  }, 90000);

  it("compiles the realistic generated resume template", async () => {
    const src = generateLatexSource(
      {
        personalInfo: {
          full_name: "Ayush Kumar",
          email: "ayush@example.com",
          phone: "555-123-4567",
        },
        summary: "Software engineer.",
        education: [
          { institution: "IIT Delhi", degree: "B.Tech", graduation_date: "2022-06-01" },
        ],
        experiences: [
          { organization: "Acme", role: "Engineer", start_date: "2022-07-01", end_date: "2025-01-01" },
        ],
        skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
      },
      {},
    );

    const result = await compileResume(compileInput(src));
    expect(result.status).toBe("success");
    expect(result.pdfBuffer).not.toBeNull();
    expect(result.pdfBuffer!.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 90000);

  it("compiles a document with safe \\input{glyphtounicode}", async () => {
    const src = [
      "\\documentclass[11pt,a4paper]{article}",
      "\\input{glyphtounicode}",
      "\\begin{document}",
      "glyphtounicode probe",
      "\\end{document}",
    ].join("\n");
    const result = await compileResume(compileInput(src));
    expect(result.status).toBe("success");
    expect(result.pdfBuffer).not.toBeNull();
  }, 90000);

  it("compiles pdfTeX-only constructs (\\pdfgentounicode=1 + glyphtounicode)", async () => {
    // Real user templates (e.g. Jake Gutierrez's resume) use these; they are
    // undefined under Tectonic's XeTeX engine without the compat shim.
    const src = [
      "\\documentclass[11pt,a4paper]{article}",
      "\\pdfgentounicode=1",
      "\\input{glyphtounicode}",
      "\\begin{document}",
      "compat probe",
      "\\end{document}",
    ].join("\n");
    const result = await compileResume(compileInput(src));
    expect(result.status).toBe("success");
    expect(result.pdfBuffer).not.toBeNull();
    expect(result.pdfBuffer!.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 90000);

  it("compiles a generated resume containing bullet lists (itemize)", async () => {
    // Regression: the generator used to emit a vertical-mode `\\` after
    // \begin{itemize} and `\\end{itemize}`, so any resume with bullets
    // failed to compile.
    const src = generateLatexSource(
      {
        personalInfo: { full_name: "Ayush Kumar", email: "a@b.co" },
        experiences: [
          {
            organization: "Acme",
            role: "Engineer",
            start_date: "2022-07-01",
            end_date: "2025-01-01",
            description: "Built things.",
            achievements: ["Reduced latency by 40%", "Led a team of 5"],
          },
        ],
        projects: [
          {
            title: "JobDedo",
            description: "AI assistant",
            technologies: ["Next.js"],
            responsibilities: ["Designed the API"],
            url: "https://github.com/ayush/jobdedo",
          },
        ],
        achievements: ["Hackathon winner 2023"],
      },
      {},
    );
    const result = await compileResume(compileInput(src));
    expect(result.status).toBe("success");
    expect(result.pdfBuffer).not.toBeNull();
    expect(result.pdfBuffer!.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(result.pdfBuffer!.includes("%%EOF")).toBe(true);
  }, 90000);

  it("returns real compiler diagnostics for invalid LaTeX (H)", async () => {
    const src = [
      "\\documentclass[11pt,a4paper]{article}",
      "\\begin{document}",
      "\\thisCommandDoesNotExistXYZ",
      "\\end{document}",
    ].join("\n");
    const result = await compileResume(compileInput(src));
    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(
      /undefined|undefined control sequence|thisCommandDoesNotExistXYZ/i,
    );
    expect(result.pdfBuffer).toBeNull();
  }, 90000);

  it("fails validation before invoking Tectonic for incomplete documents", async () => {
    const result = await compileResume(
      compileInput("\\documentclass{article}\n\\end{document}"),
    );
    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("\\begin{document}");
  }, 30000);

  it("blocks unsafe source before invoking Tectonic", async () => {
    const result = await compileResume(
      compileInput(
        "\\documentclass{article}\n\\begin{document}\n\\write18{evil}\n\\end{document}",
      ),
    );
    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("Unsafe LaTeX commands");
  }, 30000);
});
