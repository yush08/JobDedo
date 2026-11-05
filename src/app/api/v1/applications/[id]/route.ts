import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { patchApplicationSchema } from "@/lib/validation/schemas";
import { notFound, ok, withErrorHandling } from "@/lib/api/responses";
import { guard, readJson } from "@/lib/api/guards";
import type { Application } from "@/types";

/**
 * PATCH /api/v1/applications/[id] — update fields and/or move stage.
 * Stage moves are explicit user actions and are appended to the status
 * history (`application_events`) — history rows are never rewritten.
 */
export const PATCH = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const limited = guard(request, "applications:patch", 120, 60_000);
    if (limited) return limited;

    const { id } = await params;
    const body = await readJson(request, patchApplicationSchema);
    if (body instanceof Response) return body;

    const db = getDataStore();
    const existing = (await db.listApplications()).find((a) => a.id === id);
    if (!existing) return notFound(`Application ${id} not found`);

    const { stage_note, ...patch } = body;
    const nextStage = patch.stage ?? existing.stage;

    const updated = await db.updateApplication(
      id,
      patch as Partial<Application>,
      nextStage !== existing.stage
        ? {
            from: existing.stage,
            to: nextStage,
            note: stage_note || `Stage changed to ${nextStage}`,
          }
        : undefined,
    );
    if (!updated) return notFound(`Application ${id} not found`);

    return ok({ application: updated });
  },
);
