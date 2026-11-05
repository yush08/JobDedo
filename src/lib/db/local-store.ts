import "server-only";

import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "path";

import type {
  Application,
  Company,
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
import { findExistingJob } from "@/features/discovery/dedupe";
import {
  DEFAULT_PROFILE_ID,
  buildEmptyCollections,
  defaultPreferences,
} from "./seed";

type State = Collections;

/**
 * File-backed data store used when Supabase is not configured.
 *
 * - Data lives in `.data/jobdedo.local.json` (git-ignored) and survives
 *   refreshes, restarts and browser closures — it is the source of truth for
 *   local mode, exactly like Postgres is for the Supabase driver.
 * - Writes are serialised and atomic (temp file + rename).
 * - Same `DataStore` contract as the Supabase driver, so swapping drivers
 *   changes nothing above this layer.
 */

const now = (): IsoDateTime => new Date().toISOString();
const uuid = (): ID => crypto.randomUUID();

/**
 * Every array-typed collection in the `Collections` schema.  Legacy
 * `.data/jobdedo.local.json` files that predate Resume Studio (or any future
 * collection) will be missing these keys entirely.  `read()` normalizes them
 * on load so array-mutating methods never receive `undefined`.
 */
const ARRAY_COLLECTIONS: (keyof Omit<Collections, "profile">)[] = [
  "education",
  "skills",
  "projects",
  "experiences",
  "leadership",
  "certifications",
  "roles",
  "companies",
  "sources",
  "jobs",
  "verifications",
  "verificationHistory",
  "matches",
  "savedJobs",
  "discoveryRuns",
  "applications",
  "resumes",
  "resumeVersions",
  "atsReports",
  "recruiters",
  "emailDrafts",
  "notifications",
  "integrations",
  "resumeProjects",
  "resumeSourceVersions",
  "resumeCompilations",
  "resumeArtifacts",
];

/**
 * Normalize a raw on-disk state object into a valid `State`.
 *
 * - `profile` is coerced to an object or `null`.
 * - Every array collection is guaranteed to be an array: missing or
 *   non-array values become `[]` (and are logged so operators can see what
 *   was repaired).
 * - All existing user records are preserved verbatim.
 * - Returns `{ state, changed }` so callers can persist repairs.
 */
function normalizeState(raw: unknown): { state: State; changed: boolean } {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const normalized: Record<string, unknown> = { ...source };
  let changed = false;

  // profile: must be an object or null
  if (!("profile" in normalized)) {
    normalized.profile = null;
    changed = true;
  } else if (
    normalized.profile !== null &&
    (typeof normalized.profile !== "object" || Array.isArray(normalized.profile))
  ) {
    console.warn(
      "[local-store] Normalizing invalid profile to null",
    );
    normalized.profile = null;
    changed = true;
  }

  // every array-typed collection
  for (const key of ARRAY_COLLECTIONS) {
    const value = normalized[key];
    if (!Array.isArray(value)) {
      console.warn(
        `[local-store] Normalizing missing/invalid collection "${key}" to empty array`,
      );
      normalized[key] = [];
      changed = true;
    }
  }

  return { state: normalized as unknown as State, changed };
}

export class LocalStore implements DataStore {
  readonly driver = "local" as const;

  private readonly file: string;
  /** Directory for uploaded originals and compiled PDF bytes (root-scoped). */
  private readonly filesDir: string;
  private queue: Promise<unknown> = Promise.resolve();
  /** Shared first-run seed write, so concurrent first-touchers never interleave. */
  private seedInFlight: Promise<State> | null = null;

  constructor(root = process.cwd()) {
    this.file = path.join(root, ".data", "jobdedo.local.json");
    this.filesDir = path.join(root, ".data", "resume_files");
  }

  /* ---------------- low level ---------------- */

  private async read(): Promise<State> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const { state } = normalizeState(parsed);
      // Normalized state is returned to callers and persisted by the next
      // `mutate()` writeRaw().  We deliberately do not write here so that
      // read-only paths (health checks, listings) never issue an extra write
      // and so the EPERM retry accounting in mutate()/writeRaw() is unchanged.
      return state;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // First touch of this store: seed it. The seed write happens outside
        // `mutate()`'s queue (a read can trigger it at any time), so all
        // concurrent first-touchers share ONE in-flight seed write instead of
        // racing two writers over the same temporary file.
        if (!this.seedInFlight) {
          this.seedInFlight = this.createSeed().finally(() => {
            this.seedInFlight = null;
          });
        }
        return this.seedInFlight;
      }
      throw err;
    }
  }

  private async createSeed(): Promise<State> {
    const profileId = DEFAULT_PROFILE_ID;
    const state: State = {
      profile: {
        id: profileId,
        personal: emptyPersonal(),
        created_at: now(),
        updated_at: now(),
      },
      ...buildEmptyCollections(profileId),
    };
    await this.writeRaw(state);
    return state;
  }

  private async writeRaw(state: State): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Unique temp name: even if two writers ever race, they can never corrupt
    // each other's partial file — rename is the only atomic visibility point.
    const tmp = `${this.file}.${process.pid}.${uuid()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    // Windows can fail the rename with EPERM/EBUSY/EACCES while an external
    // handle (antivirus, indexer, shell preview) briefly holds the target —
    // such locks commonly outlast 100ms, so back off exponentially across
    // several seconds before giving up. A lost rename would discard the whole mutation.
    let lastError: unknown;
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await fs.rename(tmp, this.file);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
        lastError = err;
        if (attempt < maxAttempts - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1.6s, 3.2s, 6.4s
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        }
      }
    }
    // Fallback for Windows: if rename keeps failing, try copy + unlink.
    // Not atomic, but better than losing the mutation entirely.
    try {
      await fs.copyFile(tmp, this.file);
      await fs.unlink(tmp).catch(() => undefined);
      return;
    } catch (copyErr) {
      // Copy also failed — clean up and surface the original error.
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw lastError;
    }
  }

  /** Serialised read-modify-write. */
  private mutate<T>(
    fn: (state: State) => T | Promise<T>,
  ): Promise<{ state: State; result: T }> {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = await fn(state);
      await this.writeRaw(state);
      return { state, result };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private readOnly<T>(fn: (state: State) => T): Promise<T> {
    return this.read().then(fn);
  }

  async health(): Promise<StoreHealth> {
    try {
      await this.read();
      return {
        ok: true,
        driver: "local",
        message: `Local JSON store (${path.relative(process.cwd(), this.file)})`,
      };
    } catch (err) {
      return {
        ok: false,
        driver: "local",
        message: err instanceof Error ? err.message : "Local store unavailable",
      };
    }
  }

  /* ---------------- profile ---------------- */

  async getProfile() {
    return this.readOnly((s) => s.profile);
  }

  async ensureProfile() {
    return this.mutate((s) => {
      if (!s.profile) {
        s.profile = {
          id: DEFAULT_PROFILE_ID,
          personal: emptyPersonal(),
          created_at: now(),
          updated_at: now(),
        };
      }
      return s.profile;
    }).then((r) => r.result);
  }

  async saveProfile(personal: PersonalInfo) {
    return this.mutate((s) => {
      if (!s.profile) {
        s.profile = {
          id: DEFAULT_PROFILE_ID,
          personal,
          created_at: now(),
          updated_at: now(),
        };
      } else {
        s.profile.personal = personal;
        s.profile.updated_at = now();
      }
      return s.profile;
    }).then((r) => r.result);
  }

  async listProfileChildren() {
    return this.readOnly((s) => ({
      education: s.education,
      skills: s.skills,
      projects: s.projects,
      experiences: s.experiences,
      leadership: s.leadership,
      certifications: s.certifications,
    }));
  }

  async saveProfileChildren(children: {
    education: Collections["education"];
    skills: Collections["skills"];
    projects: Collections["projects"];
    experiences: Collections["experiences"];
    leadership: Collections["leadership"];
    certifications: Collections["certifications"];
  }) {
    await this.mutate((s) => {
      const profileId = s.profile?.id ?? DEFAULT_PROFILE_ID;
      s.education = withIds(children.education, profileId);
      s.skills = withIds(children.skills, profileId);
      s.projects = withIds(children.projects, profileId);
      s.experiences = withIds(children.experiences, profileId);
      s.leadership = withIds(children.leadership, profileId);
      s.certifications = withIds(children.certifications, profileId);
      if (s.profile) s.profile.updated_at = now();
    });
  }

  /* ---------------- preferences ---------------- */

  async getPreferences(): Promise<PreferencesBundle> {
    return this.readOnly((s) => {
      const profileId = s.profile?.id ?? DEFAULT_PROFILE_ID;
      return {
        roles: s.roles,
        preferences: s.preferences ?? defaultPreferences(profileId),
      };
    });
  }

  async savePreferences(bundle: PreferencesBundle): Promise<PreferencesBundle> {
    return this.mutate((s) => {
      const profileId = s.profile?.id ?? DEFAULT_PROFILE_ID;
      s.roles = bundle.roles.map((r) => ({
        ...r,
        id: r.id || uuid(),
        profile_id: profileId,
      }));
      s.preferences = {
        ...bundle.preferences,
        id: bundle.preferences.id || uuid(),
        profile_id: profileId,
        updated_at: now(),
      };
      return { roles: s.roles, preferences: s.preferences };
    }).then((r) => r.result);
  }

  /* ---------------- jobs ---------------- */

  private hydrate(state: State): JobWithRelations[] {
    const companies = new Map(state.companies.map((c) => [c.id, c]));
    const sources = new Map(state.sources.map((s) => [s.id, s]));
    const saved = new Set(state.savedJobs.map((r) => r.job_id));
    const latestMatch = new Map<ID, JobMatch>();
    for (const m of state.matches) {
      const existing = latestMatch.get(m.job_id);
      if (!existing || existing.created_at < m.created_at) {
        latestMatch.set(m.job_id, m);
      }
    }
    return state.jobs.map((job) => ({
      ...job,
      company: companies.get(job.company_id) ?? null,
      source: sources.get(job.source_id ?? "") ?? null,
      saved: saved.has(job.id),
      match_score: latestMatch.get(job.id)?.score ?? null,
    }));
  }

  async listJobsFull(): Promise<JobWithRelations[]> {
    return this.readOnly((s) => this.hydrate(s));
  }

  async getJobFull(id: ID): Promise<JobWithRelations | null> {
    return this.readOnly((s) => this.hydrate(s).find((j) => j.id === id) ?? null);
  }

  async listCompanies() {
    return this.readOnly((s) => s.companies);
  }

  async listSources() {
    return this.readOnly((s) => s.sources);
  }

  async listSavedJobIds(): Promise<ID[]> {
    return this.readOnly((s) => s.savedJobs.map((r) => r.job_id));
  }

  async setJobSaved(jobId: ID, saved: boolean): Promise<boolean> {
    return this.mutate((s) => {
      const profileId = s.profile?.id ?? DEFAULT_PROFILE_ID;
      const exists = s.savedJobs.some((r) => r.job_id === jobId);
      if (saved && !exists) {
        s.savedJobs.push({ profile_id: profileId, job_id: jobId, saved_at: now() });
      } else if (!saved && exists) {
        s.savedJobs = s.savedJobs.filter((r) => r.job_id !== jobId);
      }
      return saved;
    }).then((r) => r.result);
  }

  /* ---------------- verification ---------------- */

  async getVerification(jobId: ID): Promise<JobVerification | null> {
    return this.readOnly(
      (s) => s.verifications.find((v) => v.job_id === jobId) ?? null,
    );
  }

  async saveVerification(verification: JobVerification): Promise<void> {
    await this.mutate((s) => {
      const index = s.verifications.findIndex((v) => v.job_id === verification.job_id);
      if (index >= 0) s.verifications[index] = verification;
      else s.verifications.push(verification);
    });
  }

  async updateJobVerificationFields(
    jobId: ID,
    fields: Partial<
      Pick<
        Job,
        | "verification_status"
        | "verification_confidence"
        | "last_checked_at"
        | "last_verified_at"
        | "next_check_at"
        | "job_status"
      >
    >,
  ): Promise<void> {
    await this.mutate((s) => {
      const job = s.jobs.find((j) => j.id === jobId);
      if (!job) return;
      Object.assign(job, fields, { updated_at: now() });
    });
  }

  async listVerificationHistory(jobId: ID): Promise<VerificationHistoryEntry[]> {
    return this.readOnly((s) =>
      s.verificationHistory
        .filter((h) => h.job_id === jobId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  async appendVerificationHistory(entry: Omit<VerificationHistoryEntry, "id">) {
    await this.mutate((s) => {
      s.verificationHistory.push({ ...entry, id: uuid() });
    });
  }

  /* ---------------- matches ---------------- */

  async getLatestMatch(jobId: ID): Promise<JobMatch | null> {
    return this.readOnly((s) => {
      const rows = s.matches
        .filter((m) => m.job_id === jobId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return rows[0] ?? null;
    });
  }

  async upsertMatch(match: Omit<JobMatch, "id" | "created_at">): Promise<JobMatch> {
    return this.mutate((s) => {
      const record: JobMatch = { ...match, id: uuid(), created_at: now() };
      s.matches = s.matches.filter((m) => m.job_id !== match.job_id);
      s.matches.push(record);
      return record;
    }).then((r) => r.result);
  }

  /* ---------------- discovery ---------------- */

  async getDiscoveryRun(id: ID): Promise<import("@/types").DiscoveryRun | null> {
    return this.readOnly(
      (s) => s.discoveryRuns.find((r) => r.id === id) ?? null,
    );
  }

  async getLatestDiscoveryRun() {
    return this.readOnly((s) => {
      const rows = [...s.discoveryRuns].sort((a, b) =>
        b.started_at.localeCompare(a.started_at),
      );
      return rows[0] ?? null;
    });
  }

  async createDiscoveryRun(
    run: Omit<import("@/types").DiscoveryRun, "id" | "started_at" | "finished_at">,
  ) {
    return this.mutate((s) => {
      const record = {
        ...run,
        id: uuid(),
        started_at: now(),
        finished_at: null as IsoDateTime | null,
      };
      s.discoveryRuns.push(record);
      return record;
    }).then((r) => r.result);
  }

  async updateDiscoveryRun(
    id: ID,
    patch: Partial<import("@/types").DiscoveryRun>,
  ): Promise<import("@/types").DiscoveryRun | null> {
    return this.mutate((s) => {
      const run = s.discoveryRuns.find((r) => r.id === id);
      if (!run) return null;
      Object.assign(run, patch);
      return run;
    }).then((r) => r.result);
  }

  async listDiscoveryRuns(limit = 20): Promise<import("@/types").DiscoveryRun[]> {
    return this.readOnly((s) =>
      [...s.discoveryRuns]
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .slice(0, Math.max(1, limit)),
    );
  }

  /* ---------------- discovery ingestion ---------------- */

  /** Resolve (or create) the company a draft refers to, inside one state. */
  private resolveCompany(state: State, draft: CompanyDraft): Company {
    const nameKey = draft.name.trim().toLowerCase();
    const domainKey = draft.domain.trim().toLowerCase();
    const existing = state.companies.find(
      (c) =>
        (nameKey && c.name.trim().toLowerCase() === nameKey) ||
        (domainKey && c.domain.trim().toLowerCase() === domainKey),
    );
    if (existing) {
      // Fill gaps only — a source sighting never erases what we already know.
      if (!existing.official_website_url && draft.official_website_url) {
        existing.official_website_url = draft.official_website_url;
      }
      if (!existing.careers_page_url && draft.careers_page_url) {
        existing.careers_page_url = draft.careers_page_url;
        existing.careers_discovery_method = "Published by the job source";
      }
      if (!existing.industry && draft.industry) existing.industry = draft.industry;
      if (!existing.domain && draft.domain) existing.domain = draft.domain;
      return existing;
    }
    const company: Company = {
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
    state.companies.push(company);
    return company;
  }

  private resolveSource(
    state: State,
    input: { key: string; name: string; base_url: string; kind: JobSource["kind"] },
  ): JobSource {
    const existing = state.sources.find((s) => s.key === input.key);
    if (existing) return existing;
    const source: JobSource = {
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
    state.sources.push(source);
    return source;
  }

  private companyNameIndex(state: State): Map<ID, string> {
    return new Map(state.companies.map((c) => [c.id, c.name]));
  }

  async ensureCompany(draft: CompanyDraft): Promise<Company> {
    return this.mutate((s) => this.resolveCompany(s, draft)).then((r) => r.result);
  }

  async ensureSource(input: {
    key: string;
    name: string;
    base_url: string;
    kind: JobSource["kind"];
  }): Promise<JobSource> {
    return this.mutate((s) => this.resolveSource(s, input)).then((r) => r.result);
  }

  async ingestJob(
    draft: JobDraft,
    context: IngestJobContext,
  ): Promise<{ job: Job; created: boolean }> {
    return this.mutate((s) => {
      const company = this.resolveCompany(s, draft.company);
      const source = this.resolveSource(s, {
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
      const existing = findExistingJob(s.jobs, draft, this.companyNameIndex(s));
      if (existing) {
        const merged = mergeDiscoveredJob(existing, draft, ctx);
        const index = s.jobs.indexOf(existing);
        if (index >= 0) s.jobs[index] = merged;
        else s.jobs.push(merged);
        return { job: merged, created: false };
      }
      const job = createJobFromDraft(draft, ctx);
      s.jobs.push(job);
      return { job, created: true };
    }).then((r) => r.result);
  }

  async updateSourceStatus(
    key: string,
    patch: Partial<
      Pick<JobSource, "enabled" | "last_run_at" | "last_status" | "last_message">
    >,
  ): Promise<JobSource> {
    return this.mutate((s) => {
      let source = s.sources.find((x) => x.key === key);
      if (!source) {
        source = {
          id: `00000000-0000-4000-8000-0000000000a${s.sources.length + 1}`,
          key,
          name: key,
          base_url: "",
          kind: "job_board" as const,
          enabled: false,
          last_run_at: null,
          last_status: "not_run" as const,
          last_message: "",
        };
        s.sources.push(source);
      }
      Object.assign(source, patch);
      return source;
    }).then((r) => r.result);
  }

  /* ---------------- applications ---------------- */

  async listApplications(): Promise<Application[]> {
    return this.readOnly((s) =>
      [...s.applications].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  async createApplication(
    input: Omit<Application, "id" | "events" | "created_at" | "updated_at" | "profile_id">,
  ): Promise<Application> {
    return this.mutate((s) => {
      const profileId = s.profile?.id ?? DEFAULT_PROFILE_ID;
      const ts = now();
      const record: Application = {
        ...input,
        id: uuid(),
        profile_id: profileId,
        events: [],
        created_at: ts,
        updated_at: ts,
      };
      record.events.push({
        id: uuid(),
        application_id: record.id,
        from_stage: null,
        to_stage: input.stage,
        note: "Application created",
        created_at: ts,
      });
      s.applications.push(record);
      return record;
    }).then((r) => r.result);
  }

  async updateApplication(
    id: ID,
    patch: Partial<Application>,
    event?: { from: Application["stage"]; to: Application["stage"]; note: string },
  ): Promise<Application | null> {
    return this.mutate((s) => {
      const app = s.applications.find((a) => a.id === id);
      if (!app) return null;
      const { events: _events, id: _id, profile_id: _p, created_at: _c, ...rest } = patch;
      Object.assign(app, rest, { updated_at: now() });
      if (event && event.from !== event.to) {
        app.events.push({
          id: uuid(),
          application_id: app.id,
          from_stage: event.from,
          to_stage: event.to,
          note: event.note,
          created_at: now(),
        });
      }
      return app;
    }).then((r) => r.result);
  }

  /* ---------------- milestone 5/6 collections ---------------- */

  async listResumes() {
    return this.readOnly((s) => s.resumes);
  }
  async listResumeVersions() {
    return this.readOnly((s) => s.resumeVersions);
  }
  async createResume(
    input: Omit<Resume, "id" | "created_at">,
  ): Promise<Resume> {
    return this.mutate((s) => {
      const record: Resume = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.resumes.push(record);
      return record;
    }).then((r) => r.result);
  }
  async createResumeVersion(
    input: Omit<ResumeVersion, "id" | "created_at">,
  ): Promise<ResumeVersion> {
    return this.mutate((s) => {
      const record: ResumeVersion = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.resumeVersions.push(record);
      return record;
    }).then((r) => r.result);
  }
  async updateResumeVersion(
    id: ID,
    patch: Partial<
      Pick<ResumeVersion, "raw_text" | "parsed" | "tailored_for_job_id">
    >,
  ): Promise<ResumeVersion | null> {
    return this.mutate((s) => {
      const version = s.resumeVersions.find((v) => v.id === id);
      if (!version) return null;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          (version as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return version;
    }).then((r) => r.result);
  }
  async updateResumeSourceVersion(
    id: ID,
    patch: Partial<
      Pick<ResumeSourceVersion, "latex_source" | "structured_content" | "template_id">
    >,
  ): Promise<ResumeSourceVersion | null> {
    return this.mutate((s) => {
      const version = s.resumeSourceVersions.find((v) => v.id === id);
      if (!version) return null;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          (version as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return version;
    }).then((r) => r.result);
  }
  async deleteResumeSourceVersion(id: ID): Promise<boolean> {
    return this.mutate((s) => {
      const before = s.resumeSourceVersions.length;
      s.resumeSourceVersions = s.resumeSourceVersions.filter((v) => v.id !== id);
      return s.resumeSourceVersions.length < before;
    }).then((r) => r.result);
  }
  async updateResumeCurrentVersion(
    resumeId: ID,
    versionId: ID,
  ): Promise<Resume> {
    return this.mutate((s) => {
      const resume = s.resumes.find((r) => r.id === resumeId);
      if (!resume) throw new Error(`Resume ${resumeId} not found`);
      resume.current_version_id = versionId;
      return resume;
    }).then((r) => r.result);
  }
  async listRecruiters() {
    return this.readOnly((s) => s.recruiters);
  }
  async listEmailDrafts() {
    return this.readOnly((s) => s.emailDrafts);
  }
  async listAtsReports() {
    return this.readOnly((s) => s.atsReports);
  }

  /* ---------------- resume studio - projects ---------------- */

  async listResumeProjects(): Promise<ResumeProject[]> {
    return this.readOnly((s) =>
      [...s.resumeProjects].sort(
        (a, b) => b.updated_at.localeCompare(a.updated_at),
      ),
    );
  }

  async createResumeProject(
    input: Omit<ResumeProject, "id" | "created_at" | "updated_at">,
  ): Promise<ResumeProject> {
    return this.mutate((s) => {
      const record: ResumeProject = {
        ...input,
        id: uuid(),
        created_at: now(),
        updated_at: now(),
      };
      s.resumeProjects.push(record);
      return record;
    }).then((r) => r.result);
  }

  async updateResumeProject(
    id: ID,
    patch: Partial<
      Pick<ResumeProject, "name" | "active_version_id" | "template_id">
    >,
  ): Promise<ResumeProject | null> {
    return this.mutate((s) => {
      const project = s.resumeProjects.find((p) => p.id === id);
      if (!project) return null;
      // Only apply defined values so partial patches never wipe existing fields.
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          (project as unknown as Record<string, unknown>)[key] = value;
        }
      }
      project.updated_at = now();
      return project;
    }).then((r) => r.result);
  }

  async getResumeProject(id: ID): Promise<ResumeProject | null> {
    return this.readOnly((s) => s.resumeProjects.find((p) => p.id === id) ?? null);
  }

  /* ---------------- resume studio - source versions ---------------- */

  async listResumeSourceVersions(projectId: ID): Promise<ResumeSourceVersion[]> {
    return this.readOnly((s) =>
      [...s.resumeSourceVersions]
        .filter((v) => v.project_id === projectId)
        .sort((a, b) => b.version_number - a.version_number),
    );
  }

  async createResumeSourceVersion(
    input: Omit<ResumeSourceVersion, "id" | "created_at">,
  ): Promise<ResumeSourceVersion> {
    return this.mutate((s) => {
      const project = s.resumeProjects.find((p) => p.id === input.project_id);
      if (!project) throw new Error(`Resume project ${input.project_id} not found`);
      const record: ResumeSourceVersion = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.resumeSourceVersions.push(record);
      return record;
    }).then((r) => r.result);
  }

  async getResumeSourceVersion(id: ID): Promise<ResumeSourceVersion | null> {
    return this.readOnly((s) => s.resumeSourceVersions.find((v) => v.id === id) ?? null);
  }

  /* ---------------- resume studio - compilations ---------------- */

  async listResumeCompilations(projectId: ID): Promise<ResumeCompilation[]> {
    return this.readOnly((s) =>
      [...s.resumeCompilations]
        .filter((c) => c.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  async createResumeCompilation(
    input: Omit<ResumeCompilation, "id" | "created_at">,
  ): Promise<ResumeCompilation> {
    return this.mutate((s) => {
      const record: ResumeCompilation = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.resumeCompilations.push(record);
      return record;
    }).then((r) => r.result);
  }

  async updateResumeCompilation(
    id: ID,
    patch: Partial<
      Pick<ResumeCompilation, "status" | "pdf_artifact_id" | "log" | "warnings" | "errors">
    >,
  ): Promise<ResumeCompilation | null> {
    return this.mutate((s) => {
      const compilation = s.resumeCompilations.find((c) => c.id === id);
      if (!compilation) return null;
      Object.assign(compilation, patch);
      return compilation;
    }).then((r) => r.result);
  }

  async getResumeCompilation(id: ID): Promise<ResumeCompilation | null> {
    return this.readOnly((s) => s.resumeCompilations.find((c) => c.id === id) ?? null);
  }

  /* ---------------- resume studio - artifacts ---------------- */

  async listResumeArtifacts(projectId: ID): Promise<ResumeArtifact[]> {
    return this.readOnly((s) =>
      [...s.resumeArtifacts].filter((a) => a.project_id === projectId),
    );
  }

  async createResumeArtifact(
    input: Omit<ResumeArtifact, "id" | "created_at">,
  ): Promise<ResumeArtifact> {
    return this.mutate((s) => {
      const record: ResumeArtifact = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.resumeArtifacts.push(record);
      return record;
    }).then((r) => r.result);
  }

  async getResumeArtifact(id: ID): Promise<ResumeArtifact | null> {
    return this.readOnly((s) => s.resumeArtifacts.find((a) => a.id === id) ?? null);
  }

  /* ---------------- ATS reports - create ---------------- */

  async createAtsReport(
    input: Omit<AtsReport, "id" | "created_at">,
  ): Promise<AtsReport> {
    return this.mutate((s) => {
      const record: AtsReport = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.atsReports.push(record);
      return record;
    }).then((r) => r.result);
  }

  /* ---------------- resume studio - original file storage ---------------- */

  async storeResumeFile(
    input: Omit<ResumeArtifact, "id" | "created_at">,
    fileBuffer: Buffer,
  ): Promise<ResumeArtifact> {
    return this.mutate((s) => {
      const record: ResumeArtifact = {
        ...input,
        id: uuid(),
        created_at: now(),
      };
      s.resumeArtifacts.push(record);
      return record;
    }).then(async (r) => {
      // Store file to disk
      await fs.mkdir(this.filesDir, { recursive: true });
      const filePath = path.join(this.filesDir, r.result.id);
      await fs.writeFile(filePath, fileBuffer);
      return r.result;
    });
  }

  async getResumeFile(id: ID): Promise<{ fileBuffer: Buffer; fileName: string; mimeType: string } | null> {
    return this.readOnly((s) => {
      const artifact = s.resumeArtifacts.find((a) => a.id === id);
      if (!artifact) return null;
      try {
        const filePath = path.join(this.filesDir, artifact.id);
        const fileBuffer = readFileSync(filePath);
        return { fileBuffer, fileName: artifact.file_name, mimeType: artifact.mime_type };
      } catch {
        return null;
      }
    });
  }

  /* ---------------- notifications ---------------- */

  async listNotifications() {
    return this.readOnly((s) =>
      [...s.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  async markNotificationsRead() {
    await this.mutate((s) => {
      const ts = now();
      for (const n of s.notifications) if (!n.read_at) n.read_at = ts;
    });
  }

  async listIntegrations() {
    return this.readOnly((s) => s.integrations);
  }

  /* ---------------- data management ---------------- */

  async exportAll(): Promise<Record<string, unknown[]>> {
    return this.readOnly((s) => ({
      profile: s.profile ? [s.profile] : [],
      education: s.education,
      candidate_skills: s.skills,
      projects: s.projects,
      experiences: s.experiences,
      leadership: s.leadership,
      certifications: s.certifications,
      role_preferences: s.roles,
      job_preferences: s.preferences ? [s.preferences] : [],
      companies: s.companies,
      job_sources: s.sources,
      jobs: s.jobs,
      job_verifications: s.verifications,
      job_verification_history: s.verificationHistory,
      job_matches: s.matches,
      saved_jobs: s.savedJobs,
      discovery_runs: s.discoveryRuns,
      applications: s.applications,
      resumes: s.resumes,
      resume_versions: s.resumeVersions,
      ats_reports: s.atsReports,
      recruiters: s.recruiters,
      email_drafts: s.emailDrafts,
      notifications: s.notifications,
      integrations: s.integrations,
      resume_projects: s.resumeProjects,
      resume_source_versions: s.resumeSourceVersions,
      resume_compilations: s.resumeCompilations,
      resume_artifacts: s.resumeArtifacts,
    }));
  }

  /** Delete all personal data; sample/demo rows and app config remain. */
  async wipe(): Promise<void> {
    await this.mutate((s) => {
      const profileId = s.profile?.id ?? DEFAULT_PROFILE_ID;
      s.profile = {
        id: profileId,
        personal: emptyPersonal(),
        created_at: s.profile?.created_at ?? now(),
        updated_at: now(),
      };
      s.education = [];
      s.skills = [];
      s.projects = [];
      s.experiences = [];
      s.leadership = [];
      s.certifications = [];
      s.roles = [];
      s.preferences = defaultPreferences(profileId);
      s.savedJobs = [];
      s.matches = [];
      s.applications = [];
      s.resumes = [];
      s.resumeVersions = [];
      s.resumeProjects = [];
      s.resumeSourceVersions = [];
      s.resumeCompilations = [];
      s.resumeArtifacts = [];
      s.atsReports = [];
      s.recruiters = [];
      s.emailDrafts = [];
      s.notifications = [];
      s.verificationHistory = [];
    });
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

function withIds<T extends { id?: string; profile_id?: string }>(
  rows: T[],
  profileId: ID,
): T[] {
  return rows.map((row) => ({ ...row, id: row.id || uuid(), profile_id: profileId })) as T[];
}

/** Used by tests to build an isolated store rooted at a temp directory. */
export function createLocalStore(root: string): LocalStore {
  return new LocalStore(root);
}

export function jobIsSample(job: Job): boolean {
  return job.is_sample;
}
