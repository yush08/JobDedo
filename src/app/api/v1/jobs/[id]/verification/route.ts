import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { interpretConfidence } from "@/features/verification/confidence";

/** GET /api/v1/jobs/[id]/verification — current verification record. */
export const GET = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const db = getDataStore();
    const job = await db.getJobFull(id);
    if (!job) return notFound(`Job ${id} not found`);

    const verification = await db.getVerification(id);
    return ok({
      job_id: id,
      verification,
      interpretation: verification
        ? interpretConfidence(verification.confidence_score)
        : interpretConfidence(0),
      job_headline: {
        verification_status: job.verification_status,
        verification_confidence: job.verification_confidence,
        first_discovered_at: job.first_discovered_at,
        last_checked_at: job.last_checked_at,
        last_verified_at: job.last_verified_at,
        job_status: job.job_status,
        closing_date: job.closing_date,
      },
    });
  },
);
