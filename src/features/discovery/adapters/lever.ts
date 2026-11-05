import type { EmploymentType } from "@/types";
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
 * Lever public postings adapter.
 *
 * ACCESS METHOD (documented + live-verified during Milestone 2):
 *   GET https://api.lever.co/v0/postings/{company_slug}?mode=json
 *   - 200 + a JSON array for an existing slug, 404 for an unknown slug;
 *   - employer-published data, no login, no CAPTCHA;
 *   - no documented rate limit; one request per slug, bounded by the run
 *     budget (see docs/discovery-sources.md).
 *
 * Published fields used here: id, text (title), hostedUrl, applyUrl, createdAt
 * (epoch ms), categories.location / allLocations, categories.commitment,
 * workplaceType, country, descriptionPlain, lists[].content, additionalPlain.
 *
 * Lever does NOT publish the company name — it comes from the configured slug
 * (`DISCOVERY_LEVER_POSTINGS=spotify=Spotify`). It also publishes no salary
 * field (only free text in `additional`, parsed only when it states an amount
 * AND a period) and no application deadline (closing_date stays null).
 */

const API_BASE = "https://api.lever.co/v0/postings";
const PLATFORM_URL = "https://api.lever.co";

/** Lever's own `categories.commitment` taxonomy → JobDedo employment type. */
const COMMITMENT_MAP: Record<string, EmploymentType> = {
  permanent: "full_time",
  "full-time": "full_time",
  "full time": "full_time",
  "part-time": "part_time",
  "part time": "part_time",
  "short term": "contract",
  "short-term": "contract",
  "fixed-term": "contract",
  "fixed term": "contract",
  contract: "contract",
  internship: "internship",
};

/** Lever's own `workplaceType` values → JobDedo work model. */
const WORKPLACE_MAP: Record<string, "remote" | "hybrid" | "onsite"> = {
  remote: "remote",
  hybrid: "hybrid",
  onsite: "onsite",
};

/** Company slug from a hosted URL (`jobs.lever.co/{slug}/…`). */
function slugFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length > 0 ? decodeURIComponent(parts[0]!) : null;
  } catch {
    return null;
  }
}

/** First entry of `categories.allLocations` when it really is a list. */
function firstLocation(value: unknown): string | null {
  return Array.isArray(value) ? str(value[0]) : null;
}

export interface LeverTarget {
  slug: string;
  /** Company display name (`slug=Display Name`), or "" when not configured. */
  name: string;
}

/** Parse `spotify=Spotify` / `spotify` config entries. */
export function parseLeverTargets(entries: string[]): LeverTarget[] {
  return entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf("=");
      if (eq <= 0) return { slug: entry, name: "" };
      return { slug: entry.slice(0, eq).trim(), name: entry.slice(eq + 1).trim() };
    })
    .filter((target) => target.slug.length > 0);
}

export function createLeverAdapter(entries: string[]): SourceAdapter {
  const targets = parseLeverTargets(entries);
  const nameBySlug = new Map(targets.map((t) => [t.slug.toLowerCase(), t.name]));
  const soleTarget = targets.length === 1 ? targets[0]! : null;

  return {
    key: "lever",
    name: "Lever",
    enabled: targets.length > 0,
    status:
      targets.length > 0
        ? `Public Lever postings API · ${targets.length} company slug${targets.length === 1 ? "" : "s"} configured`
        : "No Lever company slugs configured (set DISCOVERY_LEVER_POSTINGS)",
    targets: targets.map((t) => t.slug),

    async fetchAll(ctx: AdapterContext): Promise<AdapterFetchResult> {
      const result: AdapterFetchResult = {
        source_key: "lever",
        listings: [],
        failures: [],
        requests: 0,
      };

      for (const target of targets) {
        if (!takeBudget(ctx)) {
          result.failures.push({
            target: target.slug,
            error: "Request budget exhausted for this run — postings not fetched",
          });
          continue;
        }
        result.requests += 1;
        try {
          const payload = await fetchJson(
            ctx,
            `${API_BASE}/${encodeURIComponent(target.slug)}?mode=json`,
          );
          if (!Array.isArray(payload)) {
            throw new Error(
              `Lever slug "${target.slug}" did not return a JSON array of postings`,
            );
          }
          for (const item of payload) {
            const posting = asRecord(item);
            if (posting) result.listings.push({ ...posting, _target: target.slug });
          }
        } catch (error) {
          result.failures.push({ target: target.slug, error: errorMessage(error) });
        }
      }
      return result;
    },

    normalise(raw: RawListing): NormaliseResult {
      const id = str(raw.id);
      if (!id) return { ok: false, error: "missing `id`" };

      const title = str(raw.text);
      if (!title) return { ok: false, error: "missing `text` (title)" };

      const hostedUrl = str(raw.hostedUrl);
      if (!hostedUrl) return { ok: false, error: "missing `hostedUrl`" };

      const slug = str(raw._target) ?? slugFromUrl(hostedUrl) ?? soleTarget?.slug;
      if (!slug) return { ok: false, error: "cannot determine the company slug for this posting" };

      const categories = asRecord(raw.categories);
      const commitment = str(categories?.commitment);
      const workplace = str(raw.workplaceType)?.toLowerCase();
      const description = composeDescription(raw);

      const draft: JobDraft = assembleDraft({
        source_key: "lever",
        source_name: "Lever",
        source_base_url: PLATFORM_URL,
        source_kind: "ats_api",
        source_job_id: id,
        company: {
          name: nameBySlug.get(slug.toLowerCase()) ?? slug,
          // Lever publishes no company website — never invent one.
          domain: "",
          official_website_url: "",
          careers_page_url: "",
          industry: "",
        },
        title,
        description,
        location_text:
          str(categories?.location) ?? firstLocation(categories?.allLocations) ?? "",
        source_country: str(raw.country) ?? undefined,
        ...(workplace && WORKPLACE_MAP[workplace]
          ? { work_model: WORKPLACE_MAP[workplace] }
          : {}),
        ...(commitment && COMMITMENT_MAP[commitment.toLowerCase()]
          ? { employment_type: COMMITMENT_MAP[commitment.toLowerCase()] }
          : {}),
        original_url: hostedUrl,
        application_url: str(raw.applyUrl) ?? hostedUrl,
        posted_at: toIso(raw.createdAt),
        // Lever publishes no application deadline.
        closing_date: null,
      });
      return { ok: true, draft };
    },
  };
}

/** descriptionPlain + the source's own list sections + `additional` text. */
function composeDescription(raw: RawListing): string {
  const parts: string[] = [];
  const plain = str(raw.descriptionPlain);
  if (plain) parts.push(plain);

  const lists = raw.lists;
  if (Array.isArray(lists)) {
    for (const entry of lists) {
      const item = asRecord(entry);
      if (!item) continue;
      const heading = str(item.text);
      const body = stripHtml(str(item.content) ?? "");
      if (body) parts.push(heading ? `${heading}\n${body}` : body);
    }
  }

  const additional = str(raw.additionalPlain) ?? stripHtml(str(raw.additional) ?? "");
  if (additional) parts.push(additional);

  // Join with blank lines and keep the line structure: `parseDescriptionSections`
  // is line-based, and collapsing newlines here would silently drop every
  // heading the source published (squash() is only for comparisons/keys).
  return parts
    .join("\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toIso(value: unknown): string | null {
  const ms = num(value);
  if (ms === null || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
