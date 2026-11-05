import { ok, withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/export — download every stored row as JSON (Settings page).
 * The response is a single JSON document containing all tables/collections.
 */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const data = await db.exportAll();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), data }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="jobdedo-export-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
});

export const POST = withErrorHandling(async () => ok({ hint: "Use GET /api/v1/export" }));
