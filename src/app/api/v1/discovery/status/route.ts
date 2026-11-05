import { getDataStore } from "@/lib/db";
import { notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { discoveryReady, listDiscoveryAdapters } from "@/features/discovery/service";
import { getActiveRunId } from "@/features/discovery/run";

/**
 * GET /api/v1/discovery/status — latest run + progress + run history.
 *
 * Everything reported here was persisted by the pipeline: `checkpoint.sources`
 * carries per-source counts and failures, `checkpoint.phase` the current stage,
 * and `recent_runs` the run history (newest first). Nothing is computed from
 * what a run *intended* to do.
 */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const [latest, recent] = await Promise.all([
    db.getLatestDiscoveryRun(),
    db.listDiscoveryRuns(10),
  ]);

  const active =
    getActiveRunId() !== null ||
    latest?.status === "pending" ||
    latest?.status === "running";

  return ok({
    latest_run: latest,
    has_run: latest !== null,
    active,
    adapters: listDiscoveryAdapters(),
    ready: discoveryReady(),
    recent_runs: recent,
  });
});

/** GET is the only method supported on this route. */
export const POST = withErrorHandling(async () =>
  notFound("Use POST /api/v1/discovery/run to start a run"),
);
