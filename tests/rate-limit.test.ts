import { describe, expect, it } from "vitest";

import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/**
 * Sliding-window limiter for /api/v1 routes. Buckets are module-global, so
 * every test uses its own key to stay order-independent.
 */

describe("rateLimit", () => {
  it("allows up to the limit, then denies", () => {
    const t0 = 1_000_000;
    const key = "test-allow:1";

    expect(rateLimit(key, 3, 10_000, t0)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(rateLimit(key, 3, 10_000, t0 + 10)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(rateLimit(key, 3, 10_000, t0 + 20)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });

    const denied = rateLimit(key, 3, 10_000, t0 + 30);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("reports a retry-after that shrinks as the window drains", () => {
    const t0 = 2_000_000;
    const key = "test-retry:1";

    rateLimit(key, 1, 10_000, t0);
    const early = rateLimit(key, 1, 10_000, t0 + 1_000);
    expect(early.allowed).toBe(false);
    expect(early.retryAfterSeconds).toBe(9); // (t0+10s) - (t0+1s)

    const late = rateLimit(key, 1, 10_000, t0 + 9_500);
    expect(late.allowed).toBe(false);
    expect(late.retryAfterSeconds).toBe(1); // sub-second remainder still rounds up
  });

  it("frees the bucket once the window has fully elapsed", () => {
    const t0 = 3_000_000;
    const key = "test-window:1";

    rateLimit(key, 1, 10_000, t0);
    expect(rateLimit(key, 1, 10_000, t0 + 9_999).allowed).toBe(false);
    // 10s after the hit the old hit is expired, so the window slides.
    expect(rateLimit(key, 1, 10_000, t0 + 10_000).allowed).toBe(true);
  });

  it("keeps buckets independent per key", () => {
    const t0 = 4_000_000;
    rateLimit("test-a:1", 1, 10_000, t0);
    expect(rateLimit("test-b:1", 1, 10_000, t0).allowed).toBe(true);
    expect(rateLimit("test-a:1", 1, 10_000, t0).allowed).toBe(false);
  });

  it("counts hits against the current limit value passed in", () => {
    const t0 = 5_000_000;
    const key = "test-limit:1";
    expect(rateLimit(key, 5, 10_000, t0).remaining).toBe(4);
    // Same bucket, tighter limit on the next call: already at/above it.
    expect(rateLimit(key, 1, 10_000, t0 + 1).allowed).toBe(false);
  });

  it("never returns a negative remaining", () => {
    const t0 = 6_000_000;
    const key = "test-negative:1";
    for (let i = 0; i < 5; i++) rateLimit(key, 2, 10_000, t0 + i);
    const result = rateLimit(key, 2, 10_000, t0 + 9);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
    expect(result.allowed).toBe(false);
  });
});

describe("clientKey", () => {
  it("uses the first x-forwarded-for hop when present", () => {
    const request = new Request("http://localhost/api/v1/jobs", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientKey(request, "jobs")).toBe("jobs:203.0.113.9");
  });

  it("falls back to a shared local key when no forwarding header exists", () => {
    const request = new Request("http://localhost/api/v1/jobs");
    expect(clientKey(request, "jobs")).toBe("jobs:local");
  });

  it("scopes keys so routes cannot starve each other", () => {
    const request = new Request("http://localhost/api/v1/jobs");
    expect(clientKey(request, "jobs")).not.toBe(clientKey(request, "discovery"));
  });
});
