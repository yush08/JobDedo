import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { randomUUID } from "node:crypto";
import {
  DRAFT_TYPES,
  MissingResumeContentError,
  generateDraft,
  isDraftType,
} from "@/lib/outreach/draft-generator";
import type { EmailDraft } from "@/types";

interface DraftRequest {
  resumeVersionId?: unknown;
  jobDescription?: unknown;
  draftType?: unknown;
  recruiterId?: unknown;
  contextNote?: unknown;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/v1/outreach/draft — Generate a cold-email draft (preview only;
 * nothing is persisted until the client saves via POST /outreach/drafts).
 *
 * Contract:
 * - Uses the selected resume version's actual content (parsed payload with
 *   a raw-text section fallback), the supplied job description, the draft
 *   type, and — only when explicitly supplied — a recruiter and a context
 *   note (previous conversation / interview discussion points).
 * - Never invents experience, achievements, metrics, dates, interview
 *   topics, or recruiter/company details.
 * - Returns a 400 with an actionable message when the resume version has
 *   no extractable content instead of fabricating an email.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (
    !contentType.startsWith("multipart/form-data") &&
    !contentType.startsWith("application/json")
  ) {
    return jsonError(
      "Expected multipart/form-data or application/json",
      400,
    );
  }

  let data: DraftRequest;

  if (contentType.startsWith("multipart/form-data")) {
    const formData = await request.formData();
    data = {
      resumeVersionId: formData.get("resume_version_id"),
      jobDescription: formData.get("job_description"),
      draftType: formData.get("draft_type"),
      recruiterId: formData.get("recruiter_id"),
      contextNote: formData.get("context_note"),
    };
  } else {
    const body: unknown = await request.json();
    data =
      typeof body === "object" && body !== null ? (body as DraftRequest) : {};
  }

  const resumeVersionId = asText(data.resumeVersionId);
  const jobDescription = asText(data.jobDescription);
  const draftType = asText(data.draftType);
  const recruiterId = asText(data.recruiterId);
  const contextNote = asText(data.contextNote).trim();

  if (!resumeVersionId) {
    return jsonError("resume_version_id is required", 400);
  }

  if (!jobDescription || jobDescription.trim().length < 20) {
    return jsonError(
      "job_description is required and must be at least 20 characters.",
      400,
    );
  }

  let selectedDraftType: EmailDraft["draft_type"] = "hiring_manager_intro";
  if (draftType) {
    if (!isDraftType(draftType)) {
      return jsonError(
        `draft_type must be one of: ${DRAFT_TYPES.join(", ")}`,
        400,
      );
    }
    selectedDraftType = draftType;
  }

  if (contextNote.length > 4000) {
    return jsonError("context_note must be 4000 characters or fewer.", 400);
  }

  const db = getDataStore();

  const allVersions = await db.listResumeVersions();
  const version = allVersions.find((v) => v.id === resumeVersionId);

  if (!version) {
    return jsonError("Resume source version not found", 404);
  }

  const allResumes = await db.listResumes();
  const resume = allResumes.find((item) => item.id === version.resume_id);

  if (!resume) {
    return jsonError("Associated resume not found", 404);
  }

  // Optional recruiter: used only when explicitly selected by the user.
  let recruiter: { name: string; title: string | null; company: string | null } | null =
    null;
  if (recruiterId) {
    const recruiters = await db.listRecruiters();
    const found = recruiters.find((r) => r.id === recruiterId);
    if (!found) {
      return jsonError("Recruiter not found", 404);
    }
    let companyName: string | null = null;
    if (found.company_id) {
      const companies = await db.listCompanies();
      companyName =
        companies.find((c) => c.id === found.company_id)?.name ?? null;
    }
    recruiter = {
      name: found.name,
      title: found.title || null,
      company: companyName,
    };
  }

  let generated: ReturnType<typeof generateDraft>;
  try {
    generated = generateDraft({
      resumeVersion: version,
      jobDescription,
      draftType: selectedDraftType,
      recruiter,
      contextNote,
    });
  } catch (err) {
    if (err instanceof MissingResumeContentError) {
      return jsonError(err.message, 400);
    }
    throw err;
  }

  const nowIso = new Date().toISOString();
  const draft: Pick<
    EmailDraft,
    "id" | "subject" | "body" | "draft_type" | "status" | "created_at"
  > & {
    recipient: string;
    associatedJob: { title: string; company: string; description: string } | null;
    sourceUrl: { type: string; url: string; note: string } | null;
    contactEvidence: { type: string; url: string; note: string } | null;
    resumeVersionId: string;
    createdAt: string;
    updatedAt: string;
  } = {
    id: randomUUID(),
    recipient: "",
    subject: generated.subject,
    body: generated.body,
    associatedJob: {
      title: generated.roleTitle ?? "the role",
      company: generated.company ?? "",
      description: jobDescription,
    },
    sourceUrl: null,
    contactEvidence: null,
    resumeVersionId,
    draft_type: selectedDraftType,
    status: "draft",
    created_at: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return new Response(
    JSON.stringify({
      draft,
      requiresApproval: true,
      canCopyRecipient: draft.recipient.length > 0,
      canCopySubject: draft.subject.length > 0,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
