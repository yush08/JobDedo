import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { getDataStore } from "@/lib/db";
import { fail, ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";
import { discoveryRunSchema } from "@/lib/validation/schemas";
import { discoveryReady, listDiscoveryAdapters } from "@/features/discovery/service";
import { executeDiscoveryRun } from "@/features/discovery/pipeline";
import { releaseRun, startDiscoveryRun } from "@/features/discovery/run";

/**
 * POST /api/v1/discovery/run — validate, lock, and start a bounded run.
 *
 * The response returns as soon as the run row exists (201 + run id); the
 * actual fetching happens in Next's `after()` callback, so the request is
 * never held open for the duration of the run. The same entry point can be
 * called from GitHub Actions later — it is a plain async function over the
 * DataStore, not something that requires an HTTP request.
 *
 * Error contract:
 *   400 VALIDATION_ERROR   body failed schema validation
 *   409 RUN_IN_PROGRESS    another run is active (process or persisted row)
 *   429 RATE_LIMITED       too many run requests
 *   503 NO_ADAPTERS        no source enabled / none requested
 *   503 NO_TARGETS         enabled sources have no configured targets
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "discovery:run", 10, 60_000);
  if (limited) return limited;

  const body = await readJson(request, discoveryRunSchema);
  if (body instanceof NextResponse) return body;

  const store = getDataStore();
  const outcome = await startDiscoveryRun({
    store,
    trigger: body.trigger,
    ...(body.sources ? { sources: body.sources } : {}),
  });

  if (outcome.status === "unavailable") {
    return fail(outcome.code, outcome.message, 503, {
      adapters: listDiscoveryAdapters(),
    });
  }

  if (outcome.status === "conflict") {
    return fail(
      "RUN_IN_PROGRESS",
      `A discovery run is already in progress (${outcome.run?.id ?? "unknown"}). Wait for it to finish, then retry.`,
      409,
      { run: outcome.run },
    );
  }

  const { run, adapters, config } = outcome;
  after(async () => {
    try {
      await executeDiscoveryRun({ runId: run.id, store, adapters, config });
    } catch (error) {
      // executeDiscoveryRun persists its own failure state; this only covers
      // an error thrown before/around it (e.g. the store being unavailable).
      await store
        .updateDiscoveryRun(run.id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          finished_at: new Date().toISOString(),
        })
        .catch(() => undefined);
    } finally {
      releaseRun();
    }
  });

  return ok(
    {
      run,
      note: "Discovery started in the background. Poll GET /api/v1/discovery/status for progress.",
    },
    201,
  );
});

/** GET /api/v1/discovery/run — adapter status; never claims a running job. */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const [latest, adapters] = await Promise.all([
    db.getLatestDiscoveryRun(),
    Promise.resolve(listDiscoveryAdapters()),
  ]);
  return ok({
    adapters,
    ready: discoveryReady(),
    latest_run: latest,
  });
});
