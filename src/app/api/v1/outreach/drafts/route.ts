import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/outreach/drafts
 *
 * Returns all saved cold email drafts.
 * Used by the Cold Email Assistant client component.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const db = getDataStore();

  try {
    const drafts = await db.listEmailDrafts();
    return new Response(
      JSON.stringify({ drafts }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error fetching drafts:", err);
    return new Response(
      JSON.stringify({ error: "Failed to fetch drafts" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});