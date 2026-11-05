import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { fail } from "./responses";

/**
 * Rate-limit a mutating /api/v1 route.
 * Returns `null` when the request may proceed, otherwise a 429 response.
 */
export function guard(
  request: Request,
  scope: string,
  limit = 60,
  windowMs = 60_000,
): NextResponse | null {
  const result = rateLimit(clientKey(request, scope), limit, windowMs);
  if (result.allowed) return null;
  return fail(
    "RATE_LIMITED",
    `Too many requests. Retry in ${result.retryAfterSeconds}s.`,
    429,
    { retryAfterSeconds: result.retryAfterSeconds },
  );
}

/** Parse + validate a JSON body, returning a 400 envelope on failure. */
export async function readJson<T>(
  request: Request,
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: unknown } },
): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim().length > 0 ? JSON.parse(text) : {};
  } catch {
    return fail("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Request body failed validation", 400, parsed.error);
  }
  return parsed.data;
}
