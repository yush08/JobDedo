import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { DRAFT_TYPES, isDraftType } from "@/lib/outreach/draft-generator";
import { repairKnownMojibake } from "@/lib/utils/encoding";
import type { EmailDraft } from "@/types";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Repair drafts that were stored with CP437 mojibake in their subject/body
 * (see src/lib/utils/encoding.ts). Only exact corrupted substrings are
 * rewritten; valid user text passes through untouched.
 */
function repairDraft(draft: EmailDraft): EmailDraft {
  const subject = repairKnownMojibake(draft.subject);
  const body = repairKnownMojibake(draft.body);
  if (subject === draft.subject && body === draft.body) return draft;
  return { ...draft, subject, body };
}

function newestFirst(drafts: EmailDraft[]): EmailDraft[] {
  return [...drafts].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

interface SaveDraftRequest {
  id?: unknown;
  subject?: unknown;
  body?: unknown;
  draftType?: unknown;
  recruiterId?: unknown;
}

/**
 * GET /api/v1/outreach/drafts
 *
 * Returns all saved cold email drafts (mojibake-repaired, newest first).
 * Used by the Cold Email Assistant client component.
 */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();

  try {
    const drafts = await db.listEmailDrafts();
    return new Response(
      JSON.stringify({ drafts: newestFirst(drafts.map(repairDraft)) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error fetching drafts:", err);
    return jsonError("Failed to fetch drafts", 500);
  }
});

/**
 * POST /api/v1/outreach/drafts
 *
 * Persist a draft. Without `id` a new draft is created; with `id` the
 * existing draft is updated in place (404 when it no longer exists), so
 * saving an edited draft never creates accidental duplicates.
 *
 * The subject/body are stored exactly as provided (UTF-8, line breaks and
 * Unicode punctuation preserved). Status stays "draft" — saving or copying
 * never marks a draft as sent.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonError("Expected application/json", 400);
  }

  const body: unknown = await request.json();
  const data: SaveDraftRequest =
    typeof body === "object" && body !== null ? (body as SaveDraftRequest) : {};

  const id = asText(data.id);
  const subject = asText(data.subject).trim();
  const emailBody = asText(data.body).trim();
  const draftType = asText(data.draftType);
  const recruiterId = asText(data.recruiterId);

  if (!subject) {
    return jsonError("subject is required to save a draft.", 400);
  }
  if (!emailBody) {
    return jsonError("body is required to save a draft.", 400);
  }
  if (!isDraftType(draftType)) {
    return jsonError(
      `draftType must be one of: ${DRAFT_TYPES.join(", ")}`,
      400,
    );
  }

  const db = getDataStore();

  let recruiterIdValue: string | null = null;
  if (recruiterId) {
    const recruiters = await db.listRecruiters();
    if (!recruiters.some((r) => r.id === recruiterId)) {
      return jsonError("Recruiter not found", 404);
    }
    recruiterIdValue = recruiterId;
  }

  if (id) {
    const existing = await db.listEmailDrafts();
    if (!existing.some((draft) => draft.id === id)) {
      return jsonError("Draft not found", 404);
    }
    const updated = await db.updateEmailDraft(id, {
      subject,
      body: emailBody,
      draft_type: draftType,
      recruiter_id: recruiterIdValue,
    });
    if (!updated) {
      return jsonError("Draft not found", 404);
    }
    return new Response(
      JSON.stringify({ draft: repairDraft(updated) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const profile = await db.ensureProfile();
  const created = await db.createEmailDraft({
    profile_id: profile.id,
    job_id: null,
    recruiter_id: recruiterIdValue,
    draft_type: draftType,
    subject,
    body: emailBody,
    status: "draft",
  });

  return new Response(
    JSON.stringify({ draft: repairDraft(created) }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
});
