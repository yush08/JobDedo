# JobDedo

**Find jobs. Get noticed. Get hired.**

A personal, AI-powered job discovery and application assistant for students,
freshers and early-career professionals. JobDedo discovers opportunities,
**verifies** them with visible evidence, **matches** them to your master
profile with explainable scores, and tracks your applications — without ever
fabricating a job, a link, a score or a statistic.

> **Status: Milestone 1 (foundation) complete.** See
> [`docs/milestones.md`](docs/milestones.md) for what ships next.

---

## Table of contents

- [What works today](#what-works-today)
- [Quick start](#quick-start)
- [Local mode vs Supabase mode](#local-mode-vs-supabase-mode)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Architecture at a glance](#architecture-at-a-glance)
- [Honesty rules (product invariants)](#honesty-rules-product-invariants)
- [API](#api)
- [Database](#database)
- [Testing & CI](#testing--ci)
- [Deployment](#deployment)
- [Documentation](#documentation)

---

## What works today

**Milestone 1 — foundation & UI**

| Area | Status |
| --- | --- |
| Application shell | Collapsible sidebar, grouped nav, global search, notifications, mobile nav, skip link |
| Overview dashboard | Real persisted stats, recommendations, deadlines, follow-ups, discovery status |
| Discover | **Run discovery** (real Greenhouse/Lever/Ashby listings with source, original link, discovery time, progress and per-source failures), filters (role, type, location, work model, skills, verification, score…), sorting, pagination, save |
| Job details | Full description, eligibility, match explanation, **Source & Verification** (links, company checks, timeline, deadline, history, Reverify) |
| Saved jobs | Shortlist ranked by match score |
| Applications | Stage tracking with status history; confirmation gate for post-submission stages |
| Analytics | Charts computed strictly from stored rows (toggle sample rows off) |
| Master profile | Full RHF + Zod form: personal, education, skills, projects, experience, leadership, certifications |
| Preferences | Roles, employment types, locations, work model, compensation, search frequency |
| Settings | Driver/health status, adapter list, env-var presence, JSON export, personal-data wipe |
| Resume Studio / ATS / Cold Email | Honest capability pages with real API contracts (stubs return 501) |
| API | 25 versioned `/api/v1` routes with Zod validation + rate limiting |
| Data layer | Dual driver: local JSON store **or** Supabase PostgreSQL behind one `DataStore` interface |
| Quality | `tsc --noEmit` clean, ESLint 0 errors, unit tests, production build |

**Not yet implemented** (by design — never faked): the verification engine's
live checks (M3), AI matching services (M4), resume upload/tailor/analyze
(M5), outreach drafting/sending (M6), and deployment hardening (M7). Real
discovery (M2) ships with three permitted sources — see
[`docs/discovery-sources.md`](docs/discovery-sources.md); every other source
is listed honestly as *not integrated*.

---

## Quick start

```bash
# 1. Install dependencies (Node 20+)
npm install

# 2. Configure environment — optional! Local mode works with zero config.
cp .env.example .env.local

# 3. Run
npm run dev
# → http://localhost:3000 (opens directly to the Overview dashboard)

# 4. Verify
npm run lint
npm run typecheck
npm test
npm run build
```

No login, no signup, no auth pages — the app is single-user by design.

---

## Local mode vs Supabase mode

JobDedo selects its storage driver at runtime:

| `JOBDEDO_DATA_DRIVER` | Behaviour |
| --- | --- |
| `auto` (default) | Supabase when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise the local file store |
| `local` | Force `.data/jobdedo.local.json` (git-ignored, atomic writes, seeded with clearly-labelled sample rows) |
| `supabase` | Force PostgreSQL; throws a clear error if unconfigured |

Both drivers implement the same [`DataStore`](src/lib/db/types.ts) contract, so
swapping drivers changes nothing above that layer. The Supabase driver uses the
**service-role key on the server only** — it is never imported by a client
component. JobDedo does **not** use Supabase Auth (single-user app).

---

## Environment variables

Everything is optional for local development. Copy `.env.example` and fill in
what you need — the full annotated list lives there. Summary:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public base URL for links |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only PostgreSQL access |
| `SUPABASE_STORAGE_BUCKET` | Private resume bucket (M5) |
| `JOBDEDO_DATA_DRIVER` | `auto` \| `local` \| `supabase` |
| `JOBDEDO_AI_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | AI abstraction (M4+) |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Optional local inference |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail OAuth send (M6, always user-approved) |
| `DISCOVERY_SOURCES_ENABLED`, `DISCOVERY_GREENHOUSE_BOARDS`, `DISCOVERY_LEVER_POSTINGS`, `DISCOVERY_ASHBY_BOARDS` | Which sources a run may fetch (defaults work out of the box) |
| `JOBDEDO_DISCOVERY_MAX_REQUESTS_PER_RUN`, `JOBDEDO_DISCOVERY_CONCURRENCY`, `JOBDEDO_DISCOVERY_TIMEOUT_MS`, `JOBDEDO_DISCOVERY_MAX_JOBS_PER_SOURCE`, `JOBDEDO_DISCOVERY_VERIFY_LIMIT`, `JOBDEDO_DISCOVERY_MATCH_LIMIT` | Bounded discovery budgets ([details](docs/discovery-sources.md#environment-variables)) |

Secrets stay server-side. Nothing in `.env.example` is required to run.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (0 errors required) |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, one run) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Coverage report (V8) |

---

## Architecture at a glance

```
src/
├── app/                      # Next.js App Router
│   ├── (dashboard)/          # Shell + pages: overview, discover, saved,
│   │   │                     #   applications, analytics, profile,
│   │   │                     #   preferences, settings, resume, ats, outreach
│   │   ├── error.tsx         # Error boundary (error + retry)
│   │   ├── loading.tsx       # Streaming fallback
│   │   └── not-found.tsx
│   └── api/v1/               # 25 versioned routes (Zod + rate limits)
├── components/               # UI: layout, jobs, verification, dashboard,
│                             #   profile, preferences, applications, form, ui
├── features/                 # Pure logic (unit-tested)
│   ├── verification/         # Confidence scoring, recheck derivation
│   ├── matching/             # Explainable 7-factor match score
│   ├── jobs/                 # Query/filter/sort pipeline
│   ├── analytics/            # Aggregate from real rows only
│   └── discovery/            # Real adapters (Greenhouse/Lever/Ashby),
│                             #   normalise, dedupe, pipeline, run control
├── lib/
│   ├── db/                   # DataStore contract + local & supabase drivers
│   ├── server/loaders.ts     # Server-side page loaders (behind Suspense)
│   ├── api/                  # Response helpers, guards, validation
│   ├── security/rate-limit.ts
│   └── validation/schemas.ts # Zod v4 schemas
├── config/navigation.ts      # Single source for nav items
└── types/index.ts            # Domain types
supabase/migrations/          # PostgreSQL schema + RLS
tests/                        # Vitest unit tests
docs/                         # Architecture, API, discovery sources, milestones
```

**Data flow:** server components read the database directly through
`src/lib/server/loaders.ts` (each loader starts with `await connection()` so
pages render per request under Next 16 `cacheComponents`). Mutations go
through `/api/v1` route handlers via client fetch + `router.refresh()`.

---

## Honesty rules (product invariants)

These are enforced in code, not just intentions:

1. **Every job is traceable** — no source URL, no listing. Sample rows are
   flagged `is_sample`, badged `SAMPLE` and banner-documented; they can be
   hidden everywhere (e.g. `?sample=false`).
2. **Every verification claim has evidence** — statuses are derived from
   stored checks with URLs and timestamps; unknowns are labelled "Not
   found" / "Could not verify", never upgraded.
3. **Every match score is explainable** — the 7-factor breakdown (30/20/15/
   10/10/10/5) is shown next to the score; it is never described as an
   employer's ATS score or a hiring probability.
4. **Every resume is grounded** — planned M5 generation may only rewrite
   facts already in the profile.
5. **All actions are user-controlled** — sending email requires explicit
   per-message approval; discovery refresh is bounded and never pretends a
   background process exists.
6. **Stubs are honest** — unimplemented endpoints return HTTP `501` with a
   documented contract; discovery with no enabled adapters returns `503
   NO_ADAPTERS`.

---

## API

All routes live under `/api/v1`, validate input with Zod and are
rate-limited. Highlights:

```
GET/PUT   /api/v1/profile            GET/PUT   /api/v1/preferences
GET       /api/v1/jobs               GET       /api/v1/jobs/:id
POST      /api/v1/jobs/:id/save      POST      /api/v1/jobs/:id/match
POST      /api/v1/jobs/:id/verify    GET       /api/v1/jobs/:id/verification
GET       /api/v1/jobs/:id/verification-history
POST      /api/v1/discovery/run      GET       /api/v1/discovery/status[/:id]
GET       /api/v1/applications       POST      /api/v1/applications
PATCH     /api/v1/applications/:id
GET       /api/v1/analytics          GET       /api/v1/notifications
GET       /api/v1/resumes/versions   POST      /api/v1/resumes/{upload,tailor,analyze}  → 501 (M5)
POST      /api/v1/outreach/{draft,send}                                              → 501 (M6)
GET       /api/v1/export             POST      /api/v1/wipe
GET       /api/v1/health
```

Full contracts: [`docs/api.md`](docs/api.md).

---

## Database

PostgreSQL schema in [`supabase/migrations/`](supabase/migrations/) — ~29
normalised tables (profiles, companies, jobs, job_verifications,
job_verification_history, discovery_runs, applications, application_events,
resumes, resume_versions, ats_reports, recruiters, email_drafts,
notifications, …) with UUID primary keys, foreign keys, unique constraints,
indexes, UTC timestamps, CHECK validation and **Row Level Security enabled
with no public policies** (service-role-only access).

---

## Testing & CI

```bash
npm test              # unit tests for pure logic:
                      #   confidence scoring, match scoring, job query,
                      #   analytics aggregation, Zod schemas, rate limiter,
                      #   local store
                      # + discovery: adapters, normalisation, dedupe,
                      #   end-to-end pipeline, migrations
```

`.github/workflows/ci.yml` runs lint → typecheck → tests → build on every
push and pull request.

---

## Deployment

Target stack (all free tier, ₹0 recurring):

- **Vercel Hobby** — `npm run build`, set the env vars above
- **Supabase Free** — run `supabase/migrations/` SQL in order (or
  `supabase db push`)
- **GitHub Actions** — CI plus a ready-to-copy finite scheduled discovery
  workflow ([`docs/discovery-sources.md`](docs/discovery-sources.md#scheduled-discovery-github-actions))
- **Gemini free tier / optional Ollama** — AI features from M4 onward

No AWS, Docker or Kubernetes. No always-on servers: discovery runs are
bounded, resumable, idempotent and duplicate-run protected.

---

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Layers, data flow, design tokens, drivers |
| [`docs/api.md`](docs/api.md) | Every endpoint, status codes, contracts |
| [`docs/discovery-sources.md`](docs/discovery-sources.md) | Sources, access methods, limits, env vars, running/scheduling discovery |
| [`docs/milestones.md`](docs/milestones.md) | M1–M7 status and what's next |
| [`.env.example`](.env.example) | Annotated environment variables |
