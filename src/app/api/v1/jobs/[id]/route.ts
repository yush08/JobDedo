import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { fail, notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";

/**
 * GET /api/v1/jobs/[id] — a single job with company, source, verification
 * record and verification history for the Sources & Verification panel.
 */
export const GET = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const db = getDataStore();
    const job = await db.getJobFull(id);
    if (!job) return notFound(`Job ${id} not found`);

    const [verification, history, match] = await Promise.all([
      db.getVerification(id),
      db.listVerificationHistory(id),
      db.getLatestMatch(id),
    ]);

    return ok({ job, verification, history, match });
  },
);

/** POST /api/v1/jobs/[id] is not a supported operation. */
export const POST = withErrorHandling(async () =>
  fail("METHOD_NOT_ALLOWED", "Use /save, /match or /verify sub-routes", 405),
);

/** Guard used by mutation sub-routes; exported for reuse. */
export function jobGuard(request: Request) {
  return guard(request, "jobs:mutate", 60, 60_000);
}
