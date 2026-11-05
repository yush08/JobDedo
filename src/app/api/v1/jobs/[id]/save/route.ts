import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { saveJobSchema } from "@/lib/validation/schemas";
import { fail, notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";

/**
 * POST /api/v1/jobs/[id]/save — toggle the saved flag.
 * Body: { saved?: boolean } (defaults to "toggle").
 */
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const limited = guard(request, "jobs:save", 120, 60_000);
    if (limited) return limited;

    const { id } = await params;
    const db = getDataStore();
    const job = await db.getJobFull(id);
    if (!job) return notFound(`Job ${id} not found`);

    const body = await readJson(request, saveJobSchema);
    if (body instanceof Response) return body;

    const target = body.saved ?? !job.saved;
    const saved = await db.setJobSaved(id, target);
    return ok({ job_id: id, saved });
  },
);
