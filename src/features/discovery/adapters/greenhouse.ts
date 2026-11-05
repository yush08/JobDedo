import type {
  AdapterContext,
  AdapterFetchResult,
  JobDraft,
  NormaliseResult,
  RawListing,
  SourceAdapter,
} from "../types";
import { fetchJson, takeBudget } from "./http";
import { asRecord, assembleDraft, errorMessage, num, str } from "./shared";
import { stripHtml } from "../normalize";

/**
 * Greenhouse public board adapter.
 *
 * ACCESS METHOD (documented + live-verified during Milestone 2):
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 *   - 200 + JSON for an existing board, 404 for an unknown board;
 *   - employer-published data, no login, no CAPTCHA, no scraping of HTML pages;
 *   - no documented rate limit; we still request one board at a time with a
 *     timeout and a per-run request budget (see docs/discovery-sources.md).
 *
 * Published fields used here: id, title, absolute_url, location.name,
 * first_published, first_deadline (when present), content (HTML-escaped HTML),
 * company_name. Greenhouse does NOT publish employment type, work model,
 * salary or deadline for most boards — those stay unknown/null.
 */

const API_BASE = "https://boards-api.greenhouse.io/v1/boards";
const PLATFORM_URL = "https://boards-api.greenhouse.io";

/** Board token from a job-boards URL (`.../greenhouse.io/{token}/jobs/{id}`). */
function boardTokenFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const index = parts.indexOf("jobs");
    if (index > 0) return decodeURIComponent(parts[index - 1]!);
    return null;
  } catch {
    return null;
  }
}

export function createGreenhouseAdapter(boardTokens: string[]): SourceAdapter {
  const targets = boardTokens.map((t) => t.trim()).filter(Boolean);

  return {
    key: "greenhouse",
    name: "Greenhouse",
    enabled: targets.length > 0,
    status:
      targets.length > 0
        ? `Public Greenhouse board API · ${targets.length} board${targets.length === 1 ? "" : "s"} configured`
        : "No Greenhouse boards configured (set DISCOVERY_GREENHOUSE_BOARDS)",
    targets,

    async fetchAll(ctx: AdapterContext): Promise<AdapterFetchResult> {
      const result: AdapterFetchResult = {
        source_key: "greenhouse",
        listings: [],
        failures: [],
        requests: 0,
      };

      for (const token of targets) {
        if (!takeBudget(ctx)) {
          result.failures.push({
            target: token,
            error: "Request budget exhausted for this run — board not fetched",
          });
          continue;
        }
        result.requests += 1;
        try {
          const payload = await fetchJson(
            ctx,
            `${API_BASE}/${encodeURIComponent(token)}/jobs?content=true`,
          );
          const jobs = extractJobs(payload, token);
          for (const job of jobs) {
            result.listings.push({ ...job, _target: token });
          }
        } catch (error) {
          result.failures.push({ target: token, error: errorMessage(error) });
        }
      }
      return result;
    },

    normalise(raw: RawListing): NormaliseResult {
      const id = num(raw.id);
      if (id === null) return { ok: false, error: "missing or invalid `id`" };

      const title = str(raw.title);
      if (!title) return { ok: false, error: "missing `title`" };

      const url = str(raw.absolute_url);
      if (!url) return { ok: false, error: "missing `absolute_url`" };

      const target = str(raw._target) ?? boardTokenFromUrl(url);
      const company = str(raw.company_name) ?? target;
      if (!company) {
        return { ok: false, error: "missing `company_name` and no board token to derive it from" };
      }

      const locationName = str(asRecord(raw.location)?.name) ?? "";
      const description = stripHtml(str(raw.content) ?? "");
      const draft: JobDraft = assembleDraft({
        source_key: "greenhouse",
        source_name: "Greenhouse",
        source_base_url: PLATFORM_URL,
        source_kind: "ats_api",
        source_job_id: String(id),
        company: {
          name: company,
          // Greenhouse publishes no company website — never invent one.
          domain: "",
          official_website_url: "",
          careers_page_url: "",
          industry: "",
        },
        title,
        description,
        location_text: locationName,
        original_url: url,
        // Greenhouse publishes no separate apply URL: the listing page itself
        // is where the candidate applies.
        application_url: url,
        posted_at: str(raw.first_published) ?? null,
        closing_date: str(raw.first_deadline) ?? null,
      });
      return { ok: true, draft };
    },
  };
}

/** Validate the envelope and keep only usable job objects. */
function extractJobs(payload: unknown, token: string): RawListing[] {
  const envelope = asRecord(payload);
  if (!envelope) throw new Error(`Greenhouse board "${token}" did not return a JSON object`);
  const jobs = envelope.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error(`Greenhouse board "${token}" response has no "jobs" array`);
  }
  return jobs.map((job) => asRecord(job)).filter((job): job is RawListing => job !== null);
}
