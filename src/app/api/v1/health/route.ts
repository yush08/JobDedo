import { ok, withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { supabaseConfigured } from "@/lib/supabase/server";
import { listDiscoveryAdapters } from "@/features/discovery/service";

/**
 * GET /api/v1/health — driver health + honest capability status.
 * Never reports a capability that does not exist.
 */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const health = await db.health();
  const adapters = listDiscoveryAdapters();

  return ok({
    driver: health.driver,
    database: { ok: health.ok, message: health.message },
    supabase_configured: supabaseConfigured(),
    auth: "not_used (single-user app, no Supabase Auth)",
    discovery: {
      adapters: adapters.map((a) => ({ key: a.key, name: a.name })),
      ready: adapters.some((a) => a.enabled),
    },
    ai: {
      provider: process.env.JOBDEDO_AI_PROVIDER || null,
      configured: Boolean(process.env.JOBDEDO_AI_PROVIDER),
    },
    timestamp: new Date().toISOString(),
  });
});
