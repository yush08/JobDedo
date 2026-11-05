import { withErrorHandling, ok } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/compilations/[id] — Get a compilation.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Compilation ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const compilation = await db.getResumeCompilation(id);

  if (!compilation) {
    return new Response(
      JSON.stringify({ error: "Compilation not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return ok({ compilation });
});