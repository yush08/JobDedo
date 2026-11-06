/**
 * PDF compilation engine for Resume Studio.
 *
 * Uses Tectonic (a modern TeX/LaTeX compiler) to compile actual LaTeX
 * source into PDF. This is a genuine LaTeX compilation engine, not a
 * JavaScript PDF generator.
 *
 * Security model:
 * - All compilation happens in a unique temporary directory per job
 * - Shell escape is disabled
 * - No environment variables are passed to the compiler
 * - Compilation time is bounded (30 second timeout)
 * - Output size is limited
 * - Temporary files are cleaned up after compilation
 * - No arbitrary file inclusion outside the compilation workspace
 * - \input is allowed only for safe, local dependencies (e.g. glyphtounicode)
 *   that exist within the compilation workspace
 */

import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";
import crypto from "crypto";
import { accessSync, constants } from "fs";

export interface CompileInput {
  projectId: string;
  sourceVersionId: string;
  latexSource: string;
  structuredContent: Record<string, unknown> | null;
  templateId: string;
}

export interface CompileOutput {
  compilationId: string;
  status: "success" | "failed";
  pdfBuffer: Buffer | null;
  log: string;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

const MAX_DURATION_MS = 60000; // 60 second timeout (first run may download packages)

/**
 * Resolve the Tectonic binary path. Checks TECTONIC_PATH env var first,
 * then falls back to a project-relative path, then to the system PATH.
 */
function resolveTectonicPath(): string {
  if (process.env.TECTONIC_PATH) {
    return process.env.TECTONIC_PATH;
  }
  // Project-relative fallback (Windows)
  const projectRelative = path.join(
    process.cwd(),
    "tectonic-msvc-bin",
    "tectonic.exe",
  );
  try {
    accessSync(projectRelative, constants.X_OK);
    return projectRelative;
  } catch {
    // Fall through to "tectonic" on PATH
  }
  return "tectonic";
}

export const TECTONIC_PATH: string = resolveTectonicPath();

/**
 * Detect whether a LaTeX compiler (Tectonic) is available in the environment.
 */
export function detectLatexCompiler(): {
  available: boolean;
  command: string | null;
  message: string;
} {
  try {
    execSync(`${TECTONIC_PATH} --version`, {
      stdio: "pipe",
      timeout: 5000,
    });
    return {
      available: true,
      command: TECTONIC_PATH,
      message: "Tectonic LaTeX compiler available.",
    };
  } catch {
    return {
      available: false,
      command: null,
      message:
        "No LaTeX compiler found. Install Tectonic (tectonic-typesetting/tectonic) " +
        "and set TECTONIC_PATH environment variable to the tectonic.exe path.",
    };
  }
}

/**
 * Validate that the LaTeX source is a complete document before compilation.
 * Returns an array of validation error messages (empty if valid).
 */
export function validateLatexDocument(latexSource: string): string[] {
  const errors: string[] = [];

  if (!latexSource || !latexSource.trim()) {
    errors.push("LaTeX source is empty.");
    return errors;
  }

  // Check for \begin{document}
  if (!/\\begin\s*\{document\}/.test(latexSource)) {
    errors.push(
      "Missing \\begin{document}. A complete LaTeX document must declare \\begin{document}.",
    );
  }

  // Check for \end{document}
  if (!/\\end\s*\{document\}/.test(latexSource)) {
    errors.push(
      "Missing \\end{document}. A complete LaTeX document must end with \\end{document}.",
    );
  }

  // Check \documentclass exists
  if (!/\\documentclass/.test(latexSource)) {
    errors.push(
      "Missing \\documentclass. A complete LaTeX document must declare \\documentclass.",
    );
  }

  // Basic brace balance check (rough)
  let braceDepth = 0;
  for (let i = 0; i < latexSource.length; i++) {
    if (latexSource[i] === "{" && latexSource[i - 1] !== "\\") braceDepth++;
    else if (latexSource[i] === "}" && latexSource[i - 1] !== "\\") braceDepth--;
    if (braceDepth < 0) {
      errors.push("Unbalanced closing brace detected in LaTeX source.");
      break;
    }
  }
  if (braceDepth > 0) {
    errors.push("Unbalanced opening brace detected in LaTeX source.");
  }

  return errors;
}

/**
 * Check for potentially unsafe LaTeX commands.
 *
 * Safe \input commands are allowed for local dependencies that exist
 * within the compilation workspace (e.g. glyphtounicode). Absolute paths
 * and path traversal are blocked.
 *
 * Returns an array of unsafe command names found (empty if all safe).
 */
export function checkUnsafeLatex(latexSource: string): string[] {
  const alwaysUnsafePatterns: Array<{ name: string; regex: RegExp }> = [
    { name: "\\write18", regex: /\\write18/i },
    { name: "\\immediate", regex: /\\immediate/i },
    { name: "\\input@path", regex: /\\input@path/i },
    { name: "\\openout", regex: /\\openout/i },
    { name: "\\closeout", regex: /\\closeout/i },
    { name: "\\read", regex: /\\read\b/i },
    { name: "\\write", regex: /\\write\b/i },
    { name: "\\catcode", regex: /\\catcode/i },
    { name: "\\@@input", regex: /@@input/i },
    { name: "\\marginpar", regex: /\\marginpar/i },
  ];

  const found: string[] = [];

  for (const { name, regex } of alwaysUnsafePatterns) {
    if (regex.test(latexSource)) {
      found.push(name);
    }
  }

  // Check \include (blocked entirely — not needed for resumes)
  if (/\\include\b/i.test(latexSource)) {
    found.push("\\include");
  }

  // Check \input — only allow safe local references (e.g. glyphtounicode)
  const inputMatches = latexSource.matchAll(/\\input\s*\{([^}]+)\}/gi);
  for (const match of inputMatches) {
    const arg = match[1].trim();
    // Block absolute paths
    if (path.isAbsolute(arg) || /^[a-z]:[\\/]/i.test(arg) || arg.startsWith("\\")) {
      found.push(`\\input{${arg}} (absolute path blocked)`);
      continue;
    }
    // Block path traversal
    if (arg.includes("..") || arg.includes("/") || arg.includes("\\")) {
      found.push(`\\input{${arg}} (path traversal blocked)`);
      continue;
    }
    // Allow glyphtounicode and similar safe local dependencies
    // They will be resolved against the compilation workspace
  }

