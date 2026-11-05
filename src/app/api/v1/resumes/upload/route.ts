import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { promises as fs } from "fs";
import path from "path";
import { generateLatexSource } from "@/lib/resume/latex-generator";
import { PDFParse } from "pdf-parse";
import type { StructuredResumeContent } from "@/lib/resume/latex-generator";

/**
 * POST /api/v1/resumes/upload — Resume upload and parsing (Milestone 5).
 *
 * Contract:
 * - multipart/form-data with a single file field named "resume"
 * - text extraction server-side using pdf-lib (PDF) or ZIP/XML parsing (DOCX)
 * - extraction result returned as a REVIEW DRAFT
 * - original file is preserved to disk
 * - supported mime types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("multipart/form-data")) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const formData = await request.formData();
  const file = formData.get("resume") as File | null;

  if (!file || file.size === 0) {
    return new Response(
      JSON.stringify({ error: "No resume file provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ error: "File size must be under 5 MB" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const isPdf = file.type.startsWith("application/pdf");
  const isDocx = file.type.startsWith(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  if (!isPdf && !isDocx) {
    return new Response(
      JSON.stringify({
        error: "Unsupported file type. Expected PDF or DOCX.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Read the file buffer
  const buffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(buffer);

  // Store the original file to disk
  const uploadsDir = path.join(process.cwd(), ".data", "resume_files");
  await fs.mkdir(uploadsDir, { recursive: true });
  const originalFilePath = path.join(uploadsDir, randomUUID());
  await fs.writeFile(originalFilePath, fileBuffer);

  // Extract text from the uploaded document
  let extractedText = "";
  const warnings: string[] = [];

  try {
    if (isPdf) {
      extractedText = await extractPdfText(fileBuffer);
      if (!extractedText.trim()) {
        warnings.push(
          "No text could be extracted from this PDF. It may be image-based or encrypted.",
        );
      }
    } else if (isDocx) {
      extractedText = await extractDocxText(fileBuffer);
      if (!extractedText.trim()) {
        warnings.push(
          "No text could be extracted from this DOCX file.",
        );
      }
    }
  } catch (err) {
    warnings.push(
      `Text extraction encountered an error: ${err instanceof Error ? err.message : String(err)}`,
    );
    extractedText = "";
  }

  // Persist resume and version records
  const db = getDataStore();
  const profile = await db.ensureProfile();

  const versionNumber = 1;
  const source = isPdf ? "pdf" : "docx";

  const resume = await db.createResume({
    profile_id: profile.id,
    title: file.name.replace(/\.(pdf|docx)$/i, ""),
    storage_path: originalFilePath,
    bucket: "",
    source: "upload",
    current_version_id: null,
    original_file_path: originalFilePath,
    original_file_name: file.name,
    original_file_type: file.type,
  });

  const parsed = parseResumeText(extractedText);

  const version = await db.createResumeVersion({
    resume_id: resume.id,
    profile_id: profile.id,
    version_number: versionNumber,
    raw_text: extractedText,
    parsed,
    tailored_for_job_id: null,
  });

  // Auto-create a ResumeProject and SourceVersion from the extracted content
  const project = await db.createResumeProject({
    profile_id: profile.id,
    name: file.name.replace(/\.(pdf|docx)$/i, ""),
    original_resume_id: resume.id,
    active_version_id: null,
    template_id: "minimal",
  });

  // Generate LaTeX source from extracted content
  const latexSource = generateLatexSource(
    parsed as StructuredResumeContent,
    { template: "minimal", name: resume.title },
  );

  const sourceVersion = await db.createResumeSourceVersion({
    project_id: project.id,
    version_number: 1,
    latex_source: latexSource,
    structured_content: parsed,
    template_id: "minimal",
  });

  // Set the active version on the project and resume
  await db.updateResumeProject(project.id, {
    active_version_id: sourceVersion.id,
  });
  await db.updateResumeCurrentVersion(resume.id, sourceVersion.id);

  return new Response(
    JSON.stringify({
      draftId: version.id,
      versionNumber,
      extractedText,
      confidence: extractedText ? 0.8 : 0.3,
      warnings,
      extractedSections: parsed,
      source,
      resumeId: resume.id,
      resumeProjectId: project.id,
      sourceVersionId: sourceVersion.id,
      latexSource,
      originalFilePath,
      originalFileName: file.name,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

/**
 * Extract text from a PDF buffer using pdf-parse.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text || "";
  } catch (err) {
    throw new Error(
      `PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Extract text from a DOCX buffer by parsing document.xml inside the ZIP.
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xml = zip.file("word/document.xml");
    if (!xml) {
      throw new Error("word/document.xml not found in DOCX");
    }
    const xmlText = await xml.async("string");
    // Very basic XML-to-text: extract all w:t element contents
    const textMatches = xmlText.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    const parts: string[] = [];
    for (const match of textMatches) {
      parts.push(match[1]);
    }
    return parts.join(" ");
  } catch (err) {
    throw new Error(
      `DOCX extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Parse raw extracted text into structured resume sections.
 * These are best-effort heuristics; the user can review and edit the LaTeX source.
 */
function parseResumeText(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const personalInfo: {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin_url?: string;
    github_url?: string;
    portfolio_url?: string;
  } = {};

  // Try to find name on the first non-empty line
  if (lines.length > 0) {
    personalInfo.full_name = lines[0];
  }

  // Extract email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) personalInfo.email = emailMatch[0];

  // Extract phone
  const phoneMatch = text.match(
    /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
  );
  if (phoneMatch) personalInfo.phone = phoneMatch[0];

  // Extract LinkedIn
  const linkedinMatch = text.match(/linkedin\.com\/in\/[^\s)]+/i);
  if (linkedinMatch) personalInfo.linkedin_url = linkedinMatch[0];

  // Extract GitHub
  const githubMatch = text.match(/github\.com\/[^\s)]+/i);
  if (githubMatch) personalInfo.github_url = githubMatch[0];

  // Simple section detection
  const sections: Record<string, string[]> = {
    summary: [],
    education: [],
    experience: [],
    skills: [],
    projects: [],
    certifications: [],
    achievements: [],
  };

  let currentSection: keyof typeof sections | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("summary") ||
      lower.includes("profile") ||
      lower.includes("objective")
    ) {
      currentSection = "summary";
      continue;
    }
    if (lower.includes("education")) {
      currentSection = "education";
      continue;
    }
    if (lower.includes("experience") || lower.includes("employment")) {
      currentSection = "experience";
      continue;
    }
    if (lower.includes("skill")) {
      currentSection = "skills";
      continue;
    }
    if (lower.includes("project")) {
      currentSection = "projects";
      continue;
    }
    if (lower.includes("certification")) {
      currentSection = "certifications";
      continue;
    }
    if (lower.includes("achievement") || lower.includes("award")) {
      currentSection = "achievements";
      continue;
    }

    if (currentSection && line.length > 0) {
      sections[currentSection].push(line);
    }
  }

  return {
    personalInfo,
    summary: sections.summary.length > 0 ? sections.summary.join(" ") : undefined,
    education:
      sections.education.length > 0
        ? sections.education.map((e) => ({ institution: e, degree: undefined }))
        : undefined,
    experience:
      sections.experience.length > 0
        ? sections.experience.map((e) => ({ organization: e, role: undefined }))
        : undefined,
    skills:
      sections.skills.length > 0
        ? [{ category: "Technical Skills", items: sections.skills }]
        : undefined,
    projects: undefined,
    certifications: undefined,
    achievements:
      sections.achievements.length > 0 ? sections.achievements : undefined,
  };
}
