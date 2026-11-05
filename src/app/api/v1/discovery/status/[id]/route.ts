import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { discoveryReady, listDiscoveryAdapters } from "@/features/discovery/service";

/**
 * GET /api/v1/discovery/status/[id] — one persisted discovery run.
 *
 * Returns the full row, including `checkpoint.sources` (per-source success,
 * failure reasons, counts) so a caller can show exactly which boards worked
 * and which did not.
 */
export const GET = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const db = getDataStore();
    const run = await db.getDiscoveryRun(id);
    if (!run) return notFound(`Discovery run ${id} not found`);
    return ok({
      run,
      adapters: listDiscoveryAdapters(),
      ready: discoveryReady(),
    });
  },
);
