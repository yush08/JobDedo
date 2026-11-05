import type {
  AppNotification,
  Application,
  AtsReport,
  CandidateSkill,
  Certification,
  Company,
  DiscoveryRun,
  Education,
  EmailDraft,
  Experience,
  Job,
  JobMatch,
  JobSource,
  JobVerification,
  JobWithRelations,
  Leadership,
  ID,
  IntegrationAccount,
  IsoDateTime,
  JobPreferences,
  PersonalInfo,
  Project,
  Recruiter,
  Resume,
  ResumeArtifact,
  ResumeCompilation,
  ResumeProject,
  ResumeSourceVersion,
  ResumeVersion,
  RolePreference,
  VerificationHistoryEntry,
} from "@/types";
import type { ProfileInput } from "@/lib/validation/schemas";
import type { CompanyDraft, IngestJobContext, JobDraft } from "@/features/discovery/types";

/** Everything JobDedo persists, as plain rows. */
export interface Collections {
  profile: {
    id: ID;
    personal: PersonalInfo;
    created_at: IsoDateTime;
    updated_at: IsoDateTime;
  } | null;
  education: Education[];
  skills: CandidateSkill[];
  projects: Project[];
  experiences: Experience[];
  leadership: Leadership[];
  certifications: Certification[];
  roles: RolePreference[];
  preferences: JobPreferences | null;
  companies: Company[];
  sources: JobSource[];
  jobs: Job[];
  verifications: JobVerification[];
  verificationHistory: VerificationHistoryEntry[];
  matches: JobMatch[];
  savedJobs: { profile_id: ID; job_id: ID; saved_at: IsoDateTime }[];
  discoveryRuns: DiscoveryRun[];
  applications: Application[];
  resumes: Resume[];
  resumeVersions: ResumeVersion[];
  atsReports: AtsReport[];
  recruiters: Recruiter[];
  emailDrafts: EmailDraft[];
  notifications: AppNotification[];
  integrations: IntegrationAccount[];
  resumeProjects: ResumeProject[];
  resumeSourceVersions: ResumeSourceVersion[];
  resumeCompilations: ResumeCompilation[];
  resumeArtifacts: ResumeArtifact[];
}

export type CollectionKey = keyof Collections;

export interface StoreHealth {
  ok: boolean;
  driver: DataStoreDriver;
  message: string;
}

export type DataStoreDriver = "supabase" | "local";

export interface PreferencesBundle {
  roles: RolePreference[];
  preferences: JobPreferences;
}

/**
 * Persistence contract for JobDedo. Two implementations exist:
 * - `local`   : JSON file at `.data/jobdedo.local.json` (no credentials needed)
 * - `supabase`: Supabase PostgreSQL (server-only service role access)
 */
export interface DataStore {
  readonly driver: DataStoreDriver;

  health(): Promise<StoreHealth>;

  /** Profile (single, created idempotently). */
  getProfile(): Promise<Collections["profile"]>;
  ensureProfile(): Promise<NonNullable<Collections["profile"]>>;
  saveProfile(personal: PersonalInfo): Promise<NonNullable<Collections["profile"]>>;
  listProfileChildren(): Promise<
    Pick<
      Collections,
      | "education"
      | "skills"
      | "projects"
      | "experiences"
      | "leadership"
      | "certifications"
    >
  >;
  saveProfileChildren(children: {
    education: Education[];
    skills: CandidateSkill[];
    projects: Project[];
    experiences: Experience[];
    leadership: Leadership[];
    certifications: Certification[];
  }): Promise<void>;

  /** Preferences. */
  getPreferences(): Promise<PreferencesBundle>;
  savePreferences(bundle: PreferencesBundle): Promise<PreferencesBundle>;

  /** Jobs and relations (hydrated: company, source, saved flag, match score). */
  listJobsFull(): Promise<JobWithRelations[]>;
  getJobFull(id: ID): Promise<JobWithRelations | null>;
  listCompanies(): Promise<Company[]>;
  listSources(): Promise<JobSource[]>;
  setJobSaved(jobId: ID, saved: boolean): Promise<boolean>;
  listSavedJobIds(): Promise<ID[]>;

  /** Verification. */
  getVerification(jobId: ID): Promise<JobVerification | null>;
  saveVerification(verification: JobVerification): Promise<void>;
  /** Update headline verification fields stored on the job row itself. */
  updateJobVerificationFields(
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
  ): Promise<void>;
  listVerificationHistory(jobId: ID): Promise<VerificationHistoryEntry[]>;
  appendVerificationHistory(entry: Omit<VerificationHistoryEntry, "id">): Promise<void>;

  /** Matches. */
  getLatestMatch(jobId: ID): Promise<JobMatch | null>;
  upsertMatch(match: Omit<JobMatch, "id" | "created_at">): Promise<JobMatch>;

  /** Discovery runs. */
  getDiscoveryRun(id: ID): Promise<DiscoveryRun | null>;
  getLatestDiscoveryRun(): Promise<DiscoveryRun | null>;
  createDiscoveryRun(
    run: Omit<DiscoveryRun, "id" | "started_at" | "finished_at">,
  ): Promise<DiscoveryRun>;
  updateDiscoveryRun(
    id: ID,
    patch: Partial<Pick<DiscoveryRun, "status" | "checkpoint" | "pages_fetched" | "found_count" | "new_count" | "duplicate_count" | "error" | "finished_at">>,
  ): Promise<DiscoveryRun | null>;
  /** Run history, newest first (Discover page + scheduled-runner audits). */
  listDiscoveryRuns(limit?: number): Promise<DiscoveryRun[]>;

