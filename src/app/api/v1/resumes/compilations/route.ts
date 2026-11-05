import { withErrorHandling, ok } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { compileResume } from "@/lib/resume/pdf-compiler";

/**
 * GET /api/v1/resumes/compilations — List compilations for a project.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "Project ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const compilations = await db.listResumeCompilations(projectId);
  return ok({ compilations });
});

/**
 * POST /api/v1/resumes/compilations — Compile a resume source version.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const { project_id, source_version_id } = await request.json();

  if (!project_id || !source_version_id) {
    return new Response(
      JSON.stringify({ error: "Project ID and source version ID are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();

  // Get the source version
  const version = await db.getResumeSourceVersion(source_version_id);
  if (!version) {
    return new Response(
      JSON.stringify({ error: "Source version not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Get the project for template info
  const project = await db.getResumeProject(project_id);
  if (!project) {
    return new Response(
      JSON.stringify({ error: "Project not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Create compilation record
  const compilation = await db.createResumeCompilation({
    project_id,
    source_version_id,
    status: "pending",
    pdf_artifact_id: null,
    log: "Compilation started...",
    warnings: [],
    errors: [],
  });

  try {
    // Compile
    const result = await compileResume({
      projectId: project_id,
      sourceVersionId: source_version_id,
      latexSource: version.latex_source,
      structuredContent: version.structured_content,
      templateId: version.template_id,
    });

    // Update compilation record
    await db.updateResumeCompilation(compilation.id, {
      status: result.status,
      pdf_artifact_id: result.pdfBuffer ? undefined : null,
      log: result.log,
      warnings: result.warnings,
      errors: result.errors,
    });

    // Create artifact if successful
    if (result.status === "success" && result.pdfBuffer) {
      const artifact = await db.storeResumeFile(
        {
          project_id,
          compilation_id: compilation.id,
          file_name: `${project.name.replace(/\s+/g, "_")}_v${version.version_number}.pdf`,
          mime_type: "application/pdf",
          storage_reference: `resume_${compilation.id}.pdf`,
          content_hash: "",
        },
        result.pdfBuffer,
      );

      // Update compilation with artifact ID
      await db.updateResumeCompilation(compilation.id, {
        pdf_artifact_id: artifact.id,
      });

      return ok({
        compilation: { ...compilation, status: result.status, pdf_artifact_id: artifact.id },
        log: result.log,
        warnings: result.warnings,
        errors: result.errors,
        durationMs: result.durationMs,
        hasPdf: true,
      });
    }

    return ok({
      compilation: { ...compilation, status: result.status },
      log: result.log,
      warnings: result.warnings,
      errors: result.errors,
      durationMs: result.durationMs,
      hasPdf: false,
    });
  } catch (err) {
    await db.updateResumeCompilation(compilation.id, {
      status: "failed",
      log: `Compilation failed: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    });

    return ok({
      compilation: { ...compilation, status: "failed" },
      log: err instanceof Error ? err.message : String(err),
      warnings: [],
      errors: [err instanceof Error ? err.message : String(err)],
      durationMs: 0,
      hasPdf: false,
    });
  }
});