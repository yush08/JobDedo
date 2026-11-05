/**
 * Server-only, in-memory sliding-window rate limiter.
 *
 * Notes:
 * - Suitable for a single-instance deployment (local `next start`, a single
 *   serverless region warm instance). On serverless it degrades gracefully:
 *   limits become per-instance and permissive rather than incorrect.
 * - No secrets are stored here; keys are opaque bucket ids (ip + route).
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) {
    // Drop expired buckets to bound memory.
    for (const [k, b] of buckets) {
      b.hits = b.hits.filter((t) => now - t < windowMs);
      if (b.hits.length === 0) buckets.delete(k);
    }
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: limit - bucket.hits.length,
    retryAfterSeconds: 0,
  };
}

/** Best-effort client address for rate-limit keying. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `${scope}:${ip}`;
}
