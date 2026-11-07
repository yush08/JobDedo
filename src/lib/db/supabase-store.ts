import "server-only";

import { SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  Application,
  ApplicationEvent,
  Company,
  DiscoveryRun,
  EmailDraft,
  ID,
  IsoDateTime,
  Job,
  JobMatch,
  JobSource,
  JobVerification,
  JobWithRelations,
  PersonalInfo,
  Resume,
  ResumeArtifact,
  ResumeCompilation,
  ResumeProject,
  ResumeSourceVersion,
  ResumeVersion,
  AtsReport,
  VerificationHistoryEntry,
} from "@/types";
import type { Collections, DataStore, PreferencesBundle, StoreHealth } from "./types";
import type {
  CompanyDraft,
  IngestJobContext,
  JobDraft,
} from "@/features/discovery/types";
import type { IngestContext } from "@/features/discovery/ingest";
import { createJobFromDraft, mergeDiscoveredJob } from "@/features/discovery/ingest";
import { candidateDedupeKeys, findExistingJob } from "@/features/discovery/dedupe";
import { DEFAULT_PROFILE_ID, defaultPreferences } from "./seed";

/**
 * Supabase PostgreSQL driver (server-only, service role).
 *
 * IMPORTANT / HONEST STATUS: this driver is written against the schema in
 * `supabase/migrations`. It has NOT been exercised against a live Supabase
 * project during development because no credentials were available. Treat the
 * first run against a real project as a smoke test; failures surface as
 * thrown errors with the Postgres message attached.
 */

const now = (): IsoDateTime => new Date().toISOString();
const uuid = (): ID => crypto.randomUUID();

