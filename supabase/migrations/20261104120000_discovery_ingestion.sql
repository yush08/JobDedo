/**
 * Milestone 2 — real job discovery ingestion.
 *
 * Adds the columns the discovery pipeline needs to persist what it saw and
 * when, without ever overwriting history:
 *
 *   canonical_url            tracking-stripped URL used for deduplication
 *   last_discovered_at       most recent run that saw this listing
 *   last_discovery_run_id    run id of that sighting (text: no FK so a wiped
 *                            or pruned run never cascades into job rows)
 *   source_links             every source the vacancy was seen on, so merged
 *                            duplicates keep ALL original listing links
 *
 * Also widens two check constraints: sources that do not publish employment
 * type / experience level now store the honest value 'unknown' instead of a
 * guessed one. On a fresh database the init migration already declares the
 * widened lists; the drop/add below makes an existing database converge.
 *
 * Idempotent: `add column if not exists`, `create index if not exists`,
 * `drop constraint if exists`.
 */

alter table jobs
  add column if not exists canonical_url text,
  add column if not exists last_discovered_at timestamptz,
  add column if not exists last_discovery_run_id text,
  add column if not exists source_links jsonb not null default '[]'::jsonb;

create index if not exists idx_jobs_canonical_url on jobs (canonical_url);

-- Column-level checks are auto-named `<table>_<column>_check`.
alter table jobs drop constraint if exists jobs_employment_type_check;
alter table jobs add constraint jobs_employment_type_check
  check (employment_type in
    ('internship','full_time','part_time','contract','freelance','unknown'));

alter table jobs drop constraint if exists jobs_experience_level_check;
alter table jobs add constraint jobs_experience_level_check
  check (experience_level in
    ('student','fresher','entry_level','0_1_years','1_2_years','custom','unknown'));
