import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";

/**
 * GET /api/v1/resumes/artifacts/[id] — Download a compiled PDF artifact.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Artifact ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const db = getDataStore();
  const artifact = await db.getResumeFile(id);

  if (!artifact) {
    return new Response(
      JSON.stringify({ error: "Artifact not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(artifact.fileBuffer as unknown as Blob, {
    status: 200,
    headers: {
      "Content-Type": artifact.mimeType,
      // Use "inline" so the iframe displays the PDF rather than triggering a download.
      // Omitting Content-Disposition also lets the browser decide (usually inline for PDFs).
      // "Content-Disposition": `inline; filename="${artifact.fileName}"`,
      "Content-Length": String(artifact.fileBuffer.length),
    },
  });
});