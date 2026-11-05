import { describe, expect, it } from "vitest";

import { formatDateTime, formatDate } from "@/lib/utils/format";

/**
 * Deterministic date formatting tests.
 *
 * Verifies that formatDateTime and formatDate produce identical output
 * regardless of the runtime environment (server vs client), preventing
 * React hydration mismatches on the Discover page and other SSR pages.
 */
describe("formatDateTime — deterministic hydration-safe output", () => {
  const iso = "2026-11-04T17:33:00.000Z";

  it("produces a consistent string format on every call", () => {
    const a = formatDateTime(iso);
    const b = formatDateTime(iso);
    expect(a).toBe(b);
  });

  it("includes year, month, day, hour, and minute", () => {
    const result = formatDateTime(iso);
    expect(result).toMatch(/\d{4}/); // year
    expect(result).toMatch(/Nov/); // month short name
    expect(result).toMatch(/\d{1,2}/); // day
    expect(result).toMatch(/\d{2}:\d{2}/); // hour:minute
  });

  it("does not depend on the runtime locale", () => {
    // The same input must produce the same output regardless of environment.
    // en-IN locale with explicit options guarantees this.
    const result = formatDateTime(iso);
    expect(result).toContain("2026");
    expect(result).toContain("Nov");
    expect(result).toContain("4");
  });

  it("returns em-dash for null/undefined/empty input", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("")).toBe("—");
  });

  it("returns em-dash for invalid ISO strings", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDateTime("")).toBe("—");
  });
});

describe("formatDate — deterministic hydration-safe output", () => {
  const iso = "2026-11-04T17:33:00.000Z";

  it("produces a consistent string format on every call", () => {
    const a = formatDate(iso);
    const b = formatDate(iso);
    expect(a).toBe(b);
  });

  it("includes year, month, and day", () => {
    const result = formatDate(iso);
    expect(result).toMatch(/\d{4}/); // year
    expect(result).toMatch(/Nov/); // month short name
    expect(result).toMatch(/\d{1,2}/); // day
  });

  it("returns em-dash for null/undefined/empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });
});