import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/outreach/recruiters
 *
 * Returns recruiter contacts stored with public source URLs as evidence.
 * Used by the Cold Email Assistant client component.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const db = getDataStore();

  try {
    const recruiters = await db.listRecruiters();
    return new Response(
      JSON.stringify({ recruiters }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error fetching recruiters:", err);
    return new Response(
      JSON.stringify({ error: "Failed to fetch recruiter contacts" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});