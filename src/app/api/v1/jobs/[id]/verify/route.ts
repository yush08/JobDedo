import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";
import {
  computeConfidence,
  deriveVerificationStatus,
} from "@/features/verification/confidence";
import { runManualRecheck } from "@/features/verification/recheck";

/**
 * POST /api/v1/jobs/[id]/verify — run a bounded manual recheck.
 *
 * What it does:
 * - performs a real HTTP probe when a source/application URL exists (10s timeout);
 * - records the honest outcome in verification history (appended, never overwritten);
 * - recomputes the confidence score from what is genuinely known;
 * - persists the verification record + headline fields on the job row.
 *
 * It never fabricates evidence, never discovers careers pages (that engine is
 * Milestone 3), and never claims a job is open because a page returned 200.
 */
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const limited = guard(request, "jobs:verify", 20, 60_000);
    if (limited) return limited;

    const { id } = await params;
    const db = getDataStore();
    const job = await db.getJobFull(id);
    if (!job) return notFound(`Job ${id} not found`);

    const current = await db.getVerification(id);
    const outcome = await runManualRecheck(job, current);

    const breakdown = computeConfidence(outcome.verification, {
      job_status: outcome.jobStatus,
    });
    const status = deriveVerificationStatus({
      jobStatus: outcome.jobStatus,
      deadlineStatus: outcome.verification.deadline_status,
      confidence: breakdown.total,
    });

    const verification = {
      ...outcome.verification,
      confidence_breakdown: breakdown,
      confidence_score: breakdown.total,
      job_status: outcome.jobStatus,
      updated_at: new Date().toISOString(),
    };

    await Promise.all([
      db.saveVerification(verification),
      db.appendVerificationHistory(outcome.history),
      db.updateJobVerificationFields(id, {
        verification_status: status,
        verification_confidence: breakdown.total,
        last_checked_at: verification.checked_at,
        last_verified_at:
          status === "VERIFIED" ? verification.checked_at : undefined,
        job_status: outcome.jobStatus,
      }),
    ]);

    return ok({
      verification,
      job_status: outcome.jobStatus,
      verification_status: status,
      history_entry: outcome.history,
      note: "Recheck completed. Historical entries are appended, never overwritten.",
    });
  },
);
