-- JobDedo initial schema (Milestone 1)
--
-- This file is the database half of `src/lib/db/supabase-store.ts`. Every
-- table, column, unique index and foreign key below exists because the
-- driver depends on it:
--   * `jobs` embeds `company:companies(*)` and `source:job_sources(*)`
--     -> FKs jobs.company_id / jobs.source_id (PostgREST infers joins from FKs)
--   * `applications` embeds `events:application_events(*)`
--     -> FK application_events.application_id
--   * upserts use `onConflict: "job_id"` (job_verifications, job_matches),
--     `onConflict: "profile_id,job_id"` (saved_jobs) and `onConflict: "id"`
--     (profiles, job_preferences) -> matching unique indexes/PKs
--   * wipe() deletes by profile_id from application_events, ats_reports,
--     recruiters and notifications as well, so those four tables carry
--     profile_id (with the fixed single-profile default) even though their
--     TypeScript row types omit it.
--
-- Conventions:
--   * timestamps are timestamptz; date-only fields (start_date, closing_date,
--     ...) are `text` because validation allows "" (empty string), which a
--     Postgres `date` column would reject.
--   * string/enum arrays are jsonb — no array operators are used anywhere.
--   * single-user app: exactly one profile row, id
--     00000000-0000-4000-8000-000000000001 (seeded below, idempotently).
--   * sample job rows are NOT seeded here: local JSON mode seeds demo data,
--     Supabase mode starts empty by design (documented M1 limitation).
--
-- Idempotent: safe to re-run (`create table if not exists`, guarded seeds).
-- Row Level Security is enabled in 20261103120001_rls.sql.

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

