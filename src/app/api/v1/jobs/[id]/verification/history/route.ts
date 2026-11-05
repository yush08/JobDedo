import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { notFound, ok, withErrorHandling } from "@/lib/api/responses";

/** GET /api/v1/jobs/[id]/verification/history — append-only check history. */
export const GET = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const db = getDataStore();
    const job = await db.getJobFull(id);
    if (!job) return notFound(`Job ${id} not found`);

    const history = await db.listVerificationHistory(id);
    return ok({ job_id: id, history, total: history.length });
  },
);