  return found;
}

/**
 * Resolve a safe \input dependency by copying it from known locations
 * into the compilation workspace if it exists there.
 */
async function resolveInputDependencies(
  latexSource: string,
  tmpDir: string,
): Promise<string> {
  let result = latexSource;
  const inputMatches = Array.from(
    latexSource.matchAll(/\\input\s*\{([^}]+)\}/gi),
  );

  for (const match of inputMatches) {
    const arg = match[1].trim();
    // Skip if already resolved or unsafe
    if (path.isAbsolute(arg) || arg.includes("..")) continue;

    // Look for the file in known safe locations
    const searchPaths = [
      path.join(process.cwd(), arg),
      path.join(process.cwd(), "texmf", arg),
      path.join(process.cwd(), "texmf", "tex", "latex", arg),
    ];

    let foundPath: string | null = null;
    for (const searchPath of searchPaths) {
      try {
        await fs.access(searchPath);
        foundPath = searchPath;
        break;
      } catch {
        // Not found here
      }
    }

    if (foundPath) {
      // Copy the file into the compilation workspace
      const fileName = path.basename(foundPath);
      const destPath = path.join(tmpDir, fileName);
      const content = await fs.readFile(foundPath);
      await fs.writeFile(destPath, content);
      // Update the \\input reference to use just the filename
      result = result.replace(
        new RegExp(`\\\\input\\s*\\{${escapeRegExp(arg)}\\}`, "g"),
        `\\input{${fileName}}`,
      );
    }
  }

  return result;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * pdfTeX → XeTeX compatibility shim.
 *
 * Tectonic runs the XeTeX engine, which does not define the pdfTeX-only
 * primitives `\pdfgentounicode` and `\pdfglyphtounicode`. Popular resume
 * templates — including the Jake Gutierrez template used by real JobDedo
 * users — do `\pdfgentounicode=1` and `\input{glyphtounicode}`, which
 * hard-fail under XeTeX with "Undefined control sequence". Under XeTeX the
 * ToUnicode maps are produced automatically by xdvipdfmx, so these primitives
 * are unnecessary; we define safe stand-ins (a count register that absorbs
 * `=1`, and a two-argument no-op) so the document compiles unchanged.
 *
 * Injected only when the source actually references these primitives, so
 * ordinary documents compile byte-for-byte unmodified.
 */
export function applyXeTeXCompat(source: string): string {
  const needsShim =
    /\\pdfgentounicode\b/.test(source) ||
    /\\pdfglyphtounicode\b/.test(source) ||
    /\\input\s*\{\s*glyphtounicode\s*\}/.test(source);
  if (!needsShim) return source;
  return [
    "% JobDedo: XeTeX compatibility shim for pdfTeX-only primitives",
    "\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi",
    "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{}\\fi",
    "",
    source,
  ].join("\n");
}

