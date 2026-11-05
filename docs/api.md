# JobDedo — API reference (`/api/v1`)

All routes live under `/api/v1` and share these conventions:

**Success envelope**

```json
{ "ok": true, "data": { … } }
```

**Error envelope**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { … } } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Zod rejected the input (`details` = Zod error) |
| `INVALID_JSON` | 400 | Body is not parseable JSON |
| `NOT_FOUND` | 404 | Resource does not exist |
| `METHOD_NOT_ALLOWED` | 405 | Route exists, method does not |
| `NEED_CONFIRMATION` | 422 | Application entered a post-submission stage without `confirmed_applied: true` |
| `RATE_LIMITED` | 429 | Per-route budget exceeded (`details.retryAfterSeconds`) |
| `INTERNAL_ERROR` | 500 | Unhandled server error |
| `NOT_IMPLEMENTED` | 501 | Endpoint contract is documented; feature ships in a later milestone |
| `NO_ADAPTERS` | 503 | Discovery refused to run because no source adapter is enabled |

**Rate limiting** — in-memory sliding window per client+scope
(`src/lib/security/rate-limit.ts`). Defaults: 60 req/min for mutations;
stricter: `discovery:run` 10/min, `wipe` 5/min.

**Validation** — every JSON body goes through `readJson(request, schema)`
(Zod v4). Query strings are parsed with `jobQuerySchema` (coercing).

---

## Profile & preferences

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/profile` | Full single profile (id `00000000-…-001`) + children |
| PUT | `/profile` | Validates `profileSchema`; writes personal info + education/skills/projects/experience/leadership/certifications |
| GET | `/preferences` | Role preferences + job preferences bundle |
| PUT | `/preferences` | Validates `preferencesSchema`; replaces bundle idempotently |

## Jobs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/jobs` | Filter/sort/paginate via query schema: `q`, `role`, `type`, `location`, `work_model`, `experience`, `skill`, `company`, `verification`, `min_score`, `max_score`, `posted_within`, `salary_min`, `duration`, `sort`, `page`, `page_size`, `sample` |
| GET | `/jobs/:id` | `{ job, verification, history, match }` — hydration for the details page |
| POST | `/jobs/:id` | 405 by design (use sub-routes) |
| POST | `/jobs/:id/save` | Body `{ saved: boolean }` → toggles persisted saved state |
| POST | `/jobs/:id/match` | Recomputes + persists the explainable match score |
| GET | `/jobs/:id/match` | Latest stored match |
| POST | `/jobs/:id/verify` | Appends a verification check + history entry (M3 will add live checks) |
| GET | `/jobs/:id/verification` | Current verification record |
| GET | `/jobs/:id/verification/history` | Chronological checks (never overwritten) |

## Discovery

Real source adapters (Greenhouse, Lever, Ashby) — see
[discovery-sources.md](./discovery-sources.md) for access methods, limits and
environment variables.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/discovery/run` | Body `{ trigger?: "manual"\|"dashboard_stale"\|"schedule", sources?: ["greenhouse"\|"lever"\|"ashby"] }` (empty body `{}` valid). **201** `{ run, note }` — validates, prevents duplicate runs, creates the run row and executes it *after* the response (`after()`), so the request never waits for the run. **409** `RUN_IN_PROGRESS` (process claim or a persisted pending/running row < 10 min old), **503** `NO_ADAPTERS`/`NO_TARGETS` (no source enabled / no configured target — never writes a fake run row), **400** invalid body, **429** rate limited |
| GET | `/discovery/run` | Adapter list (key, name, enabled, status, targets) + `ready` flag + latest run (never claims a running job) |
| GET | `/discovery/status` | `{ active, latest_run, recent_runs }` — recent runs for the status panel, newest first |
| POST | `/discovery/status` | (compat alias — same honest payload) |
| GET | `/discovery/status/:id` | Single run incl. `checkpoint` (phase, per-source results, budget remaining) for polling |

Run rows carry `pages_fetched`, `found_count`, `new_count`, `duplicate_count`,
`error`, `started_at`/`finished_at` and a `checkpoint` written **after every
source**, so a killed run still reports exactly what it managed to do. Per-source
outcomes (`success`/`partial`/`failure` + message) are persisted on
`job_sources` (`last_status`, `last_message`, `last_run_at`).

| Error code | Status | When |
| --- | --- | --- |
| `RUN_IN_PROGRESS` | 409 | Another run is active in this process, or a persisted run is younger than 10 minutes (older ones are marked `failed` — "no heartbeat" — and unblock automatically) |
| `NO_ADAPTERS` | 503 | No source enabled, or none of the requested `sources` are enabled |
| `NO_TARGETS` | 503 | Enabled sources have no configured board/slug targets |

## Applications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/applications` | All applications (+ job hydration) |
| POST | `/applications` | Create. Entering `applied`+ stages requires `confirmed_applied: true` → otherwise **422 `NEED_CONFIRMATION`** |
| PATCH | `/applications/:id` | Stage/notes/follow-up updates; writes an `application_events` history row |

Stages: `discovered → shortlisted → resume_prepared → ready_for_approval →
applied → recruiter_contacted → interview → offer | rejected | withdrawn`.

## Analytics & notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/analytics` | Same aggregate as the page; `?sample=false` excludes demo rows |
| GET | `/notifications` | Notification rows |
| PATCH | `/notifications` | Mark all read |

## Resumes (Milestone 5)

| Method | Path | Status |
| --- | --- | --- |
| GET | `/resumes/versions` | **Live** — reads real stored resumes + versions |
| POST | `/resumes/versions` | 501 — version creation ships with M5 |
| POST | `/resumes/upload` | 501 — contract: multipart PDF/DOCX ≤5 MB, server-side extraction returns a *review draft* |
| POST | `/resumes/tailor` | 501 — contract: job-specific resume grounded only in profile facts |
| POST | `/resumes/analyze` | 501 — contract: three scores (document quality, requirement coverage, evidence alignment) + suggestions; never an employer-ATS simulation |

## Outreach (Milestone 6)

| Method | Path | Status |
| --- | --- | --- |
| POST | `/outreach/draft` | 501 — contract: personalised drafts from verified public contacts; never guesses addresses |
| POST | `/outreach/send` | 501 — contract: explicit per-email approval; Gmail OAuth optional |

## Data & system

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Driver, DB health, Supabase configured, adapter readiness, AI provider presence |
| GET | `/export` | Full JSON dump of every collection (`content-disposition: attachment`) |
| POST | `/export` | Hint to use GET |
| POST | `/wipe` | **Requires `{ "confirm": true }`** (scope `personal_data`). Deletes profile content, preferences, saved jobs, matches, applications, resumes, recruiters, drafts, notifications; keeps sample listings + config. Rate-limited 5/min |
