import { withErrorHandling, ok } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/projects/[id]/versions — List source versions for a project.
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
  const versions = await db.listResumeSourceVersions(projectId);
  return ok({ versions });
});

/**
 * POST /api/v1/resumes/projects/[id]/versions — Create a new source version.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const { latex_source, structured_content, template_id } = await request.json();

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "Project ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const project = await db.getResumeProject(projectId);
  if (!project) {
    return new Response(
      JSON.stringify({ error: "Project not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Determine next version number
  const existing = await db.listResumeSourceVersions(projectId);
  const versionNumber = existing.length + 1;

  const version = await db.createResumeSourceVersion({
    project_id: projectId,
    version_number: versionNumber,
    latex_source: latex_source || "",
    structured_content: structured_content || null,
    template_id: template_id || project.template_id,
  });

  // Set as active version
  await db.updateResumeProject(projectId, {
    active_version_id: version.id,
  });

  return ok({ version }, 201);
});