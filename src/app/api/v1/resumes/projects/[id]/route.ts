import { withErrorHandling, ok } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/projects/[id] — Get a resume project.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Project ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const project = await db.getResumeProject(id);

  if (!project) {
    return new Response(
      JSON.stringify({ error: "Project not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return ok({ project });
});

/**
 * PUT /api/v1/resumes/projects/[id] — Update a resume project.
 */
export const PUT = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const { name, active_version_id, template_id } = await request.json();

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Project ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const project = await db.updateResumeProject(id, {
    name,
    active_version_id,
    template_id,
  });

  if (!project) {
    return new Response(
      JSON.stringify({ error: "Project not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return ok({ project });
});