import type {
  CheckResult,
  ConfidenceBreakdown,
  DeadlineStatus,
  ExactJobStatus,
  Job,
  JobVerification,
  LinkStatus,
  VerificationStatus,
} from "@/types";

/**
 * Explainable verification confidence score (0-100).
 *
 * Components (spec §8):
 *   official source confirmation  30
 *   application link status       20
 *   active job status             20
 *   company identity              15
 *   description/contact consistency 10
 *   freshness                      5
 *
 * This is JobDedo's internal confidence estimate, NOT a guarantee. Hard rules:
 * a closed job or an INVALID (confirmed scam) record can never reach the
 * 85+ "strong evidence" band regardless of arithmetic.
 */

const EXACT_JOB_POINTS: Record<ExactJobStatus, number> = {
  confirmed_official: 30,
  confirmed_platform: 16,
  not_found_official: 0,
  conflicting: 0,
  unable_to_verify: 0,
  not_checked: 0,
};

const LINK_POINTS: Record<LinkStatus, number> = {
  working: 20,
  redirected: 14,
  broken: 0,
  unable_to_check: 4,
  not_checked: 0,
};

const WEBSITE_POINTS: Record<CheckResult, number> = {
  confirmed: 15,
  uncertain: 8,
  not_found: 0,
  failed: 2,
  conflict: 0,
  not_checked: 0,
};

function activeStatusPoints(
  jobStatus: Job["job_status"],
  deadline: DeadlineStatus,
): number {
  if (jobStatus === "closed") return 0;
  if (deadline === "expired") return 0;
  if (jobStatus === "open") {
    if (deadline === "valid") return 20;
    if (deadline === "not_specified") return 16;
    return 10; // uncertain
  }
  return 6; // unknown
}

function contentConsistencyPoints(
  v: Pick<
    JobVerification,
    "careers_page_url" | "careers_evidence_url" | "careers_discovery_method"
  >,
): number {
  const hasEvidence = Boolean(v.careers_evidence_url && v.careers_discovery_method);
  const hasCareers = Boolean(v.careers_page_url);
  if (hasEvidence && hasCareers) return 10;
  if (hasCareers || hasEvidence) return 6;
  return 0;
}

function freshnessPoints(lastCheckedAt: string | null, now: number): number {
  if (!lastCheckedAt) return 0;
  const t = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const hours = (now - t) / 3_600_000;
  if (hours <= 24) return 5;
  if (hours <= 72) return 3;
  if (hours <= 168) return 1;
  return 0;
}

export function computeConfidence(
  verification: Pick<
    JobVerification,
    | "exact_job_status"
    | "application_link_status"
    | "website_status"
    | "careers_page_url"
    | "careers_evidence_url"
    | "careers_discovery_method"
    | "deadline_status"
    | "job_status"
    | "checked_at"
  >,
  job?: Pick<Job, "job_status"> | null,
  now: number = Date.now(),
): ConfidenceBreakdown {
  const jobStatus = job?.job_status ?? verification.job_status;

  const breakdown: ConfidenceBreakdown = {
    official_source: EXACT_JOB_POINTS[verification.exact_job_status] ?? 0,
    application_link: LINK_POINTS[verification.application_link_status] ?? 0,
    active_status: activeStatusPoints(jobStatus, verification.deadline_status),
    company_identity: WEBSITE_POINTS[verification.website_status] ?? 0,
    content_consistency: contentConsistencyPoints(verification),
    freshness: freshnessPoints(verification.checked_at ?? null, now),
    total: 0,
  };

  let total =
    breakdown.official_source +
    breakdown.application_link +
    breakdown.active_status +
    breakdown.company_identity +
    breakdown.content_consistency +
    breakdown.freshness;

  // Hard caps: numbers cannot launder a bad record into "strong evidence".
  if (jobStatus === "closed" || verification.deadline_status === "expired") {
    total = Math.min(total, 64);
  }
  breakdown.total = Math.max(0, Math.min(100, total));
  return breakdown;
}

export type ConfidenceBand = "strong" | "review" | "unverified";

export function interpretConfidence(score: number): {
  band: ConfidenceBand;
  label: string;
  description: string;
} {
  if (score >= 85) {
    return {
      band: "strong",
      label: "Strong evidence",
      description:
        "Multiple independent checks line up. Still an estimate, not a guarantee.",
    };
  }
  if (score >= 65) {
    return {
      band: "review",
      label: "Needs review",
      description: "Some checks passed, but evidence is incomplete.",
    };
  }
  return {
    band: "unverified",
    label: "Unverified",
    description: "Little or no confirming evidence has been collected yet.",
  };
}

/**
 * Derive the verification status shown in the UI from the raw record.
 * INVALID/CLOSED/EXPIRED always win over the numeric score.
 */
export function deriveVerificationStatus(input: {
  confirmationInvalid?: boolean;
  jobStatus: Job["job_status"];
  deadlineStatus: DeadlineStatus;
  confidence: number;
}): VerificationStatus {
  if (input.confirmationInvalid) return "INVALID";
  if (input.jobStatus === "closed" || input.deadlineStatus === "expired") {
    return "CLOSED";
  }
  if (input.confidence >= 85) return "VERIFIED";
  if (input.confidence >= 65) return "NEEDS_REVIEW";
  return "UNVERIFIED";
}
