# JobDedo — Architecture

## 1. Principles

1. **Honesty over illusion.** No fabricated jobs, links, scores, statistics or
   background processes. Unimplemented surfaces say so (HTTP 501/503 with a
   documented contract, `M5`/`M6` badges, "not implemented" copy).
2. **Pure core, thin edges.** Business rules live in pure functions under
   `src/features/*` (unit-tested); route handlers and pages are thin adapters.
3. **One data contract.** Every storage consumer talks to `DataStore`
   (`src/lib/db/types.ts`). Two drivers implement it; nothing above the
   interface knows which one is active.
4. **Secrets stay server-side.** The Supabase service-role key is only ever
   imported by `server-only` modules.

## 2. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16.4 (App Router, Turbopack) | `cacheComponents: true`; `params`/`searchParams` are Promises |
| Language | TypeScript strict | Route types via `next typegen` |
| Styling | Tailwind CSS v4 + design tokens | `src/app/globals.css` |
| Components | shadcn/ui on **Base UI** | `render` prop (not `asChild`); Select/Dialog/Menu APIs differ from Radix |
| Forms | React Hook Form + Zod v4 | `useForm<z.input<S>, unknown, z.output<S>>` |
| Server state | Direct DB reads in server components | Mutations: fetch `/api/v1` + `router.refresh()` |
| Client state | TanStack Query (search, polling), `useSyncExternalStore` (sidebar) | |
| DB | Supabase PostgreSQL (free tier) | Service role, RLS on, no public policies |
| Local dev DB | `.data/jobdedo.local.json` | Atomic writes, seeded labelled samples |
| Tests | Vitest | Node env, `server-only` stubbed |

## 3. Request flow

```
┌─────────────┐   RSC read (Suspense + connection())   ┌──────────────┐
│   Page      │ ─────────────────────────────────────▶ │ loaders.ts   │──┐
│ (server)    │                                        └──────────────┘  │
└─────────────┘                                                          ▼
                                                                   ┌───────────┐
┌─────────────┐   fetch /api/v1/* (Zod + rate limit)               │ DataStore │
│ Client UI   │ ─────────────────────────────────────▶ Route ────▶ │ local /   │
│ (forms,     │   ◀── JSON ── router.refresh() ──▶ re-render        │ supabase  │
│  buttons)   │                                                    └───────────┘
└─────────────┘
```

- Every page wraps its loader in `<Suspense>` with a page-specific skeleton.
- Every loader starts with `await connection()` so data is read per request
  (without it, `cacheComponents` would freeze data at build time).
- The dashboard `error.tsx` receives `{ error, retry }` (stable since
  Next 16.3).

## 4. Data layer

```ts
interface DataStore {
  driver: "local" | "supabase";
  health(); ensureProfile(); saveProfile(); …;
  listJobsFull(); getJobFull(); setJobSaved(); …
  getVerification(); appendVerificationHistory(); …
  listApplications(); createApplication(); updateApplication(); …
  listResumes(); listRecruiters(); listEmailDrafts(); listAtsReports(); …
  ensureSource(); updateSourceStatus(); ingestJob(); createDiscoveryRun();
  getDiscoveryRun(); listDiscoveryRuns(); …
  exportAll(); wipe();
}
```

Driver selection (`src/lib/db/index.ts`, cached on `globalThis`):

| `JOBDEDO_DATA_DRIVER` | Result |
| --- | --- |
| `auto` (default) | Supabase if both credentials set, else local |
| `local` | force file store |
| `supabase` | force PostgreSQL (throws when unconfigured) |

The **single profile** is created idempotently with the fixed UUID
`00000000-0000-4000-8000-000000000001` — no auth, no duplicate rows, ever.

Local store guarantees: serialised writes, atomic replace (temp file + rename),
seeded labelled sample data on first run.

## 5. Feature modules (pure, unit-tested)