  /**
   * Discovery ingestion (Milestone 2).
   *
   * `ingestJob` is idempotent: the same listing ingested twice updates the
   * stored row (last-seen timestamps, re-published content, source links)
   * and reports `created: false` — it never inserts a duplicate row.
   */
  ensureCompany(draft: CompanyDraft): Promise<Company>;
  ensureSource(input: {
    key: string;
    name: string;
    base_url: string;
    kind: JobSource["kind"];
  }): Promise<JobSource>;
  ingestJob(
    draft: JobDraft,
    context: IngestJobContext,
  ): Promise<{ job: Job; created: boolean }>;
  updateSourceStatus(
    key: string,
    patch: Partial<Pick<JobSource, "enabled" | "last_run_at" | "last_status" | "last_message">>,
  ): Promise<JobSource | null>;

  /** Applications. */
  listApplications(): Promise<Application[]>;
  createApplication(
    input: Omit<Application, "id" | "events" | "created_at" | "updated_at" | "profile_id">,
  ): Promise<Application>;
  updateApplication(
    id: ID,
    patch: Partial<Application>,
    event?: { from: Application["stage"]; to: Application["stage"]; note: string },
  ): Promise<Application | null>;

  /** Milestone 5/6 collections (read surfaces used by their pages). */
  listResumes(): Promise<Resume[]>;
  listResumeVersions(): Promise<ResumeVersion[]>;
  createResume(
    input: Omit<Resume, "id" | "created_at">,
  ): Promise<Resume>;
  createResumeVersion(
    input: Omit<ResumeVersion, "id" | "created_at">,
  ): Promise<ResumeVersion>;
  updateResumeVersion(
    id: ID,
    patch: Partial<
      Pick<ResumeVersion, "raw_text" | "parsed" | "tailored_for_job_id">
    >,
  ): Promise<ResumeVersion | null>;
  updateResumeSourceVersion(
    id: ID,
    patch: Partial<
      Pick<ResumeSourceVersion, "latex_source" | "structured_content" | "template_id">
    >,
  ): Promise<ResumeSourceVersion | null>;
  deleteResumeSourceVersion(id: ID): Promise<boolean>;
  updateResumeCurrentVersion(
    resumeId: ID,
    versionId: ID,
  ): Promise<Resume>;
  listRecruiters(): Promise<Recruiter[]>;
  listEmailDrafts(): Promise<EmailDraft[]>;
  listAtsReports(): Promise<AtsReport[]>;

  /** Resume Studio - Projects. */
  listResumeProjects(): Promise<ResumeProject[]>;
  createResumeProject(
    input: Omit<ResumeProject, "id" | "created_at" | "updated_at">,
  ): Promise<ResumeProject>;
  updateResumeProject(
    id: ID,
    patch: Partial<Pick<ResumeProject, "name" | "active_version_id" | "template_id">>,
  ): Promise<ResumeProject | null>;
  getResumeProject(id: ID): Promise<ResumeProject | null>;

  /** Resume Studio - Source Versions. */
  listResumeSourceVersions(projectId: ID): Promise<ResumeSourceVersion[]>;
  createResumeSourceVersion(
    input: Omit<ResumeSourceVersion, "id" | "created_at">,
  ): Promise<ResumeSourceVersion>;
  getResumeSourceVersion(id: ID): Promise<ResumeSourceVersion | null>;

  /** Resume Studio - Compilations. */
  listResumeCompilations(projectId: ID): Promise<ResumeCompilation[]>;
  createResumeCompilation(
    input: Omit<ResumeCompilation, "id" | "created_at">,
  ): Promise<ResumeCompilation>;
  updateResumeCompilation(
    id: ID,
    patch: Partial<
      Pick<
        ResumeCompilation,
        "status" | "pdf_artifact_id" | "log" | "warnings" | "errors"
      >
    >,
  ): Promise<ResumeCompilation | null>;
  getResumeCompilation(id: ID): Promise<ResumeCompilation | null>;

  /** Resume Studio - Artifacts. */
  listResumeArtifacts(projectId: ID): Promise<ResumeArtifact[]>;
  createResumeArtifact(
    input: Omit<ResumeArtifact, "id" | "created_at">,
  ): Promise<ResumeArtifact>;
  getResumeArtifact(id: ID): Promise<ResumeArtifact | null>;

  /** ATS Reports. */
  createAtsReport(
    input: Omit<AtsReport, "id" | "created_at">,
  ): Promise<AtsReport>;

  /** Resume Studio - Original file storage. */
  storeResumeFile(
    input: Omit<ResumeArtifact, "id" | "created_at">,
    fileBuffer: Buffer,
  ): Promise<ResumeArtifact>;
  getResumeFile(id: ID): Promise<{ fileBuffer: Buffer; fileName: string; mimeType: string } | null>;

  /** Notifications. */
  listNotifications(): Promise<AppNotification[]>;
  markNotificationsRead(): Promise<void>;

  /** Integrations. */
  listIntegrations(): Promise<IntegrationAccount[]>;

  /** Data management (Settings page). */
  exportAll(): Promise<Record<string, unknown[]>>;
  wipe(): Promise<void>;
}
