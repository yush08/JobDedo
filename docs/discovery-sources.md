# Discovery sources

Milestone 2 turns discovery into a real engine: source adapters fetch
**employer-authorized public feeds**, the pipeline validates, normalises,
deduplicates and persists every listing, and the run/source history is what the
Discover page renders. This document is the operator's reference: what each
source is, how it is accessed, its limits, every environment variable, and how
to test, run and schedule discovery.

## Honesty rules (non-negotiable)

- **No fabricated jobs.** A listing exists only because a source returned it.
  Fields a source does not publish are stored as `null` / `""` / `unknown` —
  never guessed. (Inference such as `employment_type` from the word "Intern"
  in a title is derived only from text the source itself published.)
- **No CAPTCHA/login/anti-bot bypass.** Only endpoints that answer a plain
  `GET` with `JSON` without credentials are used. Sources that need scraping
  of protected pages stay listed as *not integrated*.
- **Mocked tests ≠ live integration.** The unit tests use a fake `fetch` and
  prove mapping/validation/failure behaviour only. Live access was verified
  separately (per source below) and can be re-verified with the smoke test in
  [Testing an adapter](#testing-an-adapter).
- **Failures are recorded, never hidden.** A broken board becomes a per-source
  `partial`/`failure` status with the real error message; a run only fails
  when *every* source fails.

## Supported sources

All three are public JSON endpoints of the ATS itself (Greenhouse, Lever,
Ashby). They require no API key, return `200` for an existing board and `404`
for an unknown one, and publish only employer-authored content.

### Greenhouse — `boards-api.greenhouse.io`

| | |
|---|---|
| Access method | `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true` |
| Auth | none (public board API) |
| Rate limit | none published; JobDedo still bounds itself (budget, timeout, one board at a time) |
| Verified live | during M2: `dropbox` → 200 (31 listings), `vercel` → 200 (88 listings); unknown token → 404 |
| Published fields used | `id`, `title`, `absolute_url`, `location.name`, `first_published`, `first_deadline` (when present), `content` (HTML-escaped HTML), `company_name` |
| Not published | employment type, work model, salary, separate apply URL (the listing page *is* the apply page), company website — all stay `unknown`/`null`/`""` |

`content` arrives HTML-escaped; the adapter decodes entities and strips tags
to plain text with `•` bullets before section parsing.

- Env: `DISCOVERY_GREENHOUSE_BOARDS` — comma-separated board tokens.
  Default: `dropbox,vercel`. A board token is the path segment in
  `https://job-boards.greenhouse.io/{token}/jobs/…`.
- Request shape: ~0.3–0.8 MB per board with `content=true`.

### Lever — `api.lever.co`

| | |
|---|---|
| Access method | `GET https://api.lever.co/v0/postings/{company_slug}?mode=json` |
| Auth | none (public postings API) |
| Rate limit | none published; one request per slug, bounded by the run budget |
| Verified live | during M2: `spotify` → 200 (85 postings); unknown slug → 404 |
| Published fields used | `id`, `text` (title), `hostedUrl`, `applyUrl`, `createdAt` (epoch ms), `categories.location`, `categories.allLocations`, `categories.commitment`, `workplaceType`, `country`, `descriptionPlain`, `lists[]`, `additionalPlain` |
| Not published | company name (comes from config), application deadline, salary as a field (free text is parsed only when it states an amount **and** a period) |

- Env: `DISCOVERY_LEVER_POSTINGS` — comma-separated entries of
  `slug=Display Name` (or just `slug`, using the slug as the display name).
  Default: `spotify=Spotify`. The display name matters: Lever never publishes
  the company name, and the composite dedupe key is `company|title|location`.
- `categories.commitment` (`Full-time`, `Internship`, `Short Term`, …) maps to
  our employment type; `workplaceType` (`hybrid`/`onsite`/`remote`) to the work
  model. Missing → inferred from published text only, else `unknown`.

### Ashby — `api.ashbyhq.com`

| | |
|---|---|
| Access method | `GET https://api.ashbyhq.com/posting-api/job-board/{board_name}` |
| Auth | none (public posting API) |
| Rate limit | none published; one request per board, bounded by the run budget |
| Verified live | during M2: `Linear` → 200 (31 listings); unknown board → 404 |
| Published fields used | `id`, `title`, `employmentType` (`FullTime`/`PartTime`/`Contract`/`Intern`/`Temporary`), `workplaceType`, `isRemote`, `location`, `publishedAt`, `jobUrl`, `applyUrl`, `descriptionPlain`, `isListed` |
| Not published | company name (board name supplies it), deadline, salary for most boards |

- Env: `DISCOVERY_ASHBY_BOARDS` — comma-separated entries of
  `Board=Display Name` (or just `Board`). Default: `Linear`.
- Listings with `isListed: false` are **skipped** (Ashby marks unlisted
  postings; fetching them would publish jobs the employer hid).

### Not integrated (documented on purpose)

| Source | Why it is not integrated |
|---|---|
| LinkedIn | No permitted public feed; jobs pages require login and are protected by anti-bot measures. Scraping them would violate the milestone's rules. |
| Naukri | No employer-authorized public API; listing pages are protected. |
| Indeed | No permitted public feed for aggregators; publisher terms prohibit scraping. |
| Internshala | No public API; pages are served behind bot protection. |

These sources appear in the adapter registry with an honest
`not integrated` status so the UI can say so instead of pretending. Adding one
later requires the same bar as the three above: a documented, permitted access
method, live verification, and tests — never a CAPTCHA/login bypass.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DISCOVERY_SOURCES_ENABLED` | `greenhouse,lever,ashby` | Which adapters a run may construct |
| `DISCOVERY_GREENHOUSE_BOARDS` | `dropbox,vercel` | Greenhouse board tokens |
| `DISCOVERY_LEVER_POSTINGS` | `spotify=Spotify` | Lever `slug=Display Name` entries |
| `DISCOVERY_ASHBY_BOARDS` | `Linear` | Ashby `Board=Display Name` entries |
| `JOBDEDO_DISCOVERY_MAX_REQUESTS_PER_RUN` | `12` | Hard cap on HTTP requests per run (range 1–200) |
| `JOBDEDO_DISCOVERY_CONCURRENCY` | `2` | Adapters fetching at the same time (range 1–6) |
| `JOBDEDO_DISCOVERY_TIMEOUT_MS` | `15000` | Per-request timeout (range 1000–60000) |
| `JOBDEDO_DISCOVERY_MAX_JOBS_PER_SOURCE` | `250` | Listings normalised per source per run (range 1–5000) |
| `JOBDEDO_DISCOVERY_VERIFY_LIMIT` | `8` | New listings probed by the verification engine per run (range 0–50; `0` disables) |
| `JOBDEDO_DISCOVERY_MATCH_LIMIT` | `50` | Touched listings scored by the matching engine per run (range 0–500; `0` disables) |

All values come from the environment with safe defaults: a fresh clone runs
real discovery with **no configuration at all**.

## How a run executes

```
POST /api/v1/discovery/run
  → validate body (zod) + rate limit (discovery:run 10/min)
  → claim in-process lock + check persisted pending/running row (< 10 min)
  → create run row (status: pending) → 201 { run } immediately
  → after(): executeDiscoveryRun(...)
       for each adapter (bounded concurrency):
         for each target: GET (shared request budget) → validate envelope
         normalise each listing → JobDraft (missing fields → null/"")
         within-run dedupe (primary key, canonical URL, composite bucket)
         store.ingestJob (idempotent create/merge, source_links preserved)
         checkpoint + per-source status after every source
       verification engine (first verifyLimit new rows, real HTTP probes)
       matching engine (first matchLimit touched rows, existing scorer)
       final status: completed (≥1 source ok) | failed (all sources failed)
  → GET /api/v1/discovery/status[/:id] polls the persisted run
```

### Deduplication rules

A listing is the *same vacancy* when any of these hold — each rule is
conservative, because merging two different jobs would make the loser's
original link unreachable:

1. same `source_key` + same external id (stored as `jobs.dedupe_key`);
2. same canonical URL (tracking parameters stripped, host lowercased);
3. same company + title + location (the classic composite key — also matches
   across sources);
4. near-identical titles (token similarity ≥ 0.9) at the same company **and**
   location, only when both descriptions are ≥ 80 chars and agree
   (similarity ≥ 0.75). Similar titles alone never merge.

Sample rows are never merge targets. On merge, `first_discovered_at`,
verification state, `job_status`, `is_sample` and identity fields are never
touched, published values are never replaced by `null`, and **every** original
source link is kept in `jobs.source_links`. Re-running the same source is
therefore idempotent: `created = 0`, `merged = n`, history preserved.

### Run locking (and its documented limitation)

Two layers prevent overlapping runs:

1. an **in-process claim** — two requests in the same instance cannot race;
2. a **persisted `pending`/`running` row younger than 10 minutes** — a run
   killed mid-flight is marked `failed` ("no heartbeat for 10 minutes") after
   10 minutes instead of blocking discovery forever.

**Limitation:** without a shared lock table, two *separate* serverless
instances can each pass their own layer and start a run at the same time. The
ingestion itself stays idempotent, so the worst case is duplicate fetching, not
duplicate rows. A cross-instance lock (e.g. a row lock in Postgres) is future
work; `discovery_locks` exists in the schema for it.

## Testing an adapter

**Unit level (no network).** `tests/adapters.test.ts` drives each adapter with
a fake `fetch`: envelope validation, per-target failure recording (404, invalid
JSON, missing arrays), budget accounting, field mapping and the honesty rules
(missing salary → `null`, missing employment type → `unknown`, original URL
preserved, canonical URL stripped). `tests/discovery-pipeline.test.ts` runs the
whole pipeline against a temp-dir store: persistence, idempotent re-runs,
within-run dedupe, partial failures, budgets and the verification/matching
stages. These prove *behaviour*, not live access.

```powershell
npm test                                   # full suite
npx vitest run tests/adapters.test.ts      # adapters only
npx vitest run tests/discovery-pipeline.test.ts
```

**Live smoke test (proves real access).** Against the running app:

```powershell
npm run build
npm start
# in another shell:
curl.exe -X POST http://localhost:3000/api/v1/discovery/run `
  -H "content-type: application/json" -d "{}"
curl.exe http://localhost:3000/api/v1/discovery/status
```

Expect `201` with a run id, then a `completed` run with per-source results,
and non-sample rows on `/discover` carrying `original_url`,
`source_links`, `last_discovered_at` and a discovery run id. To confirm a
source end-to-end yourself, point it at a board you know exists and compare
the listing count with the endpoint opened directly in a browser:

```powershell
curl.exe "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs?content=true" -o gh.json
```

A `404` here means the board token is wrong — the run records exactly that
error instead of inventing rows.

## Running discovery locally

1. `npm install && npm run dev` (or `npm run build && npm start`).
2. Open **Discover** and press **Run discovery**, or POST
   `/api/v1/discovery/run` as above. The response returns as soon as the run
   row exists; execution continues in the background (`after()`), so the
   request is never held open.
3. Poll `GET /api/v1/discovery/status` (the UI does this automatically) for
   phase, per-source results and counters. Run history is persisted in
   `discovery_runs` and shown on the Discover page.
4. A run with no configured source returns `503 NO_ADAPTERS` / `503 NO_TARGETS`
   with the adapter list — it never writes a fake run row. A second run while
   one is active returns `409 RUN_IN_PROGRESS`.

## Scheduled discovery (GitHub Actions)

The run endpoint is a plain, bounded, idempotent operation — nothing about it
requires a browser. A scheduler only needs to POST and optionally poll:

```yaml
# .github/workflows/discovery.yml
name: Scheduled discovery
on:
  schedule:
    - cron: "17 */6 * * *"   # every 6 hours, off the :00 stampede
  workflow_dispatch: {}

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - name: Start a discovery run
        env:
          JOBDEDO_URL: ${{ vars.JOBDEDO_URL }}   # e.g. https://your-app.vercel.app
        run: |
          code=$(curl -sS -o /tmp/run.json -w "%{http_code}" \
            -X POST "$JOBDEDO_URL/api/v1/discovery/run" \
            -H "content-type: application/json" \
            -d '{"trigger":"schedule"}')
          cat /tmp/run.json
          # 201 = started, 409 = already running (fine — skip), 503 = no source configured
          [ "$code" = "201" ] || [ "$code" = "409" ]

      - name: Wait for completion and report
        env:
          JOBDEDO_URL: ${{ vars.JOBDEDO_URL }}
        run: |
          for i in $(seq 1 30); do
            status=$(curl -sS "$JOBDEDO_URL/api/v1/discovery/status" | tr ',' '\n' | grep -o '"status":"[a-z]*"' | head -1)
            case "$status" in
              *completed*|*failed*) echo "$status"; break ;;
            esac
            sleep 10
          done
```

Notes:

- `trigger: "schedule"` is recorded in the run history, so scheduled and
  manual runs are distinguishable.
- The endpoint is rate-limited (`discovery:run`: 10/min) — a stuck scheduler
  fails loudly instead of hammering the sources.
- The same limits apply to scheduled runs (budget, jobs per source, verify/match
  limits), so a schedule can never turn into an unbounded crawl.

## API summary

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/discovery/run` | Validate + start a run; `201` with run id, `409` duplicate, `503` no source, `400` bad body, `429` rate limited |
| `GET /api/v1/discovery/run` | Adapter list, `ready` flag, latest run (never claims a run) |
| `GET /api/v1/discovery/status` | Recent runs + active run for the status panel |
| `GET /api/v1/discovery/status/:id` | Single run (progress polling) |

Full contract: [api.md](./api.md).
