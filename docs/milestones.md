# JobDedo — Milestone status

Work proceeds milestone-by-milestone (spec §24). Each milestone is only
"done" when lint, typecheck, tests and the production build pass.

## Milestone 1 — Existing project recovery & UI foundation ✅

- [x] Audit of the pre-existing scaffold; working code preserved
- [x] Design system from the supplied references (tokens, shadows, radii, Geist)
- [x] Application shell: collapsible sidebar, grouped nav, active states,
      global search, notifications, mobile nav, skip link
- [x] Overview dashboard (real persisted stats, recommendations, deadlines,
      follow-ups, discovery status, empty states)
- [x] Discover page: filters, sorting, pagination, save, sample banners
- [x] Job details page incl. **Source & Verification** (links, company
      questions, timeline, deadline & status, history, Reverify button)
- [x] Saved jobs, Applications (stage tracking + confirmation gate), Analytics
      (charts from real rows)
- [x] Master profile (RHF + Zod, 6 field arrays) and Preferences forms
- [x] Settings: driver/health, adapters, env presence, export, wipe dialog
- [x] Honest capability pages: Resume Studio, ATS Analyzer, Cold Email
      (501 contracts, real stored rows only)
- [x] Error/loading/not-found boundaries (Next 16 `retry` API)
- [x] 25 `/api/v1` routes with Zod + rate limiting
- [x] Dual data driver (`DataStore`: local JSON | Supabase) + `.env.example`
- [x] SQL migrations (supabase/migrations) + RLS
- [x] Unit tests for pure logic; CI workflow
- [x] README + docs (architecture, API, milestones)

## Milestone 2 — Real job discovery ✅

- [x] Permitted source adapters behind the existing registry — **Greenhouse,
      Lever, Ashby** are live (official public JSON endpoints, documented and
      verified in [discovery-sources.md](./discovery-sources.md)); sources
      without a permitted feed (LinkedIn, Naukri, Indeed, Internshala) stay
      listed as *not integrated* instead of being scraped
- [x] Ingestion → validation → normalisation → dedup pipeline
      (retrieve → validate → normalise → dedupe → persist → verify → match,
      bounded by request/job/verify/match budgets)
- [x] Idempotent persistence (never overwrite `first_discovered_at`; merges
      keep every original source link in `source_links`)
- [x] Refresh history, partial failure handling, retry/timeout budgets,
      duplicate-run locks (in-process claim + persisted <10 min row with
      stale-run recovery), per-source checkpoints
- [x] Sample rows stay labelled and excluded from real discovery statistics
      (Discover page shows real/sample counts; filters can hide sample rows)
- [x] Scheduled run **documented** — a ready-to-copy GitHub Actions workflow
      in [discovery-sources.md](./discovery-sources.md) (the endpoint is a
      plain bounded async operation; no workflow file is shipped so an
      undeployed repo does not fail on a timer)
- [x] Tests: adapters, normalisation, dedup, end-to-end pipeline (temp-dir
      store), migrations — 247 tests green

## Milestone 3 — Verification engine

- [ ] Link verification (HTTP + redirect + closed-page heuristics)
- [ ] Company verification (website, careers page, corroboration)
- [ ] Official-job confirmation (careers page / ATS match) with evidence URLs
- [ ] Deadline validation (`VALID/PASSED/NOT_SPECIFIED/UNKNOWN`) and employer
      status (`OPEN/CLOSED/REMOVED/UNKNOWN`)
- [ ] Deterministic scam-risk rules (fees, impersonation, unrealistic claims)
- [ ] Verification history + "Reverify now" wired to live checks
- [ ] Confidence scoring already implemented → wire to real check results

## Milestone 4 — AI matching

- [ ] Requirement extraction from job descriptions
- [ ] AI-assisted signals plugged into the existing weighted engine (the
      deterministic 7-factor score stays the source of truth)
- [ ] Eligibility warnings, role-based recommendations
- [ ] Provider abstraction (Gemini free tier / optional Ollama) with quota
      handling

## Milestone 5 — Resume Studio & ATS

- [ ] PDF/DOCX upload → server-side extraction → review draft gate
- [ ] Job-specific tailoring grounded in verified profile facts only
- [ ] Editing, version history, comparison, PDF/DOCX export
- [ ] ATS analysis: document quality / requirement coverage / evidence
      alignment + actionable suggestions (no proprietary-ATS claims)

## Milestone 6 — Outreach & applications

- [ ] Recruiter contact discovery with public evidence URLs (never guess
      addresses)
- [ ] Draft generation (outreach, follow-up, status, thank-you) — editable
- [ ] Approval-gated sending (Gmail OAuth optional, per-email consent)
- [ ] Follow-up management, richer application workflow

## Milestone 7 — Analytics, automation & deployment

- [ ] Scheduled discovery (GitHub Actions, finite runs)
- [ ] Notification surfacing, performance passes, security review
- [ ] Vercel deployment + Supabase migration instructions
- [ ] Documentation finalisation

---

## Known limitations

1. **Local mode only in practice** — no Supabase credentials were available
   during development, so the Supabase driver is written to the documented
   contract but has not been exercised against a live project. Apply
   `supabase/migrations/` to verify.
2. **Three discovery sources, not all boards** — Greenhouse, Lever and Ashby
   are real; every other source is honestly listed as *not integrated* (no
   permitted public feed — see
   [discovery-sources.md](./discovery-sources.md)). Duplicate-run prevention
   coordinates within one process; across separate serverless instances only
   the persisted 10-minute row applies (worst case: duplicate fetching, never
   duplicate rows).
3. **Verification is derived, not probed** — confidence/history UI is real;
   discovery runs probe *new* links (bounded), the full verification engine
   (company/careers/deadline/scam rules) arrives in M3.
4. **AI not wired** — provider env vars are read for status display only.
5. **Rate limiter is in-memory** — correct for single-instance local/dev use;
   a shared store (e.g. Upstash) is needed if scaling to multiple instances.
6. **Resume/outreach endpoints are 501 stubs** with documented contracts.
