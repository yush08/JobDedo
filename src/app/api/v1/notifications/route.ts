import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/db";
import { ok, withErrorHandling } from "@/lib/api/responses";
import { guard } from "@/lib/api/guards";

/** GET /api/v1/notifications — stored notifications (real events only). */
export const GET = withErrorHandling(async () => {
  const db = getDataStore();
  const items = await db.listNotifications();
  return ok({
    items,
    unread: items.filter((n) => !n.read_at).length,
  });
});

/** PATCH /api/v1/notifications — mark every unread notification as read. */
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const limited = guard(request, "notifications:patch", 60, 60_000);
  if (limited) return limited;

  const db = getDataStore();
  await db.markNotificationsRead();
  const items = await db.listNotifications();
  return ok({ items, unread: 0 });
});
