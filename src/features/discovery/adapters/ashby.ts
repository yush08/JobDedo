import type { EmploymentType, WorkModel } from "@/types";
import type {
  AdapterContext,
  AdapterFetchResult,
  JobDraft,
  NormaliseResult,
  RawListing,
  SourceAdapter,
} from "../types";
import { fetchJson, takeBudget } from "./http";
import { asRecord, assembleDraft, errorMessage, str } from "./shared";
import { stripHtml } from "../normalize";

/**
 * Ashby public job-board adapter.
 *
 * ACCESS METHOD (documented + live-verified during Milestone 2):
 *   GET https://api.ashbyhq.com/posting-api/job-board/{board_name}
 *   - 200 + JSON `{ apiVersion, jobs: [...] }` for an existing board,
 *     404 for an unknown board;
 *   - employer-published data, no login, no CAPTCHA;
 *   - no documented rate limit; one request per board, bounded by the run
 *     budget (see docs/discovery-sources.md).
 *
 * Published fields used here: id, title, employmentType, workplaceType,
 * isRemote, location, publishedAt, isListed, jobUrl, applyUrl,
 * descriptionPlain (fallback: descriptionHtml), department, team.
 *
 * Ashby does NOT publish the company name — it is the configured board name
 * (`DISCOVERY_ASHBY_BOARDS=Linear` or `Linear=Linear Technologies`), nor a
 * company website, salary or application deadline (all stay empty/null).
 * Listings with `isListed: false` are private and are never ingested.
 */

const API_BASE = "https://api.ashbyhq.com/posting-api/job-board";
const PLATFORM_URL = "https://api.ashbyhq.com";

/** Ashby's own `employmentType` taxonomy → JobDedo employment type. */
const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  fulltime: "full_time",
  parttime: "part_time",
  contract: "contract",
  intern: "internship",
  internship: "internship",
  temporary: "contract",
  freelance: "freelance",
};

/** Ashby's own `workplaceType` taxonomy → JobDedo work model. */
const WORKPLACE_MAP: Record<string, WorkModel> = {
  remote: "remote",
  hybrid: "hybrid",
  onsite: "onsite",
  onsiteoffice: "onsite",
};

/** Board name from a job URL (`jobs.ashbyhq.com/{Board}/{id}`). */
function boardFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length > 0 ? decodeURIComponent(parts[0]!) : null;
  } catch {
    return null;
  }
}

export interface AshbyTarget {
  board: string;
  /** Company display name (`Board=Display Name`), or "" when not configured. */
  name: string;
}

/** Parse `Linear=Linear Technologies` / `Linear` config entries. */
export function parseAshbyTargets(entries: string[]): AshbyTarget[] {
  return entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf("=");
      if (eq <= 0) return { board: entry, name: "" };
      return { board: entry.slice(0, eq).trim(), name: entry.slice(eq + 1).trim() };
    })
    .filter((target) => target.board.length > 0);
}

export function createAshbyAdapter(entries: string[]): SourceAdapter {
  const targets = parseAshbyTargets(entries);
  const nameByBoard = new Map(targets.map((t) => [t.board.toLowerCase(), t.name]));
  const soleTarget = targets.length === 1 ? targets[0]! : null;

  return {
    key: "ashby",
    name: "Ashby",
    enabled: targets.length > 0,
    status:
      targets.length > 0
        ? `Public Ashby posting API · ${targets.length} board${targets.length === 1 ? "" : "s"} configured`
        : "No Ashby boards configured (set DISCOVERY_ASHBY_BOARDS)",
    targets: targets.map((t) => t.board),

    async fetchAll(ctx: AdapterContext): Promise<AdapterFetchResult> {
      const result: AdapterFetchResult = {
        source_key: "ashby",
        listings: [],
        failures: [],
        requests: 0,
      };

      for (const target of targets) {
        if (!takeBudget(ctx)) {
          result.failures.push({
            target: target.board,
            error: "Request budget exhausted for this run — board not fetched",
          });
          continue;
        }
        result.requests += 1;
        try {
          const payload = await fetchJson(
            ctx,
            `${API_BASE}/${encodeURIComponent(target.board)}`,
          );
          const envelope = asRecord(payload);
          if (!envelope || !Array.isArray(envelope.jobs)) {
            throw new Error(
              `Ashby board "${target.board}" response has no "jobs" array`,
            );
          }
          for (const item of envelope.jobs) {
            const job = asRecord(item);
            if (!job) continue;
            // Private listings are not public vacancies — never ingest them.
            if (job.isListed === false) continue;
            result.listings.push({ ...job, _target: target.board });
          }
        } catch (error) {
          result.failures.push({ target: target.board, error: errorMessage(error) });
        }
      }
      return result;
    },

    normalise(raw: RawListing): NormaliseResult {
      if (raw.isListed === false) {
        return { ok: false, error: "listing is not public (`isListed: false`)" };
      }

      const id = str(raw.id);
      if (!id) return { ok: false, error: "missing `id`" };

      const title = str(raw.title);
      if (!title) return { ok: false, error: "missing `title`" };

      const jobUrl = str(raw.jobUrl);
      if (!jobUrl) return { ok: false, error: "missing `jobUrl`" };

      const board = str(raw._target) ?? boardFromUrl(jobUrl) ?? soleTarget?.board;
      if (!board) return { ok: false, error: "cannot determine the Ashby board for this listing" };

      const employmentRaw = str(raw.employmentType)?.toLowerCase().replace(/[^a-z]/g, "");
      const employment = employmentRaw ? EMPLOYMENT_MAP[employmentRaw] : undefined;

      const workplaceRaw = str(raw.workplaceType)?.toLowerCase().replace(/[^a-z]/g, "");
      const workplace = workplaceRaw ? WORKPLACE_MAP[workplaceRaw] : undefined;
      const work_model: WorkModel | undefined =
        workplace ?? (raw.isRemote === true ? "remote" : undefined);

      const description =
        str(raw.descriptionPlain) ?? stripHtml(str(raw.descriptionHtml) ?? "");

      const draft: JobDraft = assembleDraft({
        source_key: "ashby",
        source_name: "Ashby",
        source_base_url: PLATFORM_URL,
        source_kind: "ats_api",
        source_job_id: id,
        company: {
          name: nameByBoard.get(board.toLowerCase()) ?? board,
          // Ashby publishes no company website — never invent one.
          domain: "",
          official_website_url: "",
          careers_page_url: "",
          industry: "",
        },
        title,
        description,
        location_text: str(raw.location) ?? "",
        ...(work_model ? { work_model } : {}),
        ...(employment ? { employment_type: employment } : {}),
        original_url: jobUrl,
        application_url: str(raw.applyUrl) ?? jobUrl,
        posted_at: str(raw.publishedAt) ?? null,
        // Ashby publishes no application deadline.
        closing_date: null,
      });
      return { ok: true, draft };
    },
  };
}
