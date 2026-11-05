import { NextResponse, connection } from "next/server";
import type { ApiErrorBody } from "@/types";

/** Consistent success envelope for every /api/v1 route. */
export function ok<T>(data: T, init?: number | ResponseInit): NextResponse {
  const body = { ok: true as const, data };
  if (typeof init === "number") return NextResponse.json(body, { status: init });
  return NextResponse.json(body, init);
}

/** Consistent error envelope for every /api/v1 route. */
export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): NextResponse {
  const body: ApiErrorBody = { error: { code, message, details } };
  return NextResponse.json(body, { status });
}

export function notFound(message = "Resource not found") {
  return fail("NOT_FOUND", message, 404);
}

export function methodNotAllowed(method: string) {
  return fail("METHOD_NOT_ALLOWED", `Method ${method} is not allowed`, 405);
}

export function notImplemented(feature: string, milestone: string) {
  return fail(
    "NOT_IMPLEMENTED",
    `${feature} is not implemented yet. It ships in ${milestone}.`,
    501,
  );
}

export class HttpError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Wrap a route handler with uniform error handling. */
export function withErrorHandling<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    // API responses are inherently per-request (rate limiting, live DB reads,
    // user-controlled data): opt every /api/v1 route out of build-time
    // prerendering. During a build this bails out; at request time it is a
    // no-op. Must run OUTSIDE the catch below so the bail-out propagates.
    await connection();
    try {
      return await handler(...args);
    } catch (err) {
      // Next.js control-flow errors (prerender bail-out, redirects, notFound)
      // carry a NEXT_* digest and must reach the framework untouched —
      // never convert them into a 500 response.
      const digest = (err as { digest?: unknown }).digest;
      if (
        err instanceof Error &&
        typeof digest === "string" &&
        digest.startsWith("NEXT_")
      ) {
        throw err;
      }
      if (err instanceof HttpError) {
        return fail(err.code, err.message, err.status, err.details);
      }
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error("[api] unhandled error:", err);
      return fail("INTERNAL_ERROR", message, 500);
    }
  };
}
