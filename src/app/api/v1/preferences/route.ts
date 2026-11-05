import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { preferencesPayloadSchema } from "@/lib/validation/schemas";
import { ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";

/** GET /api/v1/preferences — role preferences + job preferences. */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const bundle = await db.getPreferences();
  return ok(bundle);
});

/** PUT /api/v1/preferences — validate and persist preferences. */
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "preferences:put", 30, 60_000);
  if (limited) return limited;

  const body = await readJson(request, preferencesPayloadSchema);
  if (body instanceof Response) return body;

  const db = getDataStore();
  await db.ensureProfile();
  const saved = await db.savePreferences({
    roles: body.roles.map((r, i) => ({
      id: "",
      profile_id: "",
      role: r.role,
      is_custom: r.is_custom,
      priority: i,
    })),
    preferences: {
      ...body.preferences,
      id: "",
      profile_id: "",
      updated_at: new Date().toISOString(),
    },
  });
  return ok(saved);
});
