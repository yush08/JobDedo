import { describe, expect, it } from "vitest";

import {
  computeConfidence,
  deriveVerificationStatus,
  interpretConfidence,
} from "@/features/verification/confidence";
import { HOUR, NOW } from "./helpers";

type VerificationInput = Parameters<typeof computeConfidence>[0];

/** Everything at its best, so component values are easy to assert in isolation. */
function bestVerification(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    exact_job_status: "confirmed_official",
    application_link_status: "working",
    website_status: "confirmed",
    careers_page_url: "https://northwind.example/careers",
    careers_evidence_url: "https://northwind.example/careers/jobs/1",
    careers_discovery_method: "sitemap",
    deadline_status: "valid",
    job_status: "open",
    checked_at: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  } as VerificationInput;
}

describe("computeConfidence — documented component weights (spec §8)", () => {
  it("awards the full 30/20/20/15/10/5 breakdown when every check passes", () => {
    expect(computeConfidence(bestVerification(), null, NOW)).toEqual({
      official_source: 30,
      application_link: 20,
      active_status: 20,
      company_identity: 15,
      content_consistency: 10,
      freshness: 5,
      total: 100,
    });
  });

  it("awards 0 for every component that was not actually checked", () => {
    const b = computeConfidence(
      bestVerification({
        exact_job_status: "not_checked",
        application_link_status: "not_checked",
        website_status: "not_checked",
        careers_page_url: "",
        careers_evidence_url: "",
        careers_discovery_method: "",
        checked_at: null,
      }),
      null,
      NOW,
    );
    expect(b.official_source).toBe(0);
    expect(b.application_link).toBe(0);
    expect(b.company_identity).toBe(0);
    expect(b.content_consistency).toBe(0);
    expect(b.freshness).toBe(0);
    expect(b.total).toBe(b.active_status);
  });

  it("scores partial evidence proportionally (platform confirm ≠ official confirm)", () => {
    const official = computeConfidence(bestVerification(), null, NOW).official_source;
    const platform = computeConfidence(
      bestVerification({ exact_job_status: "confirmed_platform" }),
      null,
      NOW,
    ).official_source;
    const brokenLink = computeConfidence(
      bestVerification({ application_link_status: "broken" }),
      null,
      NOW,
    ).application_link;
    const redirected = computeConfidence(
      bestVerification({ application_link_status: "redirected" }),
      null,
      NOW,
    ).application_link;

    expect(official).toBe(30);
    expect(platform).toBe(16);
    expect(brokenLink).toBe(0);
    expect(redirected).toBe(14);
  });

  it("treats an open job with no deadline as slightly weaker than a dated one", () => {
    const undated = computeConfidence(
      bestVerification({ deadline_status: "not_specified" }),
      null,
      NOW,
    ).active_status;
    expect(undated).toBe(16);
  });
});

describe("computeConfidence — freshness tiers", () => {
  const freshnessAt = (hoursAgo: number) =>
    computeConfidence(
      bestVerification({ checked_at: new Date(NOW - hoursAgo * HOUR).toISOString() }),
      null,
      NOW,
    ).freshness;

  it("degrades from 5 → 3 → 1 → 0 as the last check ages", () => {
    expect(freshnessAt(0)).toBe(5);
    expect(freshnessAt(24)).toBe(5);
    expect(freshnessAt(25)).toBe(3);
    expect(freshnessAt(72)).toBe(3);
    expect(freshnessAt(73)).toBe(1);
    expect(freshnessAt(168)).toBe(1);
    expect(freshnessAt(169)).toBe(0);
  });

  it("scores an unparseable timestamp as 0 rather than crashing", () => {
    expect(
      computeConfidence(bestVerification({ checked_at: "not-a-date" }), null, NOW).freshness,
    ).toBe(0);
  });
});

describe("computeConfidence — hard caps (numbers cannot launder a bad record)", () => {
  it("caps a closed job at 64 so it can never reach the strong band", () => {
    const closed = computeConfidence(bestVerification({ job_status: "closed" }), null, NOW);
    expect(closed.total).toBeLessThanOrEqual(64);
    expect(interpretConfidence(closed.total).band).not.toBe("strong");
  });

  it("caps an expired deadline at 64 regardless of other evidence", () => {
    const expired = computeConfidence(
      bestVerification({ deadline_status: "expired" }),
      null,
      NOW,
    );
    expect(expired.total).toBeLessThanOrEqual(64);
    expect(interpretConfidence(expired.total).band).not.toBe("strong");
  });

  it("never returns a negative or >100 total", () => {
    const nothing = computeConfidence(
      bestVerification({
        exact_job_status: "conflicting",
        application_link_status: "broken",
        website_status: "conflict",
        careers_page_url: "",
        careers_evidence_url: "",
        careers_discovery_method: "",
        job_status: "closed",
        deadline_status: "expired",
        checked_at: null,
      }),
      null,
      NOW,
    );
    expect(nothing.total).toBeGreaterThanOrEqual(0);
    expect(nothing.total).toBeLessThanOrEqual(100);
  });
});

describe("interpretConfidence — 85 / 65 bands", () => {
  it("maps scores to strong / review / unverified at the documented thresholds", () => {
    expect(interpretConfidence(100).band).toBe("strong");
    expect(interpretConfidence(85).band).toBe("strong");
    expect(interpretConfidence(84).band).toBe("review");
    expect(interpretConfidence(65).band).toBe("review");
    expect(interpretConfidence(64).band).toBe("unverified");
    expect(interpretConfidence(0).band).toBe("unverified");
  });

  it("always returns a human label and description", () => {
    for (const score of [0, 64, 65, 84, 85, 100]) {
      const r = interpretConfidence(score);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });
});

describe("deriveVerificationStatus — status beats arithmetic", () => {
  it("reports INVALID whenever confirmation says so, even at a high score", () => {
    expect(
      deriveVerificationStatus({
        confirmationInvalid: true,
        jobStatus: "open",
        deadlineStatus: "valid",
        confidence: 99,
      }),
    ).toBe("INVALID");
  });

  it("reports CLOSED for closed jobs or expired deadlines", () => {
    expect(
      deriveVerificationStatus({
        jobStatus: "closed",
        deadlineStatus: "valid",
        confidence: 99,
      }),
    ).toBe("CLOSED");
    expect(
      deriveVerificationStatus({
        jobStatus: "open",
        deadlineStatus: "expired",
        confidence: 99,
      }),
    ).toBe("CLOSED");
  });

  it("uses the confidence thresholds for everything else", () => {
    expect(
      deriveVerificationStatus({ jobStatus: "open", deadlineStatus: "valid", confidence: 85 }),
    ).toBe("VERIFIED");
    expect(
      deriveVerificationStatus({ jobStatus: "open", deadlineStatus: "valid", confidence: 65 }),
    ).toBe("NEEDS_REVIEW");
    expect(
      deriveVerificationStatus({ jobStatus: "open", deadlineStatus: "valid", confidence: 64 }),
    ).toBe("UNVERIFIED");
  });
});
