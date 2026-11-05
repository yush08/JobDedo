import { withErrorHandling, ok } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * PUT /api/v1/resumes/projects/[id]/versions/[versionId] — Save LaTeX source to a version.
 */
export const PUT = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; versionId: string }> },
  ) => {
    const resolvedParams = await params;
    const { id: projectId, versionId } = resolvedParams;
    const { latex_source, structured_content } = await request.json();

    if (!projectId || !versionId) {
      return new Response(
        JSON.stringify({ error: "Project ID and version ID are required" }),
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

    const version = await db.updateResumeSourceVersion(versionId, {
      latex_source,
      structured_content: structured_content ?? null,
    });

    if (!version || version.project_id !== projectId) {
      return new Response(
        JSON.stringify({ error: "Version not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return ok({ version });
  },
);

/**
 * DELETE /api/v1/resumes/projects/[id]/versions/[versionId] — Delete a source version.
 * Refuses to delete the only version; reassigns the active version if needed.
 */
export const DELETE = withErrorHandling(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string; versionId: string }> },
  ) => {
    const resolvedParams = await params;
    const { id: projectId, versionId } = resolvedParams;

    const db = getDataStore();
    const project = await db.getResumeProject(projectId);
    if (!project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const versions = await db.listResumeSourceVersions(projectId);
    const target = versions.find((v) => v.id === versionId);
    if (!target) {
      return new Response(
        JSON.stringify({ error: "Version not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (versions.length <= 1) {
      return new Response(
        JSON.stringify({ error: "Cannot delete the only version of a project" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const deleted = await db.deleteResumeSourceVersion(versionId);
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "Failed to delete version" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // If the deleted version was active, safely select another one.
    let updatedProject = project;
    if (project.active_version_id === versionId) {
      const remaining = versions.filter((v) => v.id !== versionId);
      const next = remaining[0];
      const patched = await db.updateResumeProject(projectId, {
        active_version_id: next ? next.id : null,
      });
      if (patched) updatedProject = patched;
    }

    return ok({ deleted: true, project: updatedProject });
  },
);
