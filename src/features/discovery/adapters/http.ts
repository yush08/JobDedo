import type { AdapterContext, FetchLike } from "../types";

/**
 * Bounded HTTP helper shared by every source adapter (Milestone 2).
 *
 * Guarantees:
 * - a per-request timeout (AbortController) so one dead board cannot hang a run;
 * - a response size cap, because some boards publish multi-MB payloads;
 * - JSON parse errors surface as thrown `HttpError`s with the body prefix
 *   attached, so the adapter records a per-target failure instead of crashing;
 * - the caller's AbortSignal is honoured alongside the timeout.
 */

/** Largest response body the adapters will read (16 MB — OpenAI's board is 13.5 MB). */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Default per-request timeout when the context does not specify one. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export const USER_AGENT = "JobDedo/1.0 (+job discovery; public ATS feed reader)";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * GET a JSON document with timeout + size cap. Throws `HttpError` on failure.
 * The timeout stays armed until the body has been fully read.
 */
export async function fetchJson(ctx: AdapterContext, url: string): Promise<unknown> {
  const timeoutMs = ctx.timeoutMs > 0 ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  const external = ctx.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await ctx.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (error) {
      if (controller.signal.aborted && !external?.aborted) {
        throw new HttpError(`Request timed out after ${timeoutMs}ms (${url})`);
      }
      throw new HttpError(
        `${error instanceof Error ? error.message : String(error)} (${url})`,
      );
    }

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} for ${url}`, response.status);
    }

    const text = await readTextCapped(response, url);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HttpError(
        `Invalid JSON from ${url} (first 120 chars: ${text.slice(0, 120).replace(/\s+/g, " ")})`,
        response.status,
      );
    }
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

/** Read a response body as text, refusing anything beyond `MAX_RESPONSE_BYTES`. */
export async function readTextCapped(response: Response, url: string): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new HttpError(
      `Response too large for ${url} (${declared} bytes > ${MAX_RESPONSE_BYTES})`,
      response.status,
    );
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new HttpError(
      `Response too large for ${url} (${text.length} bytes > ${MAX_RESPONSE_BYTES})`,
      response.status,
    );
  }
  return text;
}

/** The global fetch, typed as the adapter contract requires. */
export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * Consume one unit of the run's request budget.
 * Returns false (and consumes nothing) when the budget is already spent, so
 * the adapter can report the remaining targets as unfetched instead of
 * silently dropping them.
 */
export function takeBudget(ctx: AdapterContext): boolean {
  if (!ctx.budget) return true;
  if (ctx.budget.remaining <= 0) return false;
  ctx.budget.remaining -= 1;
  return true;
}