| Module | Responsibility |
| --- | --- |
| `features/verification/confidence.ts` | 30/20/20/15/10/5 weighted confidence, 85/65 bands, hard caps (e.g. ≤64 when closed/expired) |
| `features/verification/recheck.ts` | Derive headline status (`VERIFIED/NEEDS_REVIEW/UNVERIFIED/CLOSED/INVALID`) from stored checks |
| `features/matching/score.ts` | 7-factor explainable match score (30/20/15/10/10/10/5), caps for closed/sample rows |
| `features/jobs/query.ts` | Filter → sort → paginate pipeline + facet extraction |
| `features/analytics/aggregate.ts` | All dashboard/analytics numbers from real rows; sample rows separable |
| `features/discovery/service.ts` | Adapter registry — Greenhouse/Lever/Ashby **enabled** (verified public feeds); internshala/linkedin/naukri/indeed listed as honest `not integrated` statuses; staleness maths |
| `features/discovery/config.ts` | Env-driven run configuration (sources, targets, budgets) with safe defaults; builds adapters |
| `features/discovery/normalize.ts` | Raw listing → `JobDraft`: HTML stripping, URL canonicalisation, field inference from published text only, compensation/section/skill parsing |
| `features/discovery/dedupe.ts` | Conservative same-vacancy rules (source+id, canonical URL, composite key, gated title/description similarity) |
| `features/discovery/ingest.ts` | Idempotent create/merge — never overwrites `first_discovered_at`, keeps every source link |
| `features/discovery/pipeline.ts` | Bounded run execution: adapters → normalise → dedupe → persist → verify → match, checkpointing after every source |
| `features/discovery/run.ts` | Run validation, in-process claim + persisted <10 min duplicate-run lock, stale-run recovery |

## 6. Design system

Tokens in `src/app/globals.css`:

| Token | Value |
| --- | --- |
| `--background` | `#F8F9FB` |
| `--card` / surface | `#FFFFFF` |
| `--primary` | `#3563F5` |
| `--foreground` | `#17191F` |
| `--muted-foreground` | `#6B7280` |
| `--border` | `#D8DCE4` |
| `--success` / `--warning` / `--error` | `#15803D` / `#D97706` / `#DC2626` |
| `--font-sans` | Geist (Inter fallback) |
| radii | 8–12px (`--radius`) |

Utilities: `.card-shadow`, `.neo-shadow` (subtle offset shadows), chart color
scale `--chart-1..5`.

**Visual language:** modern SaaS + subtle neo-brutalism — thin 1px borders,
restrained shadows, generous whitespace, muted stat cards with large numerals,
left sidebar with grouped nav, top search bar, card-based sections. No heavy
gradients, glassmorphism or cartoon styling.

Shared building blocks: `PageHeader`, `EmptyState`, `StatCard`,
`SampleDataBanner`, `VerificationBadge`, `MatchScore`, skeletons, `Field`,
`StringListEditor`.

## 7. Navigation

`src/config/navigation.ts` is the single source of truth:

- **Main:** Overview, Discover, Saved, Resume Studio (M5), ATS (M5),
  Cold Email (M6), Applications, Analytics
- **Bottom:** My Profile, Preferences, Settings

Sidebar collapses (persisted via `useSyncExternalStore`, SSR-safe), mobile
navigation lives in a Sheet in the topbar, global search is a command dialog,
notifications drop over the API.

## 8. Security

- Service-role key server-only (`import "server-only"` in `src/lib/db/*`,
  `src/lib/supabase/*`).
- RLS enabled on all tables, **no public policies** — access only via service
  role.
- All API input validated with Zod; rate limiting per route
  (`src/lib/security/rate-limit.ts`), stricter on wipe/discovery.
- External pages, job descriptions and uploads are treated as untrusted input
  (M5+ AI calls get system-prompt isolation).
- `target=_blank` links carry `rel="noopener noreferrer"`.
- User-controlled deletion: `POST /api/v1/wipe` requires `{confirm: true}`.
- No credential logging; error messages never echo secrets.

## 9. Free-tier constraints

- No always-on workers: a discovery run executes in Next `after()` right
  after the `POST /discovery/run` response, bounded by request/job/verify/
  match budgets, idempotent, and duplicate-run protected (in-process claim +
  persisted pending/running row < 10 min, stale runs auto-failed).
- Adapters carry per-request timeouts, a response size cap, a shared request
  budget and per-target failure recording — one dead board never kills a run.
  Sources without a permitted public feed stay `not integrated`
  (no scraping, no CAPTCHA/login bypass).
- AI calls are lazy, cached where possible, and never assumed unlimited.
- GitHub Actions runs **finite scheduled discovery** — a ready-to-copy
  workflow in [discovery-sources.md](./discovery-sources.md#scheduled-discovery-github-actions),
  not a permanent agent.
