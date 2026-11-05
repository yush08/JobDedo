import { withErrorHandling, ok } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/projects — List all resume projects.
 */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const projects = await db.listResumeProjects();
  return ok({ projects });
});

/**
 * POST /api/v1/resumes/projects — Create a new resume project.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const { name, template_id = "minimal" } = await request.json();

  if (!name || name.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "Project name is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const profile = await db.ensureProfile();

  const project = await db.createResumeProject({
    profile_id: profile.id,
    name: name.trim(),
    original_resume_id: null,
    active_version_id: null,
    template_id,
  });

  return ok({ project }, 201);
});