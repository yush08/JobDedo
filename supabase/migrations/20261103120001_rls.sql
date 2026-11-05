-- JobDedo Row Level Security (Milestone 1)
--
-- JobDedo is a single-user app with NO auth: there is no login, no session,
-- and no Supabase Auth. Every query the app runs goes through the server
-- using the service-role key (`SUPABASE_SERVICE_ROLE_KEY`), which bypasses
-- RLS. The anon and authenticated roles therefore get an empty database:
-- RLS is enabled on every table and NO policies are granted to anyone.
--
-- This is the "$0 infra, secrets server-only" requirement in code:
--   * service role  -> full access (server-side only, never shipped to the
--                      browser; see src/lib/supabase/server.ts)
--   * anon          -> RLS blocks every row (no SELECT policies exist)
--   * authenticated -> RLS blocks every row (no auth is used anyway)
--
-- Idempotent: `alter table ... enable row level security` is a no-op when
-- already enabled. Tables are listed explicitly so this file doubles as the
-- authoritative table inventory (29 = 26 runtime tables used by the driver
-- + 3 planned tables created in 20261103120000_init_schema.sql).

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    -- profile + master profile children (7)
    'profiles',
    'education',
    'candidate_skills',
    'projects',
    'experiences',
    'leadership',
    'certifications',
    -- preferences (2)
    'role_preferences',
    'job_preferences',
    -- discovery (5)
    'companies',
    'job_sources',
    'jobs',
    'discovery_runs',
    'discovery_locks',
    -- verification & matching (4)
    'job_verifications',
    'job_verification_history',
    'job_matches',
    'saved_jobs',
    -- applications (2)
    'applications',
    'application_events',
    -- resume / ATS / outreach (5)
    'resumes',
    'resume_versions',
    'ats_reports',
    'recruiters',
    'email_drafts',
    -- notifications & integrations (2)
    'notifications',
    'integration_accounts',
    -- planned (2)
    'search_schedules',
    'ai_usage_events',
    -- resume studio (4)
    'resume_projects',
    'resume_source_versions',
    'resume_compilations',
    'resume_artifacts'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
  end loop;
end $$;

-- Intentionally NO `create policy` statements: with RLS enabled and zero
-- policies, anon/authenticated read nothing. Only the service role (which
-- bypasses RLS) can touch data, and it never leaves the server.
--
-- Do not add public policies later without an explicit auth design — see
-- docs/architecture.md ("RLS enabled on all tables, no public policies").