type Row<T> = T extends Array<infer _> ? never : T;

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Supabase ${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${what}: no data returned`);
  return result.data;
}

export class SupabaseStore implements DataStore {
  readonly driver = "supabase" as const;

  constructor(private readonly db: SupabaseClient) {}

  async health(): Promise<StoreHealth> {
    try {
      const { error } = await this.db.from("profiles").select("id").limit(1);
      if (error) return { ok: false, driver: "supabase", message: error.message };
      return { ok: true, driver: "supabase", message: "Connected to Supabase PostgreSQL" };
    } catch (err) {
      return {
        ok: false,
        driver: "supabase",
        message: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  /* ---------------- profile ---------------- */

  async getProfile(): Promise<Collections["profile"]> {
    const { data, error } = await this.db
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Supabase profiles: ${error.message}`);
    return (data as Row<Collections["profile"]>) ?? null;
  }

  async ensureProfile() {
    const existing = await this.getProfile();
    if (existing) return existing;
    const { data, error } = await this.db
      .from("profiles")
      .upsert(
        {
          id: DEFAULT_PROFILE_ID,
          personal: emptyPersonal(),
          created_at: now(),
          updated_at: now(),
        },
        { onConflict: "id", ignoreDuplicates: false },
      )
      .select()
      .single();
    if (error) throw new Error(`Supabase ensureProfile: ${error.message}`);
    return data as NonNullable<Collections["profile"]>;
  }

  async saveProfile(personal: PersonalInfo) {
    const profile = await this.ensureProfile();
    const { data, error } = await this.db
      .from("profiles")
      .update({ personal, updated_at: now() })
      .eq("id", profile.id)
      .select()
      .single();
    if (error) throw new Error(`Supabase saveProfile: ${error.message}`);
    return data as NonNullable<Collections["profile"]>;
  }

  private async profileId(): Promise<ID> {
    return (await this.ensureProfile()).id;
  }

  async listProfileChildren() {
    const profileId = await this.profileId();
    const [education, skills, projects, experiences, leadership, certifications] =
      await Promise.all([
        this.db.from("education").select("*").eq("profile_id", profileId).order("sort_order"),
        this.db.from("candidate_skills").select("*").eq("profile_id", profileId),
        this.db.from("projects").select("*").eq("profile_id", profileId).order("sort_order"),
        this.db.from("experiences").select("*").eq("profile_id", profileId).order("sort_order"),
        this.db.from("leadership").select("*").eq("profile_id", profileId).order("sort_order"),
        this.db.from("certifications").select("*").eq("profile_id", profileId).order("sort_order"),
      ]);
    return {
      education: unwrap(education, "education") as Collections["education"],
      skills: unwrap(skills, "candidate_skills") as Collections["skills"],
      projects: unwrap(projects, "projects") as Collections["projects"],
      experiences: unwrap(experiences, "experiences") as Collections["experiences"],
      leadership: unwrap(leadership, "leadership") as Collections["leadership"],
      certifications: unwrap(certifications, "certifications") as Collections["certifications"],
    };
  }

  async saveProfileChildren(children: {
    education: Collections["education"];
    skills: Collections["skills"];
    projects: Collections["projects"];
    experiences: Collections["experiences"];
    leadership: Collections["leadership"];
    certifications: Collections["certifications"];
  }) {
    const profileId = await this.profileId();
    const tables: [string, { id?: string }[]][] = [
      ["education", children.education],
      ["candidate_skills", children.skills],
      ["projects", children.projects],
      ["experiences", children.experiences],
      ["leadership", children.leadership],
      ["certifications", children.certifications],
    ];
    for (const [table, rows] of tables) {
      const { error: delError } = await this.db
        .from(table)
        .delete()
        .eq("profile_id", profileId);
      if (delError) throw new Error(`Supabase clear ${table}: ${delError.message}`);
      if (rows.length === 0) continue;
      const payload = rows.map((row) => ({
        ...row,
        id: row.id || uuid(),
        profile_id: profileId,
      }));
      const { error } = await this.db.from(table).insert(payload);
      if (error) throw new Error(`Supabase insert ${table}: ${error.message}`);
    }
  }

  /* ---------------- preferences ---------------- */

  async getPreferences(): Promise<PreferencesBundle> {
    const profileId = await this.profileId();
    const [roles, prefs] = await Promise.all([
      this.db.from("role_preferences").select("*").eq("profile_id", profileId).order("priority"),
      this.db.from("job_preferences").select("*").eq("profile_id", profileId).maybeSingle(),
    ]);
    const roleRows = unwrap(roles, "role_preferences") as Collections["roles"];
    const prefRow = (prefs.data as Row<Collections["preferences"]>) ?? null;
    return {
      roles: roleRows,
      preferences: prefRow ?? defaultPreferences(profileId),
    };
  }

  async savePreferences(bundle: PreferencesBundle): Promise<PreferencesBundle> {
    const profileId = await this.profileId();

    await this.db.from("role_preferences").delete().eq("profile_id", profileId);
    if (bundle.roles.length) {
      const { error } = await this.db.from("role_preferences").insert(
        bundle.roles.map((r) => ({
          ...r,
          id: r.id || uuid(),
          profile_id: profileId,
        })),
      );
      if (error) throw new Error(`Supabase save roles: ${error.message}`);
    }

    const payload = {
      ...bundle.preferences,
      id: bundle.preferences.id || uuid(),
      profile_id: profileId,
      updated_at: now(),
    };
    const { data, error } = await this.db
      .from("job_preferences")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) throw new Error(`Supabase save preferences: ${error.message}`);

    return { roles: bundle.roles, preferences: data as typeof payload };
  }

  /* ---------------- jobs ---------------- */

  async listJobsFull(): Promise<JobWithRelations[]> {
    const [jobs, saved, matches] = await Promise.all([
      this.db
        .from("jobs")
        .select("*, company:companies(*), source:job_sources(*)")
        .order("first_discovered_at", { ascending: false }),
      this.db.from("saved_jobs").select("job_id"),
      this.db.from("job_matches").select("*").order("created_at", { ascending: false }),
    ]);
    const jobRows = unwrap(jobs, "jobs") as Array<
      Job & { company: Collections["companies"][number] | null; source: JobSource | null }
    >;
    const savedIds = new Set(
      (unwrap(saved, "saved_jobs") as { job_id: ID }[]).map((r) => r.job_id),
    );
    const latestMatch = new Map<ID, JobMatch>();
    for (const m of unwrap(matches, "job_matches") as JobMatch[]) {
      if (!latestMatch.has(m.job_id)) latestMatch.set(m.job_id, m);
    }
    return jobRows.map((row) => {
      const { company, source, ...job } = row;
      return {
        ...job,
        company,
        source,
        saved: savedIds.has(job.id),
        match_score: latestMatch.get(job.id)?.score ?? null,
      };
    });
  }

  async getJobFull(id: ID): Promise<JobWithRelations | null> {
    const all = await this.listJobsFull();
    return all.find((j) => j.id === id) ?? null;
  }

  async listCompanies() {
    const { data, error } = await this.db.from("companies").select("*").order("name");
    if (error) throw new Error(`Supabase companies: ${error.message}`);
    return (data ?? []) as Collections["companies"];
  }

  async listSources() {
    const { data, error } = await this.db.from("job_sources").select("*").order("name");
    if (error) throw new Error(`Supabase job_sources: ${error.message}`);
    return (data ?? []) as Collections["sources"];
  }

  async listSavedJobIds(): Promise<ID[]> {
    const { data, error } = await this.db.from("saved_jobs").select("job_id");
    if (error) throw new Error(`Supabase saved_jobs: ${error.message}`);
    return (data ?? []).map((r) => r.job_id);
  }

  async setJobSaved(jobId: ID, saved: boolean): Promise<boolean> {
    const profileId = await this.profileId();
    if (saved) {
      const { error } = await this.db
        .from("saved_jobs")
        .upsert(
          { profile_id: profileId, job_id: jobId, saved_at: now() },
          { onConflict: "profile_id,job_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(`Supabase save job: ${error.message}`);
    } else {
      const { error } = await this.db
        .from("saved_jobs")
        .delete()
        .eq("profile_id", profileId)
        .eq("job_id", jobId);
      if (error) throw new Error(`Supabase unsave job: ${error.message}`);
    }
    return saved;
  }

  /* ---------------- verification ---------------- */

  async getVerification(jobId: ID): Promise<JobVerification | null> {
    const { data, error } = await this.db
      .from("job_verifications")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) throw new Error(`Supabase verification: ${error.message}`);
    return (data as JobVerification | null) ?? null;
  }

  async saveVerification(verification: JobVerification): Promise<void> {
    const { error } = await this.db
      .from("job_verifications")
      .upsert(verification, { onConflict: "job_id" });
    if (error) throw new Error(`Supabase save verification: ${error.message}`);
  }

  async updateJobVerificationFields(jobId: ID, fields: Partial<Job>): Promise<void> {
    const { error } = await this.db
      .from("jobs")
      .update({ ...fields, updated_at: now() })
      .eq("id", jobId);
    if (error) throw new Error(`Supabase update job verification: ${error.message}`);
  }

  async listVerificationHistory(jobId: ID): Promise<VerificationHistoryEntry[]> {
    const { data, error } = await this.db
      .from("job_verification_history")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase verification history: ${error.message}`);
    return (data ?? []) as VerificationHistoryEntry[];
  }

  async appendVerificationHistory(entry: Omit<VerificationHistoryEntry, "id">) {
    const { error } = await this.db
      .from("job_verification_history")
      .insert({ ...entry, id: uuid() });
    if (error) throw new Error(`Supabase verification history insert: ${error.message}`);
  }

  /* ---------------- matches ---------------- */

  async getLatestMatch(jobId: ID): Promise<JobMatch | null> {
    const { data, error } = await this.db
      .from("job_matches")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Supabase match: ${error.message}`);
    return (data as JobMatch | null) ?? null;
  }

  async upsertMatch(match: Omit<JobMatch, "id" | "created_at">): Promise<JobMatch> {
    const payload = { ...match, id: uuid(), created_at: now() };
    const { data, error } = await this.db
      .from("job_matches")
      .upsert(payload, { onConflict: "job_id" })
      .select()
      .single();
    if (error) throw new Error(`Supabase upsert match: ${error.message}`);
    return data as JobMatch;
  }

  /* ---------------- discovery ---------------- */

  async getDiscoveryRun(id: ID): Promise<DiscoveryRun | null> {
    const { data, error } = await this.db
      .from("discovery_runs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase discovery run: ${error.message}`);
    return (data as DiscoveryRun | null) ?? null;
  }

  async getLatestDiscoveryRun(): Promise<DiscoveryRun | null> {
    const { data, error } = await this.db
      .from("discovery_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Supabase discovery run: ${error.message}`);
    return (data as DiscoveryRun | null) ?? null;
  }

  async createDiscoveryRun(
    run: Omit<DiscoveryRun, "id" | "started_at" | "finished_at">,
  ): Promise<DiscoveryRun> {
    const payload = { ...run, id: uuid(), started_at: now(), finished_at: null };
    const { data, error } = await this.db
      .from("discovery_runs")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(`Supabase create discovery run: ${error.message}`);
    return data as DiscoveryRun;
  }

  async updateDiscoveryRun(id: ID, patch: Partial<DiscoveryRun>) {
    const { data, error } = await this.db
      .from("discovery_runs")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update discovery run: ${error.message}`);
    return (data as DiscoveryRun | null) ?? null;
  }

  async listDiscoveryRuns(limit = 20): Promise<DiscoveryRun[]> {
    const { data, error } = await this.db
      .from("discovery_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(Math.max(1, limit));
    if (error) throw new Error(`Supabase discovery runs: ${error.message}`);
    return (data ?? []) as DiscoveryRun[];
  }

  /* ---------------- discovery ingestion ---------------- */

  private static escapeIlike(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  }

  async ensureCompany(draft: CompanyDraft): Promise<Company> {
    const domain = draft.domain.trim().toLowerCase();
    if (domain) {
      const byDomain = await this.db
        .from("companies")
        .select("*")
        .eq("domain", domain)
        .limit(1)
        .maybeSingle();
      if (byDomain.error) {
        throw new Error(`Supabase ensureCompany: ${byDomain.error.message}`);
      }
      if (byDomain.data) {
        return this.fillCompanyGaps(byDomain.data as Company, draft);
      }
    }

    const byName = await this.db
      .from("companies")
      .select("*")
      .ilike("name", SupabaseStore.escapeIlike(draft.name))
      .limit(1)
      .maybeSingle();
    if (byName.error) throw new Error(`Supabase ensureCompany: ${byName.error.message}`);
    if (byName.data) return this.fillCompanyGaps(byName.data as Company, draft);

    const payload: Company = {
      id: uuid(),
      name: draft.name,
      domain: draft.domain,
      official_website_url: draft.official_website_url,
      website_status: "not_checked",
      careers_page_url: draft.careers_page_url,
      careers_discovery_method: draft.careers_page_url
        ? "Published by the job source"
        : "",
      careers_evidence_url: "",
      careers_status: "not_checked",
      description: "",
      logo_url: "",
      industry: draft.industry,
      size_bucket: "",
      last_checked_at: null,
      created_at: now(),
    };
    const { data, error } = await this.db
      .from("companies")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(`Supabase ensureCompany insert: ${error.message}`);
    return data as Company;
  }

  private fillCompanyGaps(company: Company, draft: CompanyDraft): Company {
    const patched: Partial<Company> = {};
    if (!company.official_website_url && draft.official_website_url) {
      patched.official_website_url = draft.official_website_url;
    }
    if (!company.careers_page_url && draft.careers_page_url) {
      patched.careers_page_url = draft.careers_page_url;
      patched.careers_discovery_method = "Published by the job source";
    }
    if (!company.industry && draft.industry) patched.industry = draft.industry;
    if (!company.domain && draft.domain) patched.domain = draft.domain;
    return { ...company, ...patched };
  }

  async ensureSource(input: {
    key: string;
    name: string;
    base_url: string;
    kind: JobSource["kind"];
  }): Promise<JobSource> {
    const existing = await this.db
      .from("job_sources")
      .select("*")
      .eq("key", input.key)
      .maybeSingle();
    if (existing.error) throw new Error(`Supabase ensureSource: ${existing.error.message}`);
    if (existing.data) return existing.data as JobSource;

    const payload: JobSource = {
      id: uuid(),
      key: input.key,
      name: input.name,
      base_url: input.base_url,
      kind: input.kind,
      enabled: false,
      last_run_at: null,
      last_status: "not_run",
      last_message: "Not run yet.",
    };
    const inserted = await this.db
      .from("job_sources")
      .insert(payload)
      .select()
      .single();
    if (inserted.error) {
      // A concurrent run may have created it first; re-read instead of failing.
      const again = await this.db
        .from("job_sources")
        .select("*")
        .eq("key", input.key)
        .maybeSingle();
      if (again.error) throw new Error(`Supabase ensureSource: ${again.error.message}`);
      if (again.data) return again.data as JobSource;
      throw new Error(`Supabase ensureSource insert: ${inserted.error.message}`);
    }
    return inserted.data as JobSource;
  }

  /** Locate the stored row a draft refers to (all three dedupe rules). */
  private async findJobForDraft(
    draft: JobDraft,
    company: Company,
  ): Promise<Job | null> {
    const byKey = await this.db
      .from("jobs")
      .select("*")
      .in("dedupe_key", candidateDedupeKeys(draft))
      .limit(1)
      .maybeSingle();
    if (byKey.error) throw new Error(`Supabase dedupe lookup: ${byKey.error.message}`);
    if (byKey.data) return byKey.data as Job;

    if (draft.canonical_url) {
      const byUrl = await this.db
        .from("jobs")
        .select("*")
        .eq("canonical_url", draft.canonical_url)
        .limit(1)
        .maybeSingle();
      if (byUrl.error) throw new Error(`Supabase dedupe lookup: ${byUrl.error.message}`);
      if (byUrl.data) return byUrl.data as Job;
    }

    // Composite / source-link rules need the shared matcher, so scan only this
    // company's rows (bounded) instead of the whole jobs table.
    const scoped = await this.db
      .from("jobs")
      .select("*")
      .eq("company_id", company.id)
      .limit(500);
    if (scoped.error) throw new Error(`Supabase dedupe lookup: ${scoped.error.message}`);
    return findExistingJob(
      (scoped.data ?? []) as Job[],
      draft,
      new Map([[company.id, company.name]]),
    );
  }

  async ingestJob(
    draft: JobDraft,
    context: IngestJobContext,
  ): Promise<{ job: Job; created: boolean }> {
    const company = await this.ensureCompany(draft.company);
    const source = await this.ensureSource({
      key: draft.source_key,
      name: draft.source_name,
      base_url: draft.source_base_url,
      kind: draft.source_kind,
    });
    const ctx: IngestContext = {
      company_id: company.id,
      source_id: source.id,
      ...context,
    };

    const existing = await this.findJobForDraft(draft, company);
    if (existing) {
      const merged = mergeDiscoveredJob(existing, draft, ctx);
      const { data, error } = await this.db
        .from("jobs")
        .update(merged)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new Error(`Supabase merge job: ${error.message}`);
      return { job: data as Job, created: false };
    }

    const job = createJobFromDraft(draft, ctx);
    const { data, error } = await this.db.from("jobs").insert(job).select().single();
    if (error) throw new Error(`Supabase insert job: ${error.message}`);
    return { job: data as Job, created: true };
  }

  async updateSourceStatus(
    key: string,
    patch: Partial<
      Pick<JobSource, "enabled" | "last_run_at" | "last_status" | "last_message">
    >,
  ): Promise<JobSource | null> {
    const { data, error } = await this.db
      .from("job_sources")
      .update(patch)
      .eq("key", key)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update source: ${error.message}`);
    return (data as JobSource | null) ?? null;
  }

  /* ---------------- applications ---------------- */

  async listApplications(): Promise<Application[]> {
    const { data, error } = await this.db
      .from("applications")
      .select("*, events:application_events(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase applications: ${error.message}`);
    return (data ?? []) as Application[];
  }

  async createApplication(
    input: Omit<Application, "id" | "events" | "created_at" | "updated_at" | "profile_id">,
  ): Promise<Application> {
    const profileId = await this.profileId();
    const id = uuid();
    const ts = now();
    const { data, error } = await this.db
      .from("applications")
      .insert({
        ...input,
        id,
        profile_id: profileId,
        created_at: ts,
        updated_at: ts,
      })
      .select()
      .single();
    if (error) throw new Error(`Supabase create application: ${error.message}`);

    const { error: eventError } = await this.db.from("application_events").insert({
      id: uuid(),
      application_id: id,
      from_stage: null,
      to_stage: input.stage,
      note: "Application created",
      created_at: ts,
    });
    if (eventError) {
      throw new Error(`Supabase create application event: ${eventError.message}`);
    }

    return { ...(data as Application), events: [] };
  }

  async updateApplication(
    id: ID,
    patch: Partial<Application>,
    event?: { from: Application["stage"]; to: Application["stage"]; note: string },
  ): Promise<Application | null> {
    const { events: _e, id: _id, profile_id: _p, created_at: _c, ...rest } = patch;
    const { data, error } = await this.db
      .from("applications")
      .update({ ...rest, updated_at: now() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update application: ${error.message}`);
    if (!data) return null;

    if (event && event.from !== event.to) {
      const { error: eventError } = await this.db.from("application_events").insert({
        id: uuid(),
        application_id: id,
        from_stage: event.from,
        to_stage: event.to,
        note: event.note,
        created_at: now(),
      });
      if (eventError) {
        throw new Error(`Supabase application event: ${eventError.message}`);
      }
    }

    const events = await this.db
      .from("application_events")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false });
    if (events.error) {
      throw new Error(`Supabase application events: ${events.error.message}`);
    }
    return {
      ...(data as Application),
      events: (events.data ?? []) as ApplicationEvent[],
    };
  }

  /* ---------------- milestone 5/6 ---------------- */

  async listResumes() {
    const { data, error } = await this.db.from("resumes").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase resumes: ${error.message}`);
    return (data ?? []) as Collections["resumes"];
  }
  async listResumeVersions() {
    const { data, error } = await this.db
      .from("resume_versions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase resume_versions: ${error.message}`);
    return (data ?? []) as Collections["resumeVersions"];
  }
  async createResume(
    input: Omit<Resume, "id" | "created_at">,
  ): Promise<Resume> {
    const { data, error } = await this.db
      .from("resumes")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume: ${error.message}`);
    return (data as Resume) ?? input;
  }
  async createResumeVersion(
    input: Omit<ResumeVersion, "id" | "created_at">,
  ): Promise<ResumeVersion> {
    const { data, error } = await this.db
      .from("resume_versions")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume version: ${error.message}`);
    return (data as ResumeVersion) ?? input;
  }
  async updateResumeVersion(
    id: ID,
    patch: Partial<
      Pick<ResumeVersion, "raw_text" | "parsed" | "tailored_for_job_id">
    >,
  ): Promise<ResumeVersion | null> {
    const { data, error } = await this.db
      .from("resume_versions")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update resume version: ${error.message}`);
    return (data as ResumeVersion | null) ?? null;
  }
  async updateResumeSourceVersion(
    id: ID,
    patch: Partial<
      Pick<ResumeSourceVersion, "latex_source" | "structured_content" | "template_id">
    >,
  ): Promise<ResumeSourceVersion | null> {
    const { data, error } = await this.db
      .from("resume_source_versions")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update resume source version: ${error.message}`);
    return (data as ResumeSourceVersion | null) ?? null;
  }
  async deleteResumeSourceVersion(id: ID): Promise<boolean> {
    const { error, count } = await this.db
      .from("resume_source_versions")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw new Error(`Supabase delete resume source version: ${error.message}`);
    return (count ?? 0) > 0;
  }
  async updateResumeCurrentVersion(
    resumeId: ID,
    versionId: ID,
  ): Promise<Resume> {
    const { data, error } = await this.db
      .from("resumes")
      .update({ current_version_id: versionId })
      .eq("id", resumeId)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update resume current version: ${error.message}`);
    if (!data) throw new Error(`Resume ${resumeId} not found`);
    return data as Resume;
  }
  async listRecruiters() {
    const { data, error } = await this.db.from("recruiters").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase recruiters: ${error.message}`);
    return (data ?? []) as Collections["recruiters"];
  }
  async listEmailDrafts() {
    const { data, error } = await this.db.from("email_drafts").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase email_drafts: ${error.message}`);
    return (data ?? []) as Collections["emailDrafts"];
  }
  async createEmailDraft(
    input: Omit<EmailDraft, "id" | "created_at">,
  ): Promise<EmailDraft> {
    const { data, error } = await this.db
      .from("email_drafts")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create email draft: ${error.message}`);
    return (data as EmailDraft) ?? (input as unknown as EmailDraft);
  }
  async updateEmailDraft(
    id: ID,
    patch: Partial<
      Pick<
        EmailDraft,
        "subject" | "body" | "draft_type" | "recruiter_id" | "job_id" | "status"
      >
    >,
  ): Promise<EmailDraft | null> {
    const { data, error } = await this.db
      .from("email_drafts")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update email draft: ${error.message}`);
    return (data as EmailDraft | null) ?? null;
  }
  async listAtsReports() {
    const { data, error } = await this.db.from("ats_reports").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase ats_reports: ${error.message}`);
    return (data ?? []) as Collections["atsReports"];
  }

  /* ---------------- resume studio - projects ---------------- */

  async listResumeProjects(): Promise<ResumeProject[]> {
    const { data, error } = await this.db
      .from("resume_projects")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`Supabase resume_projects: ${error.message}`);
    return (data ?? []) as Collections["resumeProjects"];
  }

  async createResumeProject(
    input: Omit<ResumeProject, "id" | "created_at" | "updated_at">,
  ): Promise<ResumeProject> {
    const { data, error } = await this.db
      .from("resume_projects")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume project: ${error.message}`);
    return (data as ResumeProject) ?? input;
  }

  async updateResumeProject(
    id: ID,
    patch: Partial<
      Pick<ResumeProject, "name" | "active_version_id" | "template_id">
    >,
  ): Promise<ResumeProject | null> {
    const { data, error } = await this.db
      .from("resume_projects")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update resume project: ${error.message}`);
    return (data as ResumeProject | null) ?? null;
  }

  async getResumeProject(id: ID): Promise<ResumeProject | null> {
    const { data, error } = await this.db
      .from("resume_projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase get resume project: ${error.message}`);
    return (data as ResumeProject | null) ?? null;
  }

  /* ---------------- resume studio - source versions ---------------- */

  async listResumeSourceVersions(projectId: ID): Promise<ResumeSourceVersion[]> {
    const { data, error } = await this.db
      .from("resume_source_versions")
      .select("*")
      .eq("project_id", projectId)
      .order("version_number", { ascending: false });
    if (error) throw new Error(`Supabase resume_source_versions: ${error.message}`);
    return (data ?? []) as Collections["resumeSourceVersions"];
  }

  async createResumeSourceVersion(
    input: Omit<ResumeSourceVersion, "id" | "created_at">,
  ): Promise<ResumeSourceVersion> {
    const { data, error } = await this.db
      .from("resume_source_versions")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume source version: ${error.message}`);
    return (data as ResumeSourceVersion) ?? input;
  }

  async getResumeSourceVersion(id: ID): Promise<ResumeSourceVersion | null> {
    const { data, error } = await this.db
      .from("resume_source_versions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase get resume source version: ${error.message}`);
    return (data as ResumeSourceVersion | null) ?? null;
  }

  /* ---------------- resume studio - compilations ---------------- */

  async listResumeCompilations(projectId: ID): Promise<ResumeCompilation[]> {
    const { data, error } = await this.db
      .from("resume_compilations")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase resume_compilations: ${error.message}`);
    return (data ?? []) as Collections["resumeCompilations"];
  }

  async createResumeCompilation(
    input: Omit<ResumeCompilation, "id" | "created_at">,
  ): Promise<ResumeCompilation> {
    const { data, error } = await this.db
      .from("resume_compilations")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume compilation: ${error.message}`);
    return (data as ResumeCompilation) ?? input;
  }

  async updateResumeCompilation(
    id: ID,
    patch: Partial<
      Pick<ResumeCompilation, "status" | "pdf_artifact_id" | "log" | "warnings" | "errors">
    >,
  ): Promise<ResumeCompilation | null> {
    const { data, error } = await this.db
      .from("resume_compilations")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase update resume compilation: ${error.message}`);
    return (data as ResumeCompilation | null) ?? null;
  }

  async getResumeCompilation(id: ID): Promise<ResumeCompilation | null> {
    const { data, error } = await this.db
      .from("resume_compilations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase get resume compilation: ${error.message}`);
    return (data as ResumeCompilation | null) ?? null;
  }

  /* ---------------- resume studio - artifacts ---------------- */

  async listResumeArtifacts(projectId: ID): Promise<ResumeArtifact[]> {
    const { data, error } = await this.db
      .from("resume_artifacts")
      .select("*")
      .eq("project_id", projectId);
    if (error) throw new Error(`Supabase resume_artifacts: ${error.message}`);
    return (data ?? []) as Collections["resumeArtifacts"];
  }

  async createResumeArtifact(
    input: Omit<ResumeArtifact, "id" | "created_at">,
  ): Promise<ResumeArtifact> {
    const { data, error } = await this.db
      .from("resume_artifacts")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume artifact: ${error.message}`);
    return (data as ResumeArtifact) ?? input;
  }

  async getResumeArtifact(id: ID): Promise<ResumeArtifact | null> {
    const { data, error } = await this.db
      .from("resume_artifacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase get resume artifact: ${error.message}`);
    return (data as ResumeArtifact | null) ?? null;
  }

  /* ---------------- ATS reports - create ---------------- */

  async createAtsReport(
    input: Omit<AtsReport, "id" | "created_at">,
  ): Promise<AtsReport> {
    const { data, error } = await this.db
      .from("ats_reports")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create ats report: ${error.message}`);
    return (data as AtsReport) ?? input;
  }

  /** Dev cleanup: delete every ATS report for the current profile only. */
  async deleteAtsReports(): Promise<number> {
    const { error, count } = await this.db
      .from("ats_reports")
      .delete({ count: "exact" })
      .eq("profile_id", DEFAULT_PROFILE_ID);
    if (error) throw new Error(`Supabase delete ats reports: ${error.message}`);
    return count ?? 0;
  }

  /* ---------------- resume studio - original file storage ---------------- */

  async storeResumeFile(
    input: Omit<ResumeArtifact, "id" | "created_at">,
    fileBuffer: Buffer,
  ): Promise<ResumeArtifact> {
    const { data, error } = await this.db
      .from("resume_artifacts")
      .insert(input)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase create resume artifact: ${error.message}`);
    const artifact = data as ResumeArtifact;

    // Store file to disk
    const uploadsDir = path.join(process.cwd(), ".data", "resume_files");
    await fs.mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, artifact.id);
    await fs.writeFile(filePath, fileBuffer);

    return artifact;
  }

  async getResumeFile(id: ID): Promise<{ fileBuffer: Buffer; fileName: string; mimeType: string } | null> {
    const { data, error } = await this.db
      .from("resume_artifacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const artifact = data as ResumeArtifact;
    try {
      const filePath = path.join(process.cwd(), ".data", "resume_files", artifact.id);
      const fileBuffer = await fs.readFile(filePath);
      return { fileBuffer, fileName: artifact.file_name, mimeType: artifact.mime_type };
    } catch {
      return null;
    }
  }

  /* ---------------- notifications ---------------- */

  async listNotifications() {
    const { data, error } = await this.db
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`Supabase notifications: ${error.message}`);
    return (data ?? []) as Collections["notifications"];
  }

  async markNotificationsRead() {
    const { error } = await this.db
      .from("notifications")
      .update({ read_at: now() })
      .is("read_at", null);
    if (error) throw new Error(`Supabase mark notifications: ${error.message}`);
  }

  async listIntegrations() {
    const { data, error } = await this.db.from("integration_accounts").select("*");
    if (error) throw new Error(`Supabase integration_accounts: ${error.message}`);
    return (data ?? []) as Collections["integrations"];
  }

  /* ---------------- data management ---------------- */

  async exportAll(): Promise<Record<string, unknown[]>> {
    const tables = [
      "profiles",
      "education",
      "candidate_skills",
      "projects",
      "experiences",
      "leadership",
      "certifications",
      "role_preferences",
      "job_preferences",
      "companies",
      "job_sources",
      "jobs",
      "job_verifications",
      "job_verification_history",
      "job_matches",
      "saved_jobs",
      "discovery_runs",
      "applications",
      "application_events",
      "resumes",
      "resume_versions",
      "ats_reports",
      "recruiters",
      "email_drafts",
      "notifications",
      "integration_accounts",
      "resume_projects",
      "resume_source_versions",
      "resume_compilations",
      "resume_artifacts",
    ];
    const out: Record<string, unknown[]> = {};
    for (const table of tables) {
      const { data, error } = await this.db.from(table).select("*").limit(10000);
      out[table] = error ? [] : ((data ?? []) as unknown[]);
    }
    return out;
  }

  async wipe(): Promise<void> {
    const profileId = await this.profileId();
    const childTables = [
      "education",
      "candidate_skills",
      "projects",
      "experiences",
      "leadership",
      "certifications",
      "role_preferences",
      "job_preferences",
      "saved_jobs",
      "job_matches",
      "applications",
      "application_events",
      "resumes",
      "resume_versions",
      "resume_projects",
      "resume_source_versions",
      "resume_compilations",
      "resume_artifacts",
      "ats_reports",
      "recruiters",
      "email_drafts",
      "notifications",
    ];
    for (const table of childTables) {
      const { error } = await this.db.from(table).delete().eq("profile_id", profileId);
      if (error) throw new Error(`Supabase wipe ${table}: ${error.message}`);
    }
    await this.db
      .from("profiles")
      .update({ personal: emptyPersonal(), updated_at: now() })
      .eq("id", profileId);
  }
}

function emptyPersonal(): PersonalInfo {
  return {
    full_name: "",
    email: "",
    phone: "",
    city: "",
    country: "",
    headline: "",
    summary: "",
    linkedin_url: "",
    github_url: "",
    portfolio_url: "",
    other_links: [],
  };
}

