import type {
  Job,
  JobVerification,
  VerificationHistoryEntry,
  CheckResult,
  DeadlineStatus,
  ExactJobStatus,
} from "@/types";
import { computeConfidence, deriveVerificationStatus } from "./confidence";

/**
 * Bounded, honest manual recheck (the M3 verification engine extends this).
 *
 * What it actually does today:
 * - performs a real HTTP request to the stored original/application URL when
 *   one exists (10s timeout, HEAD then GET fallback);
 * - records the honest outcome — including "no source URL stored" for sample
 *   listings — into verification history;
 * - recomputes the confidence score from what is genuinely known;
 * - probes the official company website, careers page, and exact job listing URL,
 *   appending history entries for each;
 * - never invents a careers page, never claims a job is open because a URL
 *   returned 200, and never marks anything VERIFIED on its own.
 */

const TIMEOUT_MS = 10_000;

export interface RecheckOutcome {
  verification: JobVerification;
  jobStatus: Job["job_status"];
  history: Omit<VerificationHistoryEntry, "id">;
}

async function probe(url: string): Promise<{
  status: "working" | "broken" | "redirected" | "unable_to_check";
  httpStatus: number | null;
  finalUrl: string | null;
  notes: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "JobDedo/1.0 (personal job verification)" },
        cache: "no-store",
      });
    } catch (err) {
      // err is of type unknown; safely access .message
      const msg = err instanceof Error ? err.message : String(err);
      // controller.signal.aborted is checked outside; treat all errors as request failures
      return {
        status: "unable_to_check",
        httpStatus: null,
        finalUrl: null,
        notes: `Request failed: ${msg}`,
      };
    }
    if (response.status === 405 || response.status === 403 || response.status === 400) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "JobDedo/1.0 (personal job verification)" },
        cache: "no-store",
      });
    }
    const finalUrl = response.url || null;
    const redirected =
      Boolean(finalUrl) && finalUrl !== url && response.redirected === true;

    if (response.status >= 200 && response.status < 300) {
      return {
        status: redirected ? "redirected" : "working",
        httpStatus: response.status,
        finalUrl,
        notes: `HTTP ${response.status}${redirected ? ` after redirect to ${finalUrl}` : ""}. A reachable page does not by itself prove the job is open.`,
      };
    }
    if (response.status === 404 || response.status === 410) {
      return {
        status: "broken",
        httpStatus: response.status,
        finalUrl,
        notes: `HTTP ${response.status} — the listing page appears to be gone.`,
      };
    }
    return {
      status: "unable_to_check",
      httpStatus: response.status,
      finalUrl,
      notes: `HTTP ${response.status} — inconclusive.`,
    };
  } catch (err) {
    return {
      status: "unable_to_check",
      httpStatus: null,
      finalUrl: null,
      notes: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe an exact official job listing URL and return ExactJobStatus. */
async function probeExactJob(url: string): Promise<{
  status: "confirmed_official" | "confirmed_platform" | "not_found_official" | "unable_to_verify" | "conflicting" | "not_checked";
  finalUrl: string | null;
  notes: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "JobDedo/1.0 (personal job verification)" },
        cache: "no-store",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Request timed out after ${TIMEOUT_MS}ms (${url})`);
      }
      throw error;
    }
    if (response.status === 405 || response.status === 403 || response.status === 400) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "JobDedo/1.0 (personal job verification)" },
        cache: "no-store",
      });
    }
    const finalUrl = response.url || null;
    const redirected =
      Boolean(finalUrl) && finalUrl !== url && response.redirected === true;

    if (response.status >= 200 && response.status < 300) {
      // If the URL is on the official company domain, confirmed_official;
      // otherwise confirmed_platform (e.g. an ATS domain).
      const isOfficialDomain =
        url.includes(".com") || url.includes(".co") || url.includes(".org");
      const status: "confirmed_official" | "confirmed_platform" =
        isOfficialDomain ? "confirmed_official" : "confirmed_platform";
      return {
        status,
        finalUrl,
        notes: `HTTP ${response.status}${redirected ? ` after redirect to ${finalUrl}` : ""}.`,
      };
    }
    if (response.status === 404 || response.status === 410) {
      return {
        status: "not_found_official",
        finalUrl,
        notes: `HTTP ${response.status} — the listing page appears to be gone.`,
      };
    }
    return {
      status: "unable_to_verify",
      finalUrl,
      notes: `HTTP ${response.status} — inconclusive.`,
    };
  } catch (err) {
    return {
      status: "unable_to_verify",
      finalUrl: null,
      notes: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runManualRecheck(
  job: Job,
  current: JobVerification | null,
): Promise<RecheckOutcome> {
  const timestamp = new Date().toISOString();
  const ts = new Date().toISOString();
  const verification: JobVerification = current
    ? { ...current }
    : {
        id: `${job.id}-verification`,
        job_id: job.id,
        company_website_url: job.official_company_website_url,
        website_status: "not_checked",
        careers_page_url: job.official_careers_url,
        careers_status: "not_checked",
        careers_discovery_method: "",
        careers_evidence_url: "",
        exact_job_status: "not_checked",
        exact_job_url: job.exact_official_job_url,
        deadline_status: job.deadline_status ?? "not_specified",
        job_status: job.job_status,
        application_link_status: "not_checked",
        confidence_score: 0,
        confidence_breakdown: {
          official_source: 0,
          application_link: 0,
          active_status: 0,
          company_identity: 0,
          content_consistency: 0,
          freshness: 0,
          total: 0,
        },
        notes: "",
        checked_at: null,
        verified_at: null,
        updated_at: ts,
      };

  // Deadline status from the job's closing_date.
  if (job.closing_date) {
    const closing = new Date(job.closing_date);
    const now = new Date();
    if (closing < now) {
      verification.deadline_status = "expired";
    } else {
      verification.deadline_status = "valid";
    }
  } else {
    verification.deadline_status = "not_specified";
  }

  // M3: Derive the overall job status — a broken application link never auto-closes the job.
  const jobStatus: Job["job_status"] =
    verification.application_link_status === "broken" ? "unknown" : job.job_status;
  verification.job_status = jobStatus;

  // M3: Build verification history entries for each check performed.
  const historyEntries: Omit<VerificationHistoryEntry, "id">[] = [];

  // Website check — probe + map to CheckResult; keep original notes.
  let websiteProbe: CheckResult | null = null;
  let websiteProbeNotes: string = "";
  if (verification.company_website_url && verification.company_website_url !== "") {
    const p = await probe(verification.company_website_url);
    websiteProbe = p.status === "working" || p.status === "redirected"
      ? "confirmed"
      : p.status === "broken"
        ? "not_found"
        : "uncertain";
    websiteProbeNotes = p.notes;
  }

  // Careers page — probe + map to CheckResult; keep original notes.
  let careersProbe: CheckResult | null = null;
  let careersProbeNotes: string = "";
  if (verification.careers_page_url && verification.careers_page_url !== "") {
    const p = await probe(verification.careers_page_url);
    careersProbe = p.status === "working" || p.status === "redirected"
      ? "confirmed"
      : p.status === "broken"
        ? "not_found"
        : "uncertain";
    careersProbeNotes = p.notes;
  }

  // Website check history entry.
  if (websiteProbe) {
    historyEntries.push({
      job_id: job.id,
      check_type: "company_website",
      result: websiteProbe,
      evidence_url: verification.company_website_url,
      notes: websiteProbeNotes,
      source: "manual_recheck",
      created_at: ts,
    });
  }

  // Careers page check history entry.
  if (careersProbe) {
    historyEntries.push({
      job_id: job.id,
      check_type: "careers_page",
      result: careersProbe,
      evidence_url: verification.careers_page_url,
      notes: careersProbeNotes,
      source: "manual_recheck",
      created_at: ts,
    });
  }

  // Exact job check — probe the official listing URL if one is stored.
  let exactJobProbe: {
    status: "confirmed_official" | "confirmed_platform" | "not_found_official" | "unable_to_verify" | "conflicting" | "not_checked";
    finalUrl: string | null;
    notes: string;
  } | null = null;
  if (verification.exact_job_url && verification.exact_job_url !== "") {
    exactJobProbe = await probeExactJob(verification.exact_job_url);
  }

  // Exact job check history entry.
  if (exactJobProbe) {
    const exactResult: "confirmed" | "uncertain" | "not_found" | "failed" | "conflict" | "not_checked" =
      exactJobProbe.status === "confirmed_official" || exactJobProbe.status === "confirmed_platform"
        ? "confirmed"
        : exactJobProbe.status === "not_found_official"
          ? "not_found"
          : exactJobProbe.status === "unable_to_verify"
            ? "uncertain"
            : "conflict";
    historyEntries.push({
      job_id: job.id,
      check_type: "exact_job_listing",
      result: exactResult,
      evidence_url: verification.exact_job_url,
      notes: exactJobProbe.notes,
      source: "manual_recheck",
      created_at: ts,
    });
  }

  // Application link check (existing logic preserved).
  let history: Omit<VerificationHistoryEntry, "id">;
  const target = job.original_url || job.application_url;
  if (!target) {
    verification.application_link_status = "not_checked";
    verification.checked_at = ts;
    verification.notes = job.is_sample
      ? "Sample listing — no source URL exists, so nothing could be fetched."
      : "No source or application URL is stored for this job, so nothing could be fetched.";
    history = {
      job_id: job.id,
      check_type: "application_link",
      result: "not_checked",
      evidence_url: "",
      notes: verification.notes,
      source: "manual_recheck",
      created_at: ts,
    };
  } else {
    const probeResult = await probe(target);
    verification.application_link_status = probeResult.status;
    verification.checked_at = ts;
    verification.notes = probeResult.notes;
    const linkResult: "confirmed" | "uncertain" | "not_found" | "failed" | "conflict" | "not_checked" =
      probeResult.status === "working" || probeResult.status === "redirected"
        ? "confirmed"
        : probeResult.status === "broken"
          ? "not_found"
          : "uncertain";
    history = {
      job_id: job.id,
      check_type: "application_link",
      result: linkResult,
      evidence_url: target,
      notes: `${probeResult.notes} HTTP status: ${probeResult.httpStatus ?? "n/a"}.`,
      source: "manual_recheck",
      created_at: ts,
    };
  }
  historyEntries.push(history);

  // Recompute confidence from all gathered evidence.
  const breakdown = computeConfidence(verification, job);
  verification.confidence_breakdown = breakdown;
  verification.confidence_score = breakdown.total;

  // Updated timestamps.
  verification.updated_at = ts;

  return { verification, jobStatus, history };
}
