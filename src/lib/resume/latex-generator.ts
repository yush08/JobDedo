/**
 * LaTeX source generation from extracted resume content.
 *
 * Converts structured resume data into a compilable LaTeX resume source.
 * Never invents information - only uses what was extracted or provided.
 */

export interface StructuredResumeContent {
  personalInfo?: {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin_url?: string;
    github_url?: string;
    portfolio_url?: string;
  };
  summary?: string;
  education?: Array<{
    institution?: string;
    degree?: string;
    field_of_study?: string;
    start_date?: string;
    end_date?: string;
    graduation_date?: string;
    cgpa?: string;
    location?: string;
  }>;
  experiences?: Array<{
    organization?: string;
    role?: string;
    start_date?: string;
    end_date?: string;
    location?: string;
    description?: string;
    achievements?: string[];
  }>;
  projects?: Array<{
    title?: string;
    description?: string;
    technologies?: string[];
    responsibilities?: string[];
    achievements?: string[];
    url?: string;
  }>;
  skills?: Array<{
    category?: string;
    items?: string[];
  }>;
  certifications?: Array<{
    name?: string;
    issuer?: string;
    date?: string;
    url?: string;
  }>;
  achievements?: string[];
}

function escapeLatex(text: string): string {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  // Handle various date formats
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * Render a bullet list as a well-formed itemize environment.
 *
 * Regression guard: the previous implementation emitted
 * `\begin{itemize}[leftmargin=*]\\` (a `\\` in vertical mode, which LaTeX
 * rejects with "There's no line here to end") and closed the environment with
 * `\\end{itemize}` (a line break plus literal text), so the environment never
 * actually closed and every document containing bullets failed to compile.
 */
function itemize(items: string[]): string {
  if (items.length === 0) return "";
  return `\\begin{itemize}[leftmargin=*]\n${items.join("\n")}\n\\end{itemize}`;
}

/**
 * Join a block's text lines with `\\` hard breaks and append an optional list
 * block. `\\` is only emitted between lines (horizontal mode) or before a
 * list block — never after it, because `\\` in vertical mode is a LaTeX error.
 */
function buildBlock(lines: string[], list = ""): string {
  const textLines = lines.filter((l) => l.length > 0);
  if (textLines.length === 0) return list;
  const text = textLines
    .map((line, i) =>
      list || i < textLines.length - 1 ? `${line}\\\\` : line,
    )
    .join("\n");
  return list ? `${text}\n${list}` : text;
}

export function generateLatexSource(
  content: StructuredResumeContent,
  options: {
    template?: "minimal" | "modern" | "technical" | "compact" | "academic";
    name?: string;
  } = {},
): string {
  const p = content.personalInfo || {};
  const name = escapeLatex(p.full_name || options.name || "Your Name");
  const email = escapeLatex(p.email || "");
  const phone = escapeLatex(p.phone || "");
  const location = escapeLatex(p.location || "");
  const linkedin = escapeLatex(p.linkedin_url || "");
  const github = escapeLatex(p.github_url || "");

  const header = [
    "\\documentclass[11pt,a4paper]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{lmodern}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{xcolor}",
    "\\usepackage{titlesec}",
    "\\usepackage{enumitem}",
    "\\usepackage{hyperref}",
    "\\hypersetup{colorlinks=true, linkcolor=blue, urlcolor=blue}",
    "\\definecolor{headingcolor}{RGB}{0,51,102}",
    "\\definecolor{subheadingcolor}{RGB}{70,130,180}",
    "\\titleformat{\\section}{\\color{headingcolor}\\Large\\bfseries}{\\thesection}{1em}{}",
    "\\titleformat{\\subsection}{\\color{subheadingcolor}\\large\\bfseries}{\\thesubsection}{1em}{}",
    "\\setlength{\\parindent}{0pt}",
    "\\setlength{\\parskip}{6pt}",
    "\\pagestyle{empty}",
    "",
    "\\begin{document}",
    "",
    "\\begin{center}",
    `{\\Huge\\bfseries\\color{headingcolor} ${name}}\\\\`,
    email ? `${email} \\textbullet{} ` : "",
    phone ? `${phone} \\textbullet{} ` : "",
    location ? `${location} \\\\` : "",
    linkedin ? `\\href{${linkedin}}{LinkedIn} \\textbullet{} ` : "",
    github ? `\\href{${github}}{GitHub}` : "",
    "\\end{center}",
    "",
    "\\vspace{0.5cm}",
    "\\hrule",
    "\\vspace{0.3cm}",
    "",
  ].filter(Boolean).join("\n");

  const sections: string[] = [];

  // Summary
  if (content.summary) {
    sections.push(
      "\\section*{Professional Summary}",
      escapeLatex(content.summary),
      "",
    );
  }

  // Education
  if (content.education && content.education.length > 0) {
    const eduItems = content.education
      .map((edu) => {
        const lines: string[] = [];
        const degree = escapeLatex(edu.degree || "");
        const field = escapeLatex(edu.field_of_study || "");
        const inst = escapeLatex(edu.institution || "");
        const grad = formatDate(edu.graduation_date || edu.end_date || "");
        lines.push(`\\textbf{${degree}${field ? ", " + field : ""}}\\\\`);
        lines.push(`${inst}, ${grad}`);
        if (edu.cgpa) lines.push(`CGPA: ${escapeLatex(edu.cgpa)}`);
        return lines.join(" ");
      })
      .join("\\\\\n");
    sections.push("\\section*{Education}", eduItems, "");
  }

  // Experience
  if (content.experiences && content.experiences.length > 0) {
    const expItems = content.experiences
      .map((exp) => {
        const role = escapeLatex(exp.role || "");
        const org = escapeLatex(exp.organization || "");
        const start = formatDate(exp.start_date);
        const end = formatDate(exp.end_date);
        const loc = escapeLatex(exp.location || "");
        const desc = escapeLatex(exp.description || "");
        const achievements = itemize(
          (exp.achievements || []).map((a) => `\\item ${escapeLatex(a)}`),
        );
        const orgLine = [org, loc].filter(Boolean).join(", ");
        const lines = [
          `\\textbf{${role}} \\hfill ${start} -- ${end}`,
          orgLine,
        ];
        if (desc) lines.push(desc);
        return buildBlock(lines, achievements);
      })
      .join("\n\n\\vspace{6pt}\n");
    sections.push("\\section*{Experience}", expItems, "");
  }

  // Projects
  if (content.projects && content.projects.length > 0) {
    const projItems = content.projects
      .map((proj) => {
        const title = escapeLatex(proj.title || "");
        const desc = escapeLatex(proj.description || "");
        const techs = (proj.technologies || [])
          .map((t) => escapeLatex(t))
          .join(", ");
        const resp = itemize(
          (proj.responsibilities || []).map((r) => `\\item ${escapeLatex(r)}`),
        );
        const url = proj.url
          ? `\\href{${escapeLatex(proj.url)}}{Project Link}`
          : "";
        const lines = [
          `\\textbf{${title}}${url ? ` \\hfill ${url}` : ""}`,
        ];
        if (techs) lines.push(`Technologies: ${techs}`);
        if (desc) lines.push(desc);
        return buildBlock(lines, resp);
      })
      .join("\n\n\\vspace{6pt}\n");
    sections.push("\\section*{Projects}", projItems, "");
  }

  // Skills
  if (content.skills && content.skills.length > 0) {
    const skillItems = content.skills
      .map((s) => {
        const cat = escapeLatex(s.category || "Skills");
        const items = (s.items || []).map((i) => escapeLatex(i)).join(", ");
        return `\\textbf{${cat}:} ${items}`;
      })
      .join("\\\\\n");
    sections.push("\\section*{Skills}", skillItems, "");
  }

  // Certifications
  if (content.certifications && content.certifications.length > 0) {
    const certItems = content.certifications
      .map((c) => {
        const name = escapeLatex(c.name || "");
        const issuer = escapeLatex(c.issuer || "");
        const date = formatDate(c.date);
        return `\\textbf{${name}} ${issuer ? ", " + issuer : ""} ${date}`;
      })
      .join("\\\\\n");
    sections.push("\\section*{Certifications}", certItems, "");
  }

  // Achievements
  if (content.achievements && content.achievements.length > 0) {
    const achItems = itemize(
      content.achievements.map((a) => `\\item ${escapeLatex(a)}`),
    );
    sections.push("\\section*{Achievements}", achItems, "");
  }

  return [header, ...sections, "\\end{document}"].join("\n");
}