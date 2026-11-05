import { withErrorHandling } from "@/lib/api/responses";
import { NextResponse } from "next/server";

/**
 * POST /api/v1/outreach/send — Send outreach email (M6).
 *
 * Contract when implemented:
 * - Requires explicit approval for each email — NEVER automatic or bulk sending
 * - Gmail OAuth is optional; if implemented, configured securely
 * - Never sends automatically; never performs bulk outreach without explicit approval
 * - Each send request creates exactly one email
 * - Returns a confirmation that the email has been queued for sending
 * - The actual email sending is handled by the frontend/Gmail integration after user approval
 * - Contact must preserve the public source URL where it was found
 * - Never create fake recruiter contacts
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("multipart/form-data") && !contentType.startsWith("application/json")) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data or application/json" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const formData = await request.formData();
  const draftId = formData.get("draft_id") as string | null;
  const explicitApproval = formData.get("explicit_approval") as string | null;
  const sendMethod = formData.get("send_method") as string | null; // "gmail_oauth", "manual", etc.

  // CRITICAL: Explicit approval is REQUIRED for each email
  if (!explicitApproval || explicitApproval !== "yes") {
    return new Response(
      JSON.stringify({
        error: "Explicit approval required for each email send. Set explicit_approval=yes to confirm.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!draftId) {
    return new Response(
      JSON.stringify({ error: "No draft ID provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // In a full implementation, we would look up the draft and send the email
  // After user approval. For now, we return a confirmation that the request
  // was approved and the email is queued.

  // CRITICAL: Never send automatically or in bulk.
  // Only one email per send request, after explicit user approval.

  const confirmation = {
    success: true,
    message: "Email send request approved. Email will be sent after Gmail OAuth authorization (or handled by frontend).",
    draftId,
    sentAt: new Date().toISOString(),
    // The actual transmission is handled by the frontend after this approval.
    // This endpoint only validates the approval.
  };

  return new Response(
    JSON.stringify(confirmation),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});