create table if not exists profiles (
  id         uuid primary key default gen_random_uuid(),
  personal   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Master profile children                                             */
/* ------------------------------------------------------------------ */

create table if not exists education (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles (id) on delete cascade,
  institution     text not null default '',
  degree          text not null default '',
  branch          text not null default '',
  start_date      text not null default '',
  graduation_date text not null default '',
  cgpa            text not null default '',
  coursework      jsonb not null default '[]'::jsonb,
  sort_order      integer not null default 0
);

create table if not exists candidate_skills (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  category   text not null
    check (category in ('programming_languages','frameworks','databases','cloud','tools','soft_skills')),
  name       text not null,
  level      text not null default 'intermediate'
    check (level in ('beginner','intermediate','advanced')),
  years      numeric(4,1) check (years is null or (years >= 0 and years <= 60))
);

create table if not exists projects (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles (id) on delete cascade,
  title            text not null,
  description      text not null default '',
  technologies     jsonb not null default '[]'::jsonb,
  responsibilities jsonb not null default '[]'::jsonb,
  achievements     jsonb not null default '[]'::jsonb,
  metrics          text not null default '',
  github_url       text not null default '',
  live_demo_url    text not null default '',
  sort_order       integer not null default 0
);

create table if not exists experiences (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles (id) on delete cascade,
  organization     text not null,
  role             text not null,
  start_date       text not null default '',
  end_date         text not null default '',
  responsibilities jsonb not null default '[]'::jsonb,
  achievements     jsonb not null default '[]'::jsonb,
  sort_order       integer not null default 0
);

create table if not exists leadership (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles (id) on delete cascade,
  organization  text not null,
  position      text not null,
  start_date    text not null default '',
  end_date      text not null default '',
  contributions jsonb not null default '[]'::jsonb,
  sort_order    integer not null default 0
);

create table if not exists certifications (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles (id) on delete cascade,
  name           text not null,
  issuer         text not null default '',
  issued_date    text not null default '',
  credential_url text not null default '',
  sort_order     integer not null default 0
);

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

create table if not exists role_preferences (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  role       text not null,
  is_custom  boolean not null default false,
  priority   integer not null default 0
);

create table if not exists job_preferences (
  id                               uuid primary key default gen_random_uuid(),
  profile_id                       uuid not null unique references profiles (id) on delete cascade,
  employment_types                 jsonb not null default '[]'::jsonb,
  experience_levels                jsonb not null default '[]'::jsonb,
  custom_experience_range          text not null default '',
  locations                        jsonb not null default '[]'::jsonb,
  work_models                      jsonb not null default '[]'::jsonb,
  prefer_internship_duration_days  integer not null default 60,
  paid_internship_only             boolean not null default false,
  min_stipend                      integer,
  min_salary                       integer,
  compensation_flexible            boolean not null default true,
  required_skills                  jsonb not null default '[]'::jsonb,
  preferred_technologies           jsonb not null default '[]'::jsonb,
  industries                       jsonb not null default '[]'::jsonb,
  company_size                     text not null default 'any',
  company_stage                    text not null default 'any'
    check (company_stage in ('any','startup','established')),
  application_deadline_within_days integer,
  excluded_companies               jsonb not null default '[]'::jsonb,
  excluded_roles                   jsonb not null default '[]'::jsonb,
  search_frequency_hours           integer not null default 24,
  updated_at                       timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Discovery: companies, sources, jobs                                 */
/* ------------------------------------------------------------------ */

create table if not exists companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  domain                  text not null default '',
  official_website_url    text not null default '',
  website_status          text not null default 'not_checked'
    check (website_status in ('confirmed','uncertain','not_found','failed','conflict','not_checked')),
  careers_page_url        text not null default '',
  careers_discovery_method text not null default '',
  careers_evidence_url    text not null default '',
  careers_status          text not null default 'not_checked'
    check (careers_status in ('confirmed','uncertain','not_found','failed','conflict','not_checked')),
  description             text not null default '',
  logo_url                text not null default '',
  industry                text not null default '',
  size_bucket             text not null default '',
  last_checked_at         timestamptz,
  created_at              timestamptz not null default now()
);

create table if not exists job_sources (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  name         text not null,
  base_url     text not null default '',
  kind         text not null
    check (kind in ('job_board','company_careers','ats_api','feed')),
  enabled      boolean not null default false,
  last_run_at  timestamptz,
  last_status  text not null default 'not_run'
    check (last_status in ('success','partial','failure','not_run')),
  last_message text not null default ''
);

create table if not exists jobs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies (id) on delete cascade,
  source_id             uuid references job_sources (id) on delete set null,
  title                 text not null,
  role_tags             jsonb not null default '[]'::jsonb,
  description           text not null default '',
  city                  text not null default '',
  country               text not null default '',
  location_text         text not null default '',
  work_model            text not null default 'onsite'
    check (work_model in ('remote','hybrid','onsite')),
  employment_type       text not null
    check (employment_type in ('internship','full_time','part_time','contract','freelance','unknown')),
  experience_level      text not null default 'entry_level'
    check (experience_level in ('student','fresher','entry_level','0_1_years','1_2_years','custom','unknown')),
  salary_min            integer,
  salary_max            integer,
  salary_currency       text not null default '',
  salary_period         text not null default 'month'
    check (salary_period in ('month','year','one_time')),
  stipend_amount        integer,
  duration_days         integer,
  skills                jsonb not null default '[]'::jsonb,
  requirements          jsonb not null default '{}'::jsonb,
  original_url          text not null default '',
  application_url       text not null default '',
  source_job_id         text not null default '',
  -- Partial unique: adapters may store NULL/'' until a real dedupe key exists.
  dedupe_key            text,
  posted_at             timestamptz,
  closing_date          text,
  first_discovered_at   timestamptz not null default now(),
  last_checked_at       timestamptz,
  last_verified_at      timestamptz,
  next_check_at         timestamptz,
  verification_status   text not null default 'UNVERIFIED'
    check (verification_status in ('VERIFIED','NEEDS_REVIEW','UNVERIFIED','CLOSED','EXPIRED','INVALID')),
  verification_confidence numeric(5,2) not null default 0,
  job_status            text not null default 'open'
    check (job_status in ('open','closed','removed','unknown')),
  is_sample             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Verification & matching                                             */
/* ------------------------------------------------------------------ */

create table if not exists job_verifications (
  id                      uuid primary key default gen_random_uuid(),
  -- Unique per job: saveVerification() upserts on job_id.
  job_id                  uuid not null unique references jobs (id) on delete cascade,
  company_website_url     text not null default '',
  website_status          text not null default 'not_checked'
    check (website_status in ('confirmed','uncertain','not_found','failed','conflict','not_checked')),
  careers_page_url        text not null default '',
  careers_status          text not null default 'not_checked'
    check (careers_status in ('confirmed','uncertain','not_found','failed','conflict','not_checked')),
  careers_discovery_method text not null default '',
  careers_evidence_url    text not null default '',
  exact_job_status        text not null default 'not_checked'
    check (exact_job_status in ('confirmed_official','confirmed_platform','not_found_official','unable_to_verify','conflicting','not_checked')),
  exact_job_url           text not null default '',
  deadline_status         text not null default 'not_specified'
    check (deadline_status in ('valid','expired','not_specified','uncertain')),
  job_status              text not null default 'open'
    check (job_status in ('open','closed','removed','unknown')),
  application_link_status text not null default 'not_checked'
    check (application_link_status in ('working','broken','redirected','unable_to_check','not_checked')),
  confidence_score        numeric(5,2) not null default 0,
  confidence_breakdown    jsonb not null default '{}'::jsonb,
  notes                   text not null default '',
  checked_at              timestamptz,
  verified_at             timestamptz,
  updated_at              timestamptz not null default now()
);

create table if not exists job_verification_history (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs (id) on delete cascade,
  check_type   text not null default '',
  result       text not null default 'not_checked'
    check (result in ('confirmed','uncertain','not_found','failed','conflict','not_checked')),
  evidence_url text not null default '',
  notes        text not null default '',
  source       text not null default '',
  created_at   timestamptz not null default now()
);

create table if not exists job_matches (
  id                   uuid primary key default gen_random_uuid(),
  -- Unique per job: upsertMatch() upserts on job_id (one live score per job).
  job_id               uuid not null unique references jobs (id) on delete cascade,
  profile_id           uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  score                numeric(5,2) not null default 0,
  breakdown            jsonb not null default '{}'::jsonb,
  matched_skills       jsonb not null default '[]'::jsonb,
  missing_skills       jsonb not null default '[]'::jsonb,
  relevant_projects    jsonb not null default '[]'::jsonb,
  eligibility_warnings jsonb not null default '[]'::jsonb,
  recommendations      jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now()
);

create table if not exists saved_jobs (
  profile_id uuid not null references profiles (id) on delete cascade,
  job_id     uuid not null references jobs (id) on delete cascade,
  saved_at   timestamptz not null default now(),
  -- Composite PK satisfies upsert onConflict "profile_id,job_id".
  primary key (profile_id, job_id)
);

/* ------------------------------------------------------------------ */
/* Discovery runs                                                      */
/* ------------------------------------------------------------------ */

create table if not exists discovery_runs (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  status          text not null default 'pending'
    check (status in ('pending','running','completed','failed','cancelled')),
  trigger         text not null default 'manual'
    check (trigger in ('manual','dashboard_stale','schedule')),
  queries         jsonb not null default '[]'::jsonb,
  checkpoint      jsonb not null default '{}'::jsonb,
  pages_fetched   integer not null default 0,
  found_count     integer not null default 0,
  new_count       integer not null default 0,
  duplicate_count integer not null default 0,
  error           text not null default '',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

/* ------------------------------------------------------------------ */
/* Resume / ATS / outreach (Milestone 5-6, created now so later        */
/* migrations never have to reorder foreign keys)                      */
/* ------------------------------------------------------------------ */

create table if not exists resumes (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  title              text not null default '',
  storage_path       text not null default '',
  bucket             text not null default '',
  source             text not null default 'upload'
    check (source in ('upload','generated')),
  current_version_id uuid,
  created_at         timestamptz not null default now()
);

create table if not exists resume_versions (
  id                  uuid primary key default gen_random_uuid(),
  resume_id           uuid not null references resumes (id) on delete cascade,
  profile_id          uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  version_number      integer not null default 1,
  raw_text            text not null default '',
  parsed              jsonb,
  tailored_for_job_id uuid references jobs (id) on delete set null,
  created_at          timestamptz not null default now()
);

create table if not exists ats_reports (
  id                 uuid primary key default gen_random_uuid(),
  resume_version_id  uuid not null references resume_versions (id) on delete cascade,
  job_id             uuid references jobs (id) on delete set null,
  -- profile_id exists for wipe(), which deletes by profile_id.
  profile_id         uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  document_quality   numeric(5,2) not null default 0,
  job_coverage       numeric(5,2) not null default 0,
  evidence_alignment numeric(5,2) not null default 0,
  report             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create table if not exists recruiters (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies (id) on delete set null,
  -- profile_id exists for wipe(), which deletes by profile_id.
  profile_id          uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  name                text not null default '',
  title               text not null default '',
  linkedin_url        text not null default '',
  email               text not null default '',
  contact_page_url    text not null default '',
  evidence_url        text not null default '',
  verification_status text not null default 'not_found'
    check (verification_status in ('public_confirmed','uncertain','not_found')),
  notes               text not null default '',
  created_at          timestamptz not null default now()
);

create table if not exists email_drafts (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  job_id       uuid references jobs (id) on delete set null,
  recruiter_id uuid references recruiters (id) on delete set null,
  draft_type   text not null default 'internship_outreach'
    check (draft_type in ('internship_outreach','recruiter_intro','hiring_manager_intro','follow_up','referral_request','thank_you')),
  subject      text not null default '',
  body         text not null default '',
  status       text not null default 'draft'
    check (status in ('draft','approved','sent')),
  created_at   timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

create table if not exists applications (
  id                          uuid primary key default gen_random_uuid(),
  profile_id                  uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  job_id                      uuid references jobs (id) on delete set null,
  company_name                text not null,
  job_title                   text not null,
  original_url                text not null default '',
  application_url             text not null default '',
  match_score                 numeric(5,2),
  verification_status_at_apply text
    check (verification_status_at_apply is null or verification_status_at_apply
      in ('VERIFIED','NEEDS_REVIEW','UNVERIFIED','CLOSED','EXPIRED','INVALID')),
  resume_version_id           uuid references resume_versions (id) on delete set null,
  email_draft_id              uuid references email_drafts (id) on delete set null,
  applied_at                  timestamptz,
  stage                       text not null default 'discovered'
    check (stage in ('discovered','shortlisted','resume_prepared','ready_for_approval','applied','recruiter_contacted','interview','rejected','offer','withdrawn')),
  notes                       text not null default '',
  follow_up_at                timestamptz,
  interview_at                timestamptz,
  interview_details           text not null default '',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table if not exists application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  -- profile_id exists for wipe(), which deletes by profile_id.
  profile_id     uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  from_stage     text
    check (from_stage is null or from_stage
      in ('discovered','shortlisted','resume_prepared','ready_for_approval','applied','recruiter_contacted','interview','rejected','offer','withdrawn')),
  to_stage       text not null
    check (to_stage in ('discovered','shortlisted','resume_prepared','ready_for_approval','applied','recruiter_contacted','interview','rejected','offer','withdrawn')),
  note           text not null default '',
  created_at     timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Notifications & integrations                                        */
/* ------------------------------------------------------------------ */

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  -- profile_id exists for wipe(), which deletes by profile_id.
  profile_id uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  type       text not null
    check (type in ('strong_match','deadline','job_closed','verification_change','follow_up','discovery_failure')),
  title      text not null default '',
  body       text not null default '',
  link       text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists integration_accounts (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null,
  kind       text not null check (kind in ('ai','email')),
  status     text not null default 'not_configured'
    check (status in ('connected','not_configured','error')),
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Planned tables (Milestone 2+ / 5) — created now so the schema is    */
/* complete and later milestones only need data + code.                 */
/* ------------------------------------------------------------------ */

-- Scheduled searches (Milestone 2): which queries run, how often, when next.
create table if not exists search_schedules (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  enabled         boolean not null default false,
  queries         jsonb not null default '[]'::jsonb,
  frequency_hours integer not null default 24,
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- AI usage ledger (Milestone 5): one row per model call, for quota honesty.
create table if not exists ai_usage_events (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  provider   text not null default '',
  model      text not null default '',
  operation  text not null default '',
  tokens_in  integer,
  tokens_out integer,
  status     text not null default 'ok',
  created_at timestamptz not null default now()
);

-- Discovery lock (Milestone 2): prevents overlapping runs (see docs/architecture.md).
create table if not exists discovery_locks (
  name        text primary key,
  holder      text not null default '',
  acquired_at timestamptz not null default now(),
  expires_at  timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Resume Studio - Projects (Milestone 5-6 extended)                   */
/* ------------------------------------------------------------------ */

create table if not exists resume_projects (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null
    default '00000000-0000-4000-8000-000000000001' references profiles (id) on delete cascade,
  name             text not null default '',
  original_resume_id uuid references resumes (id) on delete set null,
  active_version_id uuid,
  template_id      text not null default 'minimal',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists resume_source_versions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references resume_projects (id) on delete cascade,
  version_number    integer not null default 1,
  latex_source      text not null default '',
  structured_content jsonb not null default '{}'::jsonb,
  template_id       text not null default 'minimal',
  created_at        timestamptz not null default now()
);

create table if not exists resume_compilations (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references resume_projects (id) on delete cascade,
  source_version_id uuid not null references resume_source_versions (id) on delete cascade,
  status           text not null default 'pending'
    check (status in ('pending','success','failed')),
  pdf_artifact_id  uuid,
  log              text not null default '',
  warnings         jsonb not null default '[]'::jsonb,
  errors           jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

create table if not exists resume_artifacts (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references resume_projects (id) on delete cascade,
  compilation_id   uuid references resume_compilations (id) on delete set null,
  file_name        text not null default '',
  mime_type        text not null default 'application/pdf',
  storage_reference text not null default '',
  content_hash     text not null default '',
  created_at       timestamptz not null default now()
);
-- PostgreSQL supports IF EXISTS when naming the table, but not IF NOT EXISTS
-- there. Guard constraints explicitly so this idempotent migration is valid.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_resume_projects_active_version' and conrelid = 'public.resume_projects'::regclass) then
    alter table resume_projects add constraint fk_resume_projects_active_version foreign key (active_version_id) references resume_source_versions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_resume_source_versions_project' and conrelid = 'public.resume_source_versions'::regclass) then
    alter table resume_source_versions add constraint fk_resume_source_versions_project foreign key (project_id) references resume_projects (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_resume_compilations_pdf_artifact' and conrelid = 'public.resume_compilations'::regclass) then
    alter table resume_compilations add constraint fk_resume_compilations_pdf_artifact foreign key (pdf_artifact_id) references resume_artifacts (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_resume_artifacts_compilation' and conrelid = 'public.resume_artifacts'::regclass) then
    alter table resume_artifacts add constraint fk_resume_artifacts_compilation foreign key (compilation_id) references resume_compilations (id) on delete set null;
  end if;
end $$;


/* ------------------------------------------------------------------ */
/* Indexes                                                             */
/* ------------------------------------------------------------------ */

create index if not exists idx_education_profile on education (profile_id);
create index if not exists idx_candidate_skills_profile on candidate_skills (profile_id);
create index if not exists idx_projects_profile on projects (profile_id);
create index if not exists idx_experiences_profile on experiences (profile_id);
create index if not exists idx_leadership_profile on leadership (profile_id);
create index if not exists idx_certifications_profile on certifications (profile_id);
create index if not exists idx_role_preferences_profile on role_preferences (profile_id, priority);

create index if not exists idx_companies_name on companies (name);

create index if not exists idx_jobs_company on jobs (company_id);
create index if not exists idx_jobs_source on jobs (source_id);
create index if not exists idx_jobs_first_discovered on jobs (first_discovered_at desc);
create index if not exists idx_jobs_posted on jobs (posted_at desc);
create index if not exists idx_jobs_status on jobs (job_status);
create index if not exists idx_jobs_verification on jobs (verification_status);
create unique index if not exists uq_jobs_dedupe_key on jobs (dedupe_key)
  where dedupe_key is not null and dedupe_key <> '';

create index if not exists idx_job_verification_history_job
  on job_verification_history (job_id, created_at desc);
create index if not exists idx_job_matches_created on job_matches (created_at desc);
create index if not exists idx_saved_jobs_job on saved_jobs (job_id);

create index if not exists idx_discovery_runs_started on discovery_runs (started_at desc);
create index if not exists idx_discovery_runs_profile on discovery_runs (profile_id, started_at desc);

create index if not exists idx_resumes_profile on resumes (profile_id);
create index if not exists idx_resumes_created on resumes (created_at desc);
create index if not exists idx_resume_versions_profile on resume_versions (profile_id);
create index if not exists idx_resume_versions_resume on resume_versions (resume_id);
create index if not exists idx_resume_versions_created on resume_versions (created_at desc);
create index if not exists idx_ats_reports_profile on ats_reports (profile_id);
create index if not exists idx_ats_reports_created on ats_reports (created_at desc);
create index if not exists idx_recruiters_profile on recruiters (profile_id);
create index if not exists idx_recruiters_company on recruiters (company_id);
create index if not exists idx_recruiters_created on recruiters (created_at desc);
create index if not exists idx_email_drafts_profile on email_drafts (profile_id);
create index if not exists idx_email_drafts_created on email_drafts (created_at desc);

create index if not exists idx_applications_profile on applications (profile_id, created_at desc);
create index if not exists idx_applications_stage on applications (profile_id, stage);
create index if not exists idx_applications_created on applications (created_at desc);
create index if not exists idx_application_events_app
  on application_events (application_id, created_at desc);
create index if not exists idx_application_events_profile on application_events (profile_id);

create index if not exists idx_notifications_profile on notifications (profile_id, created_at desc);
create index if not exists idx_notifications_unread on notifications (profile_id)
  where read_at is null;
create index if not exists idx_notifications_created on notifications (created_at desc);

create index if not exists idx_search_schedules_profile on search_schedules (profile_id);
create index if not exists idx_ai_usage_events_profile on ai_usage_events (profile_id, created_at desc);

create index if not exists idx_resume_projects_profile on resume_projects (profile_id);
create index if not exists idx_resume_projects_created on resume_projects (created_at desc);
create index if not exists idx_resume_source_versions_project on resume_source_versions (project_id);
create index if not exists idx_resume_source_versions_created on resume_source_versions (created_at desc);
create index if not exists idx_resume_compilations_project on resume_compilations (project_id);
create index if not exists idx_resume_compilations_created on resume_compilations (created_at desc);
create index if not exists idx_resume_artifacts_project on resume_artifacts (project_id);

/* ------------------------------------------------------------------ */
/* Seeds (idempotent)                                                  */
/* ------------------------------------------------------------------ */

-- The single, persistent profile row the whole app is built around.
insert into profiles (id, personal, created_at, updated_at)
values (
  '00000000-0000-4000-8000-000000000001',
  '{
    "full_name": "", "email": "", "phone": "", "city": "", "country": "",
    "headline": "", "summary": "", "linkedin_url": "", "github_url": "",
    "portfolio_url": "", "other_links": []
  }'::jsonb,
  now(),
  now()
)
on conflict (id) do nothing;

-- Default role preferences (parity with local JSON mode, which seeds the
-- same three roles; the Preferences page rewrites them wholesale).
insert into role_preferences (id, profile_id, role, is_custom, priority)
select v.id, v.profile_id, v.role, v.is_custom, v.priority
from (values
  ('00000000-0000-4000-8000-0000000000b1'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Data Analyst', false, 0),
  ('00000000-0000-4000-8000-0000000000b2'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Data Scientist', false, 1),
  ('00000000-0000-4000-8000-0000000000b3'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Software Developer', false, 2)
) as v (id, profile_id, role, is_custom, priority)
where not exists (
  select 1 from role_preferences where profile_id = '00000000-0000-4000-8000-000000000001'
);

-- Default job preferences (values mirror defaultPreferences() in
-- src/lib/db/seed.ts). Guarded on existence so a user-edited row survives
-- re-running the migration.
insert into job_preferences (
  id, profile_id, employment_types, experience_levels, custom_experience_range,
  locations, work_models, prefer_internship_duration_days, paid_internship_only,
  min_stipend, min_salary, compensation_flexible, required_skills,
  preferred_technologies, industries, company_size, company_stage,
  application_deadline_within_days, excluded_companies, excluded_roles,
  search_frequency_hours, updated_at
)
select
  '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001',
  '["internship","full_time"]'::jsonb,
  '["student","fresher","entry_level","0_1_years"]'::jsonb,
  '',
  '["India","Worldwide remote"]'::jsonb,
  '["remote","hybrid"]'::jsonb,
  60, false, null, null, true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'any', 'any', null, '[]'::jsonb, '[]'::jsonb, 24, now()
where not exists (
  select 1 from job_preferences where profile_id = '00000000-0000-4000-8000-000000000001'
);