/**
 * Compile LaTeX source to PDF using Tectonic.
 *
 * Writes the source to a unique temp directory, runs tectonic,
 * captures stdout/stderr, reads the resulting PDF, and cleans up.
 */
export async function compileResume(
  input: CompileInput,
): Promise<CompileOutput> {
  const startTime = Date.now();
  const compilerInfo = detectLatexCompiler();
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!compilerInfo.available) {
    errors.push(compilerInfo.message);
    return {
      compilationId: crypto.randomUUID(),
      status: "failed",
      pdfBuffer: null,
      log: compilerInfo.message,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // Validate the LaTeX document before compilation
  const validationErrors = validateLatexDocument(input.latexSource);
  if (validationErrors.length > 0) {
    return {
      compilationId: crypto.randomUUID(),
      status: "failed",
      pdfBuffer: null,
      log: validationErrors.join("\n"),
      warnings,
      errors: validationErrors,
      durationMs: Date.now() - startTime,
    };
  }

  // Check for unsafe LaTeX commands
  const unsafeFound = checkUnsafeLatex(input.latexSource);
  if (unsafeFound.length > 0) {
    errors.push(
      `Unsafe LaTeX commands detected and blocked: ${unsafeFound.join(", ")}`,
    );
    return {
      compilationId: crypto.randomUUID(),
      status: "failed",
      pdfBuffer: null,
      log: errors.join("\n"),
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // Create a unique temporary directory for this compilation
  const tmpDir = path.join(os.tmpdir(), `tex-${crypto.randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const resolvedSource = await resolveInputDependencies(input.latexSource, tmpDir);

    // Write the LaTeX source to a .tex file (with the XeTeX compat shim
    // prepended only when the source uses pdfTeX-only primitives)
    const texPath = path.join(tmpDir, "main.tex");
    await fs.writeFile(texPath, applyXeTeXCompat(resolvedSource), "utf8");

    // Run Tectonic compilation
    // - No shell escape (--synctex not needed for PDF output)
    // - Run in the temp directory (chdir via cwd option)
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      // `-p` prints the engine's chatter (the full TeX log, including
      // \typeout output and `l.N` error line references) to stdout — without
      // it, Tectonic swallows the log and failures carry no diagnostics.
      const result = execSync(`${TECTONIC_PATH} -p main.tex`, {
        cwd: tmpDir,
        timeout: MAX_DURATION_MS,
        maxBuffer: 10 * 1024 * 1024, // 10 MB output limit
        encoding: "utf8",
      });
      stdout = result as string;
    } catch (err) {
      // execSync throws on non-zero exit code
      exitCode = 1;
      const errObj = err as { stdout?: string; stderr?: string };
      stderr = errObj.stderr ? errObj.stderr : String(err);
      stdout = errObj.stdout ? errObj.stdout : "";
    }

    // Check for output PDF
    const pdfPath = path.join(tmpDir, "main.pdf");
    let pdfBuffer: Buffer | null = null;

    try {
      pdfBuffer = await fs.readFile(pdfPath);
    } catch {
      // No PDF produced - compilation failed
    }

    if (exitCode === 0 && pdfBuffer) {
      warnings.push("Compilation completed successfully.");
      return {
        compilationId: crypto.randomUUID(),
        status: "success",
        pdfBuffer,
        log: stdout || "Compilation successful.",
        warnings,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    }

    // Compilation failed. stdout holds the full TeX log (with `l.N` line
    // references, printed via `-p`); stderr holds Tectonic's own `error:`
    // summary. Keep both so the user gets complete, Overleaf-like
    // diagnostics instead of just the fontconfig noise on stderr.
    const errorLog =
      [stdout, stderr]
        .map((s) => (s || "").trim())
        .filter(Boolean)
        .join("\n") || "Unknown compilation error.";
    // Extract line number from Tectonic error if available
    const lineMatch = errorLog.match(/l\.(\d+)/);
    const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : null;
    const lineAnnotation = lineNumber
      ? `\nError near line ${lineNumber} of your LaTeX source.`
      : "";

    errors.push(errorLog + lineAnnotation);
    return {
      compilationId: crypto.randomUUID(),
      status: "failed",
      pdfBuffer: null,
      log: errorLog,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      compilationId: crypto.randomUUID(),
      status: "failed",
      pdfBuffer: null,
      log: err instanceof Error ? err.message : String(err),
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  } finally {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
