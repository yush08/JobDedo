import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { createApplicationSchema } from "@/lib/validation/schemas";
import { fail, ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";
import type { ApplicationStage } from "@/types";

/** Stages that imply an application was actually submitted. */
const POST_SUBMISSION_STAGES: ApplicationStage[] = [
  "applied",
  "recruiter_contacted",
  "interview",
  "offer",
  "rejected",
];

/** GET /api/v1/applications — all tracked applications with status history. */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const applications = await db.listApplications();
  return ok({ items: applications, total: applications.length });
});

/**
 * POST /api/v1/applications — track an application.
 * Creating one directly in a post-submission stage requires
 * `confirmed_applied: true` (explicit user confirmation), otherwise 422.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "applications:post", 60, 60_000);
  if (limited) return limited;

  const body = await readJson(request, createApplicationSchema);
  if (body instanceof Response) return body;

  if (POST_SUBMISSION_STAGES.includes(body.stage) && !body.confirmed_applied) {
    return fail(
      "NEED_CONFIRMATION",
      "Marking an application as submitted requires explicit confirmation that you actually submitted it.",
      422,
      { stage: body.stage },
    );
  }

  const db = getDataStore();
  await db.ensureProfile();

  const existingJob = body.job_id ? await db.getJobFull(body.job_id) : null;
  const verificationStatusAtApply = existingJob?.verification_status ?? null;
  const matchScore = existingJob?.match_score ?? null;

  const submitted = POST_SUBMISSION_STAGES.includes(body.stage);
  const application = await db.createApplication({
    job_id: body.job_id ?? null,
    company_name: body.company_name,
    job_title: body.job_title,
    original_url: body.original_url,
    application_url: body.application_url,
    match_score: matchScore,
    verification_status_at_apply: verificationStatusAtApply,
    resume_version_id: body.resume_version_id ?? null,
    email_draft_id: body.email_draft_id ?? null,
    applied_at: body.applied_at ?? (submitted ? new Date().toISOString() : null),
    stage: body.stage,
    notes: body.notes,
    follow_up_at: body.follow_up_at ?? null,
    interview_at: body.interview_at ?? null,
    interview_details: body.interview_details,
  });

  return ok({ application }, 201);
});